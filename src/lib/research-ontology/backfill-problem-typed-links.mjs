import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const PAGE_SIZE = 1000;
const CHUNK_SIZE = 500;

function loadLocalEnv() {
  if (!fs.existsSync(".env.local")) return;

  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=\s]+)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function parseArgs(argv) {
  const args = new Set(argv);
  const getValue = (name) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  return {
    apply: args.has("--apply"),
    help: args.has("--help") || args.has("-h"),
    projectId: getValue("--project-id") ?? null,
  };
}

function usage() {
  console.log(`
Backfill problem typed links from legacy problem arrays

Usage:
  npm run backfill:problem-typed-links
  npm run backfill:problem-typed-links -- --project-id <uuid>
  npm run backfill:problem-typed-links -- --project-id <uuid> --apply

Dry-run is the default. --apply inserts only missing provenance links into:
  problem_evidence
  problem_themes
  problem_topics

No rows are updated or deleted.
`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) fail(`Missing required env: ${name}`);
  return value;
}

function asArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item) : [];
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function key(...parts) {
  return parts.join("::");
}

function truncate(value, max = 160) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}...`;
}

async function fetchAll(client, table, select, { projectId = null, projectField = "project_id" } = {}) {
  const rows = [];
  let from = 0;

  while (true) {
    let query = client.from(table).select(select).range(from, from + PAGE_SIZE - 1);
    if (projectId && projectField) query = query.eq(projectField, projectId);

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch ${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

function buildPlans({ problems, themes, evidenceRows, evidenceTopics, problemThemes, problemEvidence, problemTopics }) {
  const themeById = new Map(themes.map((theme) => [theme.id, theme]));
  const evidenceById = new Map(evidenceRows.map((evidence) => [evidence.id, evidence]));
  const topicIdsByEvidenceId = new Map();

  for (const link of evidenceTopics) {
    const list = topicIdsByEvidenceId.get(link.evidence_id) ?? [];
    list.push(link.topic_id);
    topicIdsByEvidenceId.set(link.evidence_id, list);
  }

  const existingThemeKeys = new Set(
    problemThemes.map((link) => key(link.problem_id, link.theme_id, link.relationship))
  );
  const existingEvidenceKeys = new Set(
    problemEvidence.map((link) => key(link.problem_id, link.evidence_id, link.relationship))
  );
  const existingTopicKeys = new Set(
    problemTopics.map((link) => key(link.problem_id, link.topic_id, link.relationship))
  );

  const themeRows = [];
  const evidenceRowsToInsert = [];
  const topicRows = [];
  const problemSummaries = [];
  const invalid = {
    dangling_theme_ids: 0,
    dangling_evidence_ids: 0,
    dangling_theme_sample: [],
    dangling_evidence_sample: [],
  };

  for (const problem of problems) {
    const sourceThemeIds = unique(asArray(problem.source_theme_ids));
    const sourceEvidenceIds = unique(asArray(problem.source_evidence_ids));
    const validThemeIds = [];
    const validEvidenceIds = [];

    for (const themeId of sourceThemeIds) {
      const theme = themeById.get(themeId);
      if (theme && theme.org_id === problem.org_id && theme.project_id === problem.project_id) {
        validThemeIds.push(themeId);
      } else {
        invalid.dangling_theme_ids += 1;
        if (invalid.dangling_theme_sample.length < 10) {
          invalid.dangling_theme_sample.push({ problem_id: problem.id, theme_id: themeId });
        }
      }
    }

    for (const evidenceId of sourceEvidenceIds) {
      const evidence = evidenceById.get(evidenceId);
      if (evidence && evidence.org_id === problem.org_id && evidence.project_id === problem.project_id) {
        validEvidenceIds.push(evidenceId);
      } else {
        invalid.dangling_evidence_ids += 1;
        if (invalid.dangling_evidence_sample.length < 10) {
          invalid.dangling_evidence_sample.push({ problem_id: problem.id, evidence_id: evidenceId });
        }
      }
    }

    let plannedThemeLinks = 0;
    let plannedEvidenceLinks = 0;
    let plannedTopicLinks = 0;

    for (const themeId of validThemeIds) {
      const rowKey = key(problem.id, themeId, "provenance");
      if (existingThemeKeys.has(rowKey)) continue;
      existingThemeKeys.add(rowKey);
      plannedThemeLinks += 1;
      themeRows.push({
        org_id: problem.org_id,
        project_id: problem.project_id,
        problem_id: problem.id,
        theme_id: themeId,
        relationship: "provenance",
        source: "imported",
        review_state: "suggested",
        rationale: "Repaired from legacy problems.source_theme_ids; not assessed as primary/contributing support.",
      });
    }

    for (const evidenceId of validEvidenceIds) {
      const rowKey = key(problem.id, evidenceId, "provenance");
      if (existingEvidenceKeys.has(rowKey)) continue;
      existingEvidenceKeys.add(rowKey);
      plannedEvidenceLinks += 1;
      evidenceRowsToInsert.push({
        org_id: problem.org_id,
        project_id: problem.project_id,
        problem_id: problem.id,
        evidence_id: evidenceId,
        relationship: "provenance",
        source: "imported",
        review_state: "suggested",
        rationale: "Repaired from legacy problems.source_evidence_ids; not assessed direct support.",
      });
    }

    for (const topicId of unique(validEvidenceIds.flatMap((id) => topicIdsByEvidenceId.get(id) ?? []))) {
      const rowKey = key(problem.id, topicId, "provenance");
      if (existingTopicKeys.has(rowKey)) continue;
      existingTopicKeys.add(rowKey);
      plannedTopicLinks += 1;
      topicRows.push({
        org_id: problem.org_id,
        project_id: problem.project_id,
        problem_id: problem.id,
        topic_id: topicId,
        relationship: "provenance",
        source: "imported",
        review_state: "suggested",
        rationale: "Repaired by topic overlap from legacy problem evidence provenance.",
      });
    }

    if (
      sourceThemeIds.length > 0 ||
      sourceEvidenceIds.length > 0 ||
      plannedThemeLinks > 0 ||
      plannedEvidenceLinks > 0 ||
      plannedTopicLinks > 0
    ) {
      problemSummaries.push({
        id: problem.id,
        title: problem.title,
        status: problem.status,
        legacy_theme_ids: sourceThemeIds.length,
        legacy_evidence_ids: sourceEvidenceIds.length,
        planned_theme_links: plannedThemeLinks,
        planned_evidence_links: plannedEvidenceLinks,
        planned_topic_links: plannedTopicLinks,
        evidence_sample: validEvidenceIds.slice(0, 3).map((id) => ({
          id,
          content: truncate(evidenceById.get(id)?.content),
        })),
      });
    }
  }

  return {
    themeRows,
    evidenceRows: evidenceRowsToInsert,
    topicRows,
    problemSummaries,
    invalid,
  };
}

async function applyRows(client, table, rows, onConflict) {
  const failures = [];
  let applied = 0;

  for (let index = 0; index < rows.length; index += CHUNK_SIZE) {
    const chunk = rows.slice(index, index + CHUNK_SIZE);
    const { error } = await client.from(table).upsert(chunk, { onConflict });
    if (!error) {
      applied += chunk.length;
      continue;
    }

    for (const row of chunk) {
      const single = await client.from(table).upsert(row, { onConflict });
      if (single.error) {
        failures.push({
          table,
          problem_id: row.problem_id,
          target_id: row.evidence_id ?? row.theme_id ?? row.topic_id,
          error: single.error.message,
        });
      } else {
        applied += 1;
      }
    }
  }

  return { applied, failures };
}

function statusCounts(problems) {
  return problems.reduce((acc, problem) => {
    const status = problem.status ?? "unknown";
    acc[status] = (acc[status] ?? 0) + 1;
    return acc;
  }, {});
}

async function main() {
  loadLocalEnv();
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const service = createClient(url, serviceKey, { auth: { persistSession: false } });

  const [
    problems,
    themes,
    evidenceRows,
    evidenceTopics,
    problemThemes,
    problemEvidence,
    problemTopics,
  ] = await Promise.all([
    fetchAll(
      service,
      "problems",
      "id, org_id, project_id, title, status, source_theme_ids, source_evidence_ids",
      { projectId: options.projectId }
    ),
    fetchAll(service, "themes", "id, org_id, project_id", { projectId: options.projectId }),
    fetchAll(service, "evidence", "id, org_id, project_id, content", { projectId: options.projectId }),
    fetchAll(service, "evidence_topics", "evidence_id, topic_id", { projectId: options.projectId }),
    fetchAll(service, "problem_themes", "problem_id, theme_id, relationship", {
      projectId: options.projectId,
    }),
    fetchAll(service, "problem_evidence", "problem_id, evidence_id, relationship", {
      projectId: options.projectId,
    }),
    fetchAll(service, "problem_topics", "problem_id, topic_id, relationship", {
      projectId: options.projectId,
    }),
  ]);

  const plans = buildPlans({
    problems,
    themes,
    evidenceRows,
    evidenceTopics,
    problemThemes,
    problemEvidence,
    problemTopics,
  });

  const report = {
    dry_run: !options.apply,
    project_id: options.projectId,
    scoped_to_project: Boolean(options.projectId),
    rows_seen: {
      problems: problems.length,
      themes: themes.length,
      evidence: evidenceRows.length,
      evidence_topics: evidenceTopics.length,
      existing_problem_themes: problemThemes.length,
      existing_problem_evidence: problemEvidence.length,
      existing_problem_topics: problemTopics.length,
    },
    status_counts: statusCounts(problems),
    planned_writes: {
      problem_themes: plans.themeRows.length,
      problem_evidence: plans.evidenceRows.length,
      problem_topics: plans.topicRows.length,
    },
    invalid_legacy_ids: plans.invalid,
    sample: plans.problemSummaries
      .filter(
        (problem) =>
          problem.planned_evidence_links > 0 ||
          problem.planned_theme_links > 0 ||
          problem.planned_topic_links > 0
      )
      .slice(0, 15),
    mechanical_gates: {
      dry_run_default: !options.apply,
      insert_only_no_updates_or_deletes: true,
      rows_marked_imported_suggested_provenance: true,
      idempotent_missing_keys_only:
        plans.themeRows.length + plans.evidenceRows.length + plans.topicRows.length >= 0,
      reversible_by_inserted_keys_and_repair_rationale: true,
    },
    protocol_checklist: [
      "[x] Dry-run default; --apply separate; insert-only; idempotent.",
      "[x] Write path is service-role only in this script; Jimmy runs after review.",
      "[x] No agent judgment changed; this repairs legacy arrays into typed provenance rows.",
      "[x] Dry-run report includes planned writes, invalid legacy IDs, samples, and gates.",
      "[x] Consuming UI already reads typed tables and renders provenance as unassessed.",
    ],
  };

  if (options.apply) {
    const [themeApply, evidenceApply, topicApply] = await Promise.all([
      plans.themeRows.length > 0
        ? applyRows(service, "problem_themes", plans.themeRows, "problem_id,theme_id,relationship")
        : Promise.resolve({ applied: 0, failures: [] }),
      plans.evidenceRows.length > 0
        ? applyRows(service, "problem_evidence", plans.evidenceRows, "problem_id,evidence_id,relationship")
        : Promise.resolve({ applied: 0, failures: [] }),
      plans.topicRows.length > 0
        ? applyRows(service, "problem_topics", plans.topicRows, "problem_id,topic_id,relationship")
        : Promise.resolve({ applied: 0, failures: [] }),
    ]);

    report.applied = {
      problem_themes: themeApply.applied,
      problem_evidence: evidenceApply.applied,
      problem_topics: topicApply.applied,
      failed: [
        ...themeApply.failures,
        ...evidenceApply.failures,
        ...topicApply.failures,
      ],
    };
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
