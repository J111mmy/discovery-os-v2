import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const CONVERTER_VERSION = "artifact-html-backfill-v1";
const PAGE_SIZE = 500;
const DATA_N_RE = /^[1-9]\d{0,3}$/;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function usage() {
  console.log(`
Artifact HTML backfill

Usage:
  npm run backfill:artifact-html          # dry-run, reports counts only
  npm run backfill:artifact-html -- --apply

Required env:
  NEXT_PUBLIC_SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

The backfill is idempotent: every update includes WHERE content_html IS NULL.
`);
}

function parseArgs() {
  const args = new Set(process.argv.slice(2));
  return {
    apply: args.has("--apply"),
    help: args.has("--help") || args.has("-h"),
  };
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function findCompiledFile(dir, filename) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findCompiledFile(fullPath, filename);
      if (found) return found;
    }

    if (entry.isFile() && entry.name === filename) {
      return fullPath;
    }
  }

  return null;
}

function loadConverter() {
  const outDir = mkdtempSync(path.join(repoRoot, ".tmp-artifact-html-backfill-"));

  try {
    execFileSync(
      path.join(repoRoot, "node_modules/.bin/tsc"),
      [
        "src/lib/sanitize/artifact-html.ts",
        "src/lib/sanitize/artifact-markdown.ts",
        "--target",
        "ES2020",
        "--module",
        "commonjs",
        "--moduleResolution",
        "node",
        "--esModuleInterop",
        "--skipLibCheck",
        "--outDir",
        outDir,
      ],
      { cwd: repoRoot, stdio: "inherit" }
    );

    const compiledFile = findCompiledFile(outDir, "artifact-markdown.js");
    if (!compiledFile) {
      throw new Error("Could not find compiled artifact-markdown.js");
    }

    const require = createRequire(import.meta.url);
    return {
      outDir,
      markdownToSanitizedArtifactHtml: require(compiledFile).markdownToSanitizedArtifactHtml,
    };
  } catch (error) {
    rmSync(outDir, { recursive: true, force: true });
    throw error;
  }
}

function markdownCitationNumbers(markdown) {
  const citations = [];
  const pattern = /\[(\d+)\]/g;
  let match;

  while ((match = pattern.exec(markdown)) !== null) {
    if (DATA_N_RE.test(match[1])) {
      citations.push(match[1]);
    }
  }

  return citations;
}

function citationMapKeys(metadata) {
  const citationMap = metadata && typeof metadata === "object" ? metadata.citation_map : null;
  if (!citationMap || typeof citationMap !== "object" || Array.isArray(citationMap)) {
    return new Set();
  }

  return new Set(Object.keys(citationMap));
}

function convertedCitationNumbers(html) {
  const citations = [];
  const pattern = /<cite\b[^>]*\bdata-n="(\d+)"/g;
  let match;

  while ((match = pattern.exec(html)) !== null) {
    citations.push(match[1]);
  }

  return citations;
}

function citationReport(markdown, html, metadata) {
  const markers = markdownCitationNumbers(markdown);
  const mappedKeys = citationMapKeys(metadata);
  const unmapped = markers.filter((n) => !mappedKeys.has(n));

  return {
    markdown_marker_count: markers.length,
    converted_citation_count: convertedCitationNumbers(html).length,
    unmapped_marker_count: unmapped.length,
    unmapped_markers: Array.from(new Set(unmapped)),
  };
}

function summarizeReports(reports) {
  return reports.reduce(
    (acc, report) => {
      acc.rows += 1;
      acc.markdown_marker_count += report.markdown_marker_count;
      acc.converted_citation_count += report.converted_citation_count;
      acc.unmapped_marker_count += report.unmapped_marker_count;
      if (report.unmapped_marker_count > 0) acc.rows_with_unmapped += 1;
      return acc;
    },
    {
      rows: 0,
      markdown_marker_count: 0,
      converted_citation_count: 0,
      unmapped_marker_count: 0,
      rows_with_unmapped: 0,
    }
  );
}

function conversionFailure(row, error) {
  return {
    id: row.id,
    error: error instanceof Error ? error.message : String(error),
  };
}

