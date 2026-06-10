import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const PAGE_SIZE = 1000;
const MIGRATION_PATH = "supabase/migrations/0030_research_ontology_v2.sql";
const PROTOCOL_PATH = "docs/ops/BACKFILL_AGENT_CHANGE_PROTOCOL.md";

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
  const getValue = (name) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const args = new Set(argv);

  return {
    help: args.has("--help") || args.has("-h"),
    projectId: getValue("--project-id") ?? null,
    limit: Number(getValue("--limit") ?? 0) || null,
  };
}

function usage() {
  console.log(`
Research ontology P3 dry-run

Usage:
  npm run dry-run:research-ontology-p3
  npm run dry-run:research-ontology-p3 -- --project-id <uuid>

This is read-only. It does not apply SQL and does not call an LLM.
It reports the planned legacy-data backfill shape and agent-rewrite readiness.
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

function truncate(value, max = 180) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function normalizeLabel(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function increment(map, key, amount = 1) {
  map[key] = (map[key] ?? 0) + amount;
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function tableKey(...parts) {
  return parts.join("::");
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

function readChecklist() {
  if (!fs.existsSync(PROTOCOL_PATH)) return [];
  const text = fs.readFileSync(PROTOCOL_PATH, "utf8");
  const marker = "## Quick checklist";
  const start = text.indexOf(marker);
  if (start === -1) return [];

  return text
    .slice(start)
    .split(/\r?\n/)
    .filter((line) => line.startsWith("- [ ]"))
    .map((line) => line.replace("- [ ]", "").trim());
}

function inspectMigration() {
  const sql = fs.existsSync(MIGRATION_PATH) ? fs.readFileSync(MIGRATION_PATH, "utf8") : "";
  const backfillSection = sql.split("-- ---------------------------------------------------------------------------\n-- Compatibility backfill")[1] ?? "";

  return {
    path: MIGRATION_PATH,
    exists: Boolean(sql),
    creates_typed_join_tables:
      /\bcreate table if not exists problem_evidence\b/i.test(sql) &&
      /\bcreate table if not exists problem_themes\b/i.test(sql) &&
      /\bcreate table if not exists problem_topics\b/i.test(sql) &&
      /\bcreate table if not exists artifact_evidence\b/i.test(sql),
    no_polymorphic_artifact_links: !/\bcreate table\b[\s\S]*\bartifact_links\b/i.test(sql),
    legacy_topic_backfill_review_state_suggested:
      /Backfilled from legacy evidence\.themes/i.test(sql) &&
      /insert into evidence_topics/i.test(sql) &&
      /'suggested'/.test(backfillSection),
    legacy_problem_links_marked_provenance:
      /Backfilled from legacy problems\.source_theme_ids/i.test(sql) &&
      /Backfilled from legacy problems\.source_evidence_ids/i.test(sql) &&
      /'provenance'/.test(backfillSection),
    legacy_backfill_never_marks_accepted: !/Backfilled from legacy[\s\S]{0,300}'accepted'/i.test(backfillSection),
    does_not_rewrite_project_opportunities: !/\b(alter|drop|insert into|update)\s+project_opportunities\b/i.test(sql),
    rls_policies_present:
      /enable row level security/i.test(sql) &&
      /create policy/i.test(sql) &&
      /auth_user_org_ids/i.test(sql),
  };
}

function buildLabelPlans(evidenceRows) {
  const topicByKey = new Map();
  const evidenceTopicKeys = new Set();
  let emptyLabelCount = 0;

  for (const evidence of evidenceRows) {
    for (const rawLabel of asArray(evidence.themes)) {
      const label = String(rawLabel ?? "").trim();
      const labelKey = normalizeLabel(label);
      if (!label || !labelKey) {
        emptyLabelCount++;
        continue;
      }

      const key = tableKey(evidence.org_id, evidence.project_id, labelKey);
      const existing =
        topicByKey.get(key) ??
        {
          org_id: evidence.org_id,
          project_id: evidence.project_id,
          label_key: labelKey,
          labels: new Set(),
          evidence_ids: new Set(),
        };
      existing.labels.add(label);
      existing.evidence_ids.add(evidence.id);
      topicByKey.set(key, existing);
      evidenceTopicKeys.add(tableKey(evidence.id, key));
    }
  }

  const topics = Array.from(topicByKey.values()).map((row) => ({
    org_id: row.org_id,
    project_id: row.project_id,
    label_key: row.label_key,
    labels: Array.from(row.labels).sort(),
    evidence_count: row.evidence_ids.size,
  }));

  return {
    topics,
    planned_topic_count: topics.length,
    planned_evidence_topic_count: evidenceTopicKeys.size,
    empty_label_count: emptyLabelCount,
    normalization_collisions: topics
      .filter((row) => row.labels.length > 1)
      .sort((a, b) => b.evidence_count - a.evidence_count)
      .slice(0, 10),
  };
}

function buildThemePlans({ evidenceRows, themes, evidenceThemes, labelPlans }) {
  const evidenceById = new Map(evidenceRows.map((row) => [row.id, row]));
  const themeById = new Map(themes.map((row) => [row.id, row]));
  const validThemeEvidence = [];
  const orphanLinks = [];

  for (const link of evidenceThemes) {
    const evidence = evidenceById.get(link.evidence_id);
    const theme = themeById.get(link.theme_id);
    if (!evidence || !theme || evidence.project_id !== theme.project_id || evidence.org_id !== theme.org_id) {
      orphanLinks.push({
        theme_id: link.theme_id,
        evidence_id: link.evidence_id,
        reason: !evidence ? "missing_evidence" : !theme ? "missing_theme" : "scope_mismatch",
      });
      continue;
    }

    validThemeEvidence.push({ ...link, project_id: evidence.project_id });
  }

  const topicKeysByEvidenceId = new Map();
  for (const topic of labelPlans.topics) {
    const topicKey = tableKey(topic.org_id, topic.project_id, topic.label_key);
    for (const evidence of evidenceRows) {
      if (evidence.org_id !== topic.org_id || evidence.project_id !== topic.project_id) continue;
      const labelKeys = asArray(evidence.themes).map(normalizeLabel);
      if (labelKeys.includes(topic.label_key)) {
        const list = topicKeysByEvidenceId.get(evidence.id) ?? [];
        list.push(topicKey);
        topicKeysByEvidenceId.set(evidence.id, list);
      }
    }
  }

  const themeTopicKeys = new Set();
  for (const link of validThemeEvidence) {
    for (const topicKey of topicKeysByEvidenceId.get(link.evidence_id) ?? []) {
      themeTopicKeys.add(tableKey(link.theme_id, topicKey, "contributing"));
    }
  }

  const evidenceCountByTheme = {};
  for (const link of validThemeEvidence) increment(evidenceCountByTheme, link.theme_id);

  return {
    legacy_evidence_theme_links: evidenceThemes.length,
    planned_theme_evidence_count: validThemeEvidence.length,
    planned_theme_topic_count: themeTopicKeys.size,
    orphan_theme_evidence_links: orphanLinks.length,
    orphan_theme_evidence_sample: orphanLinks.slice(0, 10),
    evidence_count_by_theme: evidenceCountByTheme,
    validThemeEvidence,
  };
}

function buildProblemPlans({ problems, themes, evidenceRows, labelPlans }) {
  const themeById = new Map(themes.map((row) => [row.id, row]));
  const evidenceById = new Map(evidenceRows.map((row) => [row.id, row]));
  const topicKeysByEvidenceId = new Map();

  for (const evidence of evidenceRows) {
    const keys = asArray(evidence.themes)
      .map(normalizeLabel)
      .filter(Boolean)
      .map((labelKey) => tableKey(evidence.org_id, evidence.project_id, labelKey));
    topicKeysByEvidenceId.set(evidence.id, unique(keys));
  }

  let plannedProblemThemes = 0;
  let plannedProblemEvidence = 0;
  let plannedProblemTopics = 0;
  let danglingThemeIds = 0;
  let danglingEvidenceIds = 0;
  const statusCounts = {};
  const samples = [];

  for (const problem of problems) {
    increment(statusCounts, problem.status ?? "unknown");
    const sourceThemeIds = asArray(problem.source_theme_ids);
    const sourceEvidenceIds = asArray(problem.source_evidence_ids);
    const validThemeIds = sourceThemeIds.filter((id) => {
      const theme = themeById.get(id);
      return theme && theme.org_id === problem.org_id && theme.project_id === problem.project_id;
    });
    const validEvidenceIds = sourceEvidenceIds.filter((id) => {
      const evidence = evidenceById.get(id);
      return evidence && evidence.org_id === problem.org_id && evidence.project_id === problem.project_id;
    });

    danglingThemeIds += sourceThemeIds.length - validThemeIds.length;
    danglingEvidenceIds += sourceEvidenceIds.length - validEvidenceIds.length;
    plannedProblemThemes += unique(validThemeIds).length;
    plannedProblemEvidence += unique(validEvidenceIds).length;
    plannedProblemTopics += unique(validEvidenceIds.flatMap((id) => topicKeysByEvidenceId.get(id) ?? [])).length;

    if (samples.length < 12 && (sourceThemeIds.length > 0 || sourceEvidenceIds.length > 0)) {
      samples.push({
        id: problem.id,
        title: problem.title,
        status: problem.status,
        source_theme_ids: sourceThemeIds.length,
        valid_theme_ids: validThemeIds.length,
        source_evidence_ids: sourceEvidenceIds.length,
        valid_evidence_ids: validEvidenceIds.length,
        evidence_snippets: validEvidenceIds.slice(0, 3).map((id) => ({
          id,
          content: truncate(evidenceById.get(id)?.content),
        })),
      });
    }
  }

  return {
    existing_problems: problems.length,
    status_counts: statusCounts,
    planned_problem_theme_count: plannedProblemThemes,
    planned_problem_evidence_count: plannedProblemEvidence,
    planned_problem_topic_count: plannedProblemTopics,
    dangling_problem_theme_ids: danglingThemeIds,
    dangling_problem_evidence_ids: danglingEvidenceIds,
    problem_link_sample: samples,
  };
}

function buildArtifactPlans({ artifacts, artifactClaims, artifactClaimEvidence, evidenceRows }) {
  const artifactById = new Map(artifacts.map((row) => [row.id, row]));
  const claimById = new Map(artifactClaims.map((row) => [row.id, row]));
  const evidenceById = new Map(evidenceRows.map((row) => [row.id, row]));
  const keys = new Set();
  const orphanRows = [];

  for (const row of artifactClaimEvidence) {
    const claim = claimById.get(row.claim_id);
    const artifact = claim ? artifactById.get(claim.artifact_id) : null;
    const evidence = evidenceById.get(row.evidence_id);

    if (!claim || !artifact || !evidence || evidence.org_id !== artifact.org_id || evidence.project_id !== artifact.project_id) {
      orphanRows.push({
        claim_id: row.claim_id,
        evidence_id: row.evidence_id,
        reason: !claim ? "missing_claim" : !artifact ? "missing_artifact" : !evidence ? "missing_evidence" : "scope_mismatch",
      });
      continue;
    }

    keys.add(tableKey(artifact.id, evidence.id, "cites"));
  }

  return {
    planned_artifact_evidence_count: keys.size,
    orphan_artifact_evidence_rows: orphanRows.length,
    orphan_artifact_evidence_sample: orphanRows.slice(0, 10),
  };
}

function buildAgentReadiness({ themes, themePlans, evidenceRows, problems }) {
  const evidenceById = new Map(evidenceRows.map((row) => [row.id, row]));
  const promptThemeIds = themes
    .slice()
    .sort((a, b) => Number(b.evidence_count ?? 0) - Number(a.evidence_count ?? 0))
    .slice(0, 24)
    .map((theme) => theme.id);

  const promptEvidenceIds = new Set();
  for (const themeId of promptThemeIds) {
    const ids = themePlans.validThemeEvidence
      .filter((link) => link.theme_id === themeId)
      .map((link) => link.evidence_id)
      .filter((id) => evidenceById.get(id)?.trust_scope !== "excluded")
      .slice(0, 8);

    for (const id of ids) {
      if (promptEvidenceIds.size < 120 || promptEvidenceIds.has(id)) {
        promptEvidenceIds.add(id);
      }
    }
  }

  return {
    prompt_theme_cap: 24,
    prompt_evidence_per_theme_cap: 8,
    prompt_total_evidence_cap: 120,
    themes_available: themes.length,
    themes_with_backfilled_evidence: Object.keys(themePlans.evidence_count_by_theme).length,
    projected_themes_supplied: promptThemeIds.length,
    projected_unique_evidence_supplied: promptEvidenceIds.size,
    existing_problem_count: problems.length,
    source_note:
      "This is readiness only. The P3 agent dry-run path itself writes nothing, but can only execute after the reviewed SQL creates typed tables.",
  };
}

function buildWeaknessSamples({ labelPlans, evidenceRows, problemPlans, themePlans }) {
  const evidenceWithManyLabels = evidenceRows
    .map((row) => ({ row, count: asArray(row.themes).map(normalizeLabel).filter(Boolean).length }))
    .filter((item) => item.count > 1)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map(({ row, count }) => ({
      evidence_id: row.id,
      label_count: count,
      labels: asArray(row.themes).slice(0, 12),
      content: truncate(row.content),
    }));

  return {
    normalized_label_collisions: labelPlans.normalization_collisions.slice(0, 5),
    evidence_with_many_legacy_labels: evidenceWithManyLabels,
    orphan_theme_evidence_sample: themePlans.orphan_theme_evidence_sample.slice(0, 5),
    problem_link_sample: problemPlans.problem_link_sample.slice(0, 5),
  };
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
    evidenceRows,
    themes,
    evidenceThemes,
    problems,
    artifacts,
    artifactClaims,
    artifactClaimEvidence,
  ] = await Promise.all([
    fetchAll(
      service,
      "evidence",
      "id, org_id, project_id, content, themes, trust_scope",
      { projectId: options.projectId }
    ),
    fetchAll(
      service,
      "themes",
      "id, org_id, project_id, label, description, evidence_count",
      { projectId: options.projectId }
    ),
    fetchAll(service, "evidence_themes", "org_id, theme_id, evidence_id, confidence", {
      projectId: null,
      projectField: null,
    }),
    fetchAll(
      service,
      "problems",
      "id, org_id, project_id, title, status, source_theme_ids, source_evidence_ids",
      { projectId: options.projectId }
    ),
    fetchAll(service, "artifacts", "id, org_id, project_id", { projectId: options.projectId }),
    fetchAll(service, "artifact_claims", "id, org_id, artifact_id", {
      projectId: null,
      projectField: null,
    }),
    fetchAll(service, "artifact_claim_evidence", "org_id, claim_id, evidence_id", {
      projectId: null,
      projectField: null,
    }),
  ]);

  const limitedEvidenceRows = options.limit ? evidenceRows.slice(0, options.limit) : evidenceRows;
  const projectIds = unique(limitedEvidenceRows.map((row) => row.project_id));
  const scopedEvidenceThemes = evidenceThemes.filter((link) => {
    if (!options.projectId) return true;
    return limitedEvidenceRows.some((evidence) => evidence.id === link.evidence_id);
  });

  const labelPlans = buildLabelPlans(limitedEvidenceRows);
  const themePlans = buildThemePlans({
    evidenceRows: limitedEvidenceRows,
    themes,
    evidenceThemes: scopedEvidenceThemes,
    labelPlans,
  });
  const problemPlans = buildProblemPlans({
    problems,
    themes,
    evidenceRows: limitedEvidenceRows,
    labelPlans,
  });
  const artifactPlans = buildArtifactPlans({
    artifacts,
    artifactClaims,
    artifactClaimEvidence,
    evidenceRows: limitedEvidenceRows,
  });
  const migration = inspectMigration();
  const agentReadiness = buildAgentReadiness({
    themes,
    themePlans,
    evidenceRows: limitedEvidenceRows,
    problems,
  });

  const mechanicalGates = {
    dry_run_only_no_apply_flag: true,
    migration_file_exists: migration.exists,
    typed_join_tables_present: migration.creates_typed_join_tables,
    no_polymorphic_artifact_links: migration.no_polymorphic_artifact_links,
    legacy_topic_backfill_review_state_suggested: migration.legacy_topic_backfill_review_state_suggested,
    legacy_backfill_never_marks_accepted: migration.legacy_backfill_never_marks_accepted,
    legacy_problem_links_marked_provenance: migration.legacy_problem_links_marked_provenance,
    project_opportunities_not_rewritten: migration.does_not_rewrite_project_opportunities,
    rls_policies_present: migration.rls_policies_present,
  };

  const report = {
    generated_at: new Date().toISOString(),
    mode: "dry-run-read-only",
    writes_attempted: 0,
    project_filter: options.projectId,
    supabase_host: new URL(url).host,
    corpus: {
      project_count_in_scope: projectIds.length,
      evidence_rows: limitedEvidenceRows.length,
      themes: themes.length,
      legacy_evidence_theme_links: scopedEvidenceThemes.length,
      problems: problems.length,
      artifacts: artifacts.length,
    },
    migration,
    planned_backfill: {
      topics: {
        planned_rows: labelPlans.planned_topic_count,
        planned_evidence_topic_links: labelPlans.planned_evidence_topic_count,
        empty_legacy_labels: labelPlans.empty_label_count,
        normalization_collision_count: labelPlans.normalization_collisions.length,
      },
      themes: {
        planned_theme_evidence_links: themePlans.planned_theme_evidence_count,
        planned_theme_topic_links: themePlans.planned_theme_topic_count,
        orphan_theme_evidence_links: themePlans.orphan_theme_evidence_links,
      },
      problems: {
        planned_problem_theme_links: problemPlans.planned_problem_theme_count,
        planned_problem_evidence_links: problemPlans.planned_problem_evidence_count,
        planned_problem_topic_links: problemPlans.planned_problem_topic_count,
        dangling_problem_theme_ids: problemPlans.dangling_problem_theme_ids,
        dangling_problem_evidence_ids: problemPlans.dangling_problem_evidence_ids,
        status_counts: problemPlans.status_counts,
      },
      artifacts: artifactPlans,
    },
    agent_rewrite_readiness: agentReadiness,
    mechanical_gates: mechanicalGates,
    weakness_stratified_samples: buildWeaknessSamples({
      labelPlans,
      evidenceRows: limitedEvidenceRows,
      problemPlans,
      themePlans,
    }),
    protocol_checklist: readChecklist().map((item) => ({
      item,
      p3_status:
        item.includes("Dry-run default")
          ? "met: this script has no apply path"
          : item.includes("Reviewer read")
            ? "pending Opus review"
            : item.includes("Live path and backfill")
              ? "not applicable: P3 migration backfill and live agent rewrite are separate; live agent consumes typed tables"
              : item.includes("decision distribution")
                ? "met for migration/backfill counts; agent dedupe histogram emitted by live dry-run after SQL exists"
                : item.includes("Sample")
                  ? "met: weakness samples included below"
                  : item.includes("mechanical")
                    ? "met: mechanical_gates included below"
                    : item.includes("UI honours")
                      ? "pending downstream Sonnet UI review"
                      : item.includes("Scope ceiling")
                        ? "met: legacy links are provenance/suggested, not asserted as direct support"
                        : item.includes("committed")
                          ? "pending written approval"
                          : "see packet",
    })),
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