async function fetchAll(supabase, table, columns) {
  const rows = [];
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .is("content_html", null)
      .order("id", { ascending: true })
      .range(from, to);

    if (error) throw new Error(`Failed to fetch ${table}: ${error.message}`);

    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

async function fetchArtifactMetadataById(supabase, artifactIds) {
  const ids = Array.from(new Set(artifactIds)).filter(Boolean);
  const metadataById = new Map();

  for (let i = 0; i < ids.length; i += PAGE_SIZE) {
    const batch = ids.slice(i, i + PAGE_SIZE);
    const { data, error } = await supabase
      .from("artifacts")
      .select("id, metadata")
      .in("id", batch);

    if (error) throw new Error(`Failed to fetch artifact metadata: ${error.message}`);

    for (const row of data ?? []) {
      metadataById.set(row.id, row.metadata ?? {});
    }
  }

  return metadataById;
}

function buildArtifactPlan(rows, markdownToSanitizedArtifactHtml) {
  const plan = [];
  const failures = [];

  for (const row of rows) {
    try {
      const markdown = row.content_md ?? "";
      const html = markdownToSanitizedArtifactHtml(markdown);
      const report = citationReport(markdown, html, row.metadata ?? {});
      const metadata = {
        ...(row.metadata ?? {}),
        html_migration: {
          converter_version: CONVERTER_VERSION,
          converted_at: new Date().toISOString(),
          markdown_marker_count: report.markdown_marker_count,
          converted_citation_count: report.converted_citation_count,
          unmapped_marker_count: report.unmapped_marker_count,
          unmapped_markers: report.unmapped_markers,
        },
      };

      plan.push({ id: row.id, html, metadata, report });
    } catch (error) {
      failures.push(conversionFailure(row, error));
    }
  }

  return { plan, failures };
}

function buildVersionPlan(rows, metadataByArtifactId, markdownToSanitizedArtifactHtml) {
  const plan = [];
  const failures = [];

  for (const row of rows) {
    try {
      const markdown = row.content_md ?? "";
      const html = markdownToSanitizedArtifactHtml(markdown);
      const report = citationReport(markdown, html, metadataByArtifactId.get(row.artifact_id) ?? {});
      plan.push({ id: row.id, artifact_id: row.artifact_id, html, report });
    } catch (error) {
      failures.push(conversionFailure(row, error));
    }
  }

  return { plan, failures };
}

async function applyArtifactPlan(supabase, plan) {
  let updated = 0;

  for (const row of plan) {
    const { data, error } = await supabase
      .from("artifacts")
      .update({ content_html: row.html, metadata: row.metadata })
      .eq("id", row.id)
      .is("content_html", null)
      .select("id");

    if (error) throw new Error(`Failed to update artifact ${row.id}: ${error.message}`);
    updated += data?.length ?? 0;
  }

  return updated;
}

async function applyVersionPlan(supabase, plan) {
  let updated = 0;

  for (const row of plan) {
    const { data, error } = await supabase
      .from("artifact_versions")
      .update({ content_html: row.html })
      .eq("id", row.id)
      .is("content_html", null)
      .select("id");

    if (error) throw new Error(`Failed to update artifact version ${row.id}: ${error.message}`);
    updated += data?.length ?? 0;
  }

  return updated;
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    usage();
    return;
  }

  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { outDir, markdownToSanitizedArtifactHtml } = loadConverter();

  try {
    const artifactRows = await fetchAll(
      supabase,
      "artifacts",
      "id, org_id, project_id, content_md, content_html, metadata"
    );
    const versionRows = await fetchAll(
      supabase,
      "artifact_versions",
      "id, artifact_id, org_id, content_md, content_html"
    );
    const metadataByArtifactId = await fetchArtifactMetadataById(
      supabase,
      versionRows.map((row) => row.artifact_id)
    );

    const artifactBuild = buildArtifactPlan(artifactRows, markdownToSanitizedArtifactHtml);
    const versionBuild = buildVersionPlan(versionRows, metadataByArtifactId, markdownToSanitizedArtifactHtml);
    const artifactPlan = artifactBuild.plan;
    const versionPlan = versionBuild.plan;
    const artifactSummary = summarizeReports(artifactPlan.map((row) => row.report));
    const versionSummary = summarizeReports(versionPlan.map((row) => row.report));

    const result = {
      mode: args.apply ? "apply" : "dry-run",
      converter_version: CONVERTER_VERSION,
      artifacts: {
        ...artifactSummary,
        failed_count: artifactBuild.failures.length,
        failed_ids: artifactBuild.failures.map((failure) => failure.id),
        failures: artifactBuild.failures,
        updated: 0,
      },
      artifact_versions: {
        ...versionSummary,
        failed_count: versionBuild.failures.length,
        failed_ids: versionBuild.failures.map((failure) => failure.id),
        failures: versionBuild.failures,
        updated: 0,
      },
    };

    console.log(JSON.stringify(result, null, 2));

    if (!args.apply) {
      console.log("Dry run only. Re-run with --apply to update rows.");
      return;
    }

    result.artifacts.updated = await applyArtifactPlan(supabase, artifactPlan);
    result.artifact_versions.updated = await applyVersionPlan(supabase, versionPlan);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
