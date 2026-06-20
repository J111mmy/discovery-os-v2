import type { EvidenceRecord, TrustScope } from "@/types/database";
import { filterAdjacentProjectHintedEvidence } from "@/lib/evidence/adjacent-project";

type SupabaseLike = {
  from: (table: string) => any;
};

type StructuralFocus =
  | "topics"
  | "themes"
  | "problems"
  | "opportunities"
  | "actions"
  | "artifacts";

export type AskStructuralIntent = {
  focuses: StructuralFocus[];
  needsEvidence: boolean;
};

export type AskStructuralContext = {
  intent: AskStructuralIntent;
  text: string;
  hasData: boolean;
};

const VISIBLE_REVIEW_STATES = ["suggested", "accepted", "edited"] as const;
const VISIBLE_OPPORTUNITY_STATUSES = ["suggested", "accepted", "active"] as const;
const LINKED_EVIDENCE_FOCUSES: StructuralFocus[] = ["themes", "problems", "opportunities"];
const LINKED_EVIDENCE_PER_RECORD = 2;

const FOCUS_PATTERNS: Array<[StructuralFocus, RegExp]> = [
  ["topics", /\b(topic|topics|code|codes|tag|tags|label|labels)\b/i],
  ["themes", /\b(theme|themes|pattern|patterns)\b/i],
  ["problems", /\b(problem|problems|pain|pains|friction|unmet need|unmet needs)\b/i],
  ["opportunities", /\b(opportunity|opportunities|how might we|hmw|solution direction|solution directions)\b/i],
  ["actions", /\b(action|actions|todo|to-do|follow[-\s]?up|commitment|commitments)\b/i],
  ["artifacts", /\b(artifact|artifacts|document|documents|deck|decks|brief|briefs|prd|report|reports)\b/i],
];

const STRUCTURAL_VERB_RE =
  /\b(what|which|list|show|summari[sz]e|overview|breakdown|map|count|how many|status|landscape|registry|pipeline|ontology|group|groups|grouped)\b/i;
const EVIDENCE_REQUEST_RE =
  /\b(evidence|quote|quotes|source|sources|transcript|transcripts|support|supports|supporting|example|examples|said|mention|mentioned|who said|where did)\b/i;

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

function asRows<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function truncate(value: string | null | undefined, max = 180) {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function formatList(values: string[] | null | undefined) {
  return Array.isArray(values) && values.length > 0 ? values.join(", ") : "none recorded";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function countBy<T extends Record<string, unknown>>(rows: T[], key: keyof T) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = row[key];
    if (typeof value !== "string") continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function countFor(counts: Map<string, number>, id: string) {
  return counts.get(id) ?? 0;
}

function trustScopesFor(filter: TrustScope | "include_pending" | "all") {
  if (filter === "include_pending") return ["trusted", "pending"];
  if (filter === "all") return ["trusted", "pending", "disputed", "excluded"];
  return [filter];
}

function addUniqueId(target: string[], seen: Set<string>, value: string | null | undefined) {
  if (!value || seen.has(value)) return;
  seen.add(value);
  target.push(value);
}

function confidenceScore(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : -1;
  }
  return -1;
}

function evidenceLinkRank(row: { relationship?: string | null; confidence?: unknown; created_at?: string | null }) {
  const relationshipOrder: Record<string, number> = {
    supporting: 0,
    example: 1,
    created_from: 1,
    source: 1,
    provenance: 2,
    linked: 2,
    edge_case: 3,
    contradicting: 4,
  };
  return [
    relationshipOrder[row.relationship ?? ""] ?? 5,
    -confidenceScore(row.confidence),
    row.created_at ? new Date(row.created_at).getTime() : Number.MAX_SAFE_INTEGER,
  ] as const;
}

function compareEvidenceLinks(
  a: { relationship?: string | null; confidence?: unknown; created_at?: string | null },
  b: { relationship?: string | null; confidence?: unknown; created_at?: string | null }
) {
  const ar = evidenceLinkRank(a);
  const br = evidenceLinkRank(b);
  return ar[0] - br[0] || ar[1] - br[1] || ar[2] - br[2];
}

function visibleStructuralLinkedFocus(intent: AskStructuralIntent) {
  return intent.focuses.some((focus) => LINKED_EVIDENCE_FOCUSES.includes(focus));
}

export function shouldLoadLinkedEvidenceForStructuralIntent(intent: AskStructuralIntent | null) {
  return Boolean(intent && visibleStructuralLinkedFocus(intent));
}

async function scopedCount(input: {
  supabase: SupabaseLike;
  table: string;
  org_id: string;
  project_id: string;
}) {
  const { count, error } = await input.supabase
    .from(input.table)
    .select("id", { count: "exact", head: true })
    .eq("org_id", input.org_id)
    .eq("project_id", input.project_id);

  if (error) throw new Error(`Failed to count ${input.table}: ${error.message}`);
  return count ?? 0;
}

async function loadEvidenceRecordsByIds(input: {
  supabase: SupabaseLike;
  org_id: string;
  project_id: string;
  evidenceIds: string[];
  trust_scope: TrustScope | "include_pending" | "all";
}) {
  const { supabase, org_id, project_id, evidenceIds, trust_scope } = input;
  const orderedIds = unique(evidenceIds).filter(Boolean);
  if (orderedIds.length === 0) return [];

  const { data, error } = await supabase
    .from("evidence")
    .select(
      "id, org_id, project_id, source_id, segment_id, content, trust_scope, trust_scope_source, summary, classification, sentiment, themes, metadata, ai_trust_grade, ai_trust_reason, ai_graded_at, created_at"
    )
    .eq("org_id", org_id)
    .eq("project_id", project_id)
    .in("id", orderedIds)
    .in("trust_scope", trustScopesFor(trust_scope));

  if (error) throw new Error(`Failed to load linked evidence: ${error.message}`);

  const recordsById = new Map(asRows<EvidenceRecord>(data).map((record) => [record.id, record]));
  const records = orderedIds
    .map((id) => recordsById.get(id))
    .filter((record): record is EvidenceRecord => Boolean(record));

  const sourceIds = unique(
    records.map((record) => record.source_id).filter((id): id is string => Boolean(id))
  );
  const segmentIds = unique(
    records.map((record) => record.segment_id).filter((id): id is string => Boolean(id))
  );

  const [sourcesResult, segmentsResult] = await Promise.all([
    sourceIds.length > 0
      ? supabase
          .from("sources")
          .select("id, title, type")
          .eq("org_id", org_id)
          .eq("project_id", project_id)
          .in("id", sourceIds)
      : Promise.resolve({ data: [], error: null }),
    segmentIds.length > 0
      ? supabase
          .from("source_segments")
          .select("id, speaker, segment_index")
          .eq("org_id", org_id)
          .in("id", segmentIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (sourcesResult.error) {
    throw new Error(`Failed to load linked evidence sources: ${sourcesResult.error.message}`);
  }
  if (segmentsResult.error) {
    throw new Error(`Failed to load linked evidence segments: ${segmentsResult.error.message}`);
  }

  const sourcesById = new Map(
    asRows<{ id: string; title: string; type: EvidenceRecord["source_type"] }>(sourcesResult.data).map(
      (source) => [source.id, source]
    )
  );
  const segmentsById = new Map(
    asRows<{ id: string; speaker: string | null; segment_index: number | null }>(
      segmentsResult.data
    ).map((segment) => [segment.id, segment])
  );

  for (const record of records) {
    const source = sourcesById.get(record.source_id);
    if (source) {
      record.source_title = source.title;
      record.source_type = source.type;
    }

    const segment = record.segment_id ? segmentsById.get(record.segment_id) : null;
    if (segment) {
      record.segment_speaker = segment.speaker;
      record.segment_index = segment.segment_index;
    }
  }

  return filterAdjacentProjectHintedEvidence(records);
}

async function collectThemeEvidenceIds(input: {
  supabase: SupabaseLike;
  org_id: string;
  project_id: string;
  limit: number;
}) {
  const { supabase, org_id, project_id, limit } = input;
  const { data, error } = await supabase
    .from("themes")
    .select("id")
    .eq("org_id", org_id)
    .eq("project_id", project_id)
    .in("review_state", [...VISIBLE_REVIEW_STATES])
    .order("evidence_count", { ascending: false })
    .limit(10);

  if (error) throw new Error(`Failed to load themes for linked evidence: ${error.message}`);

  const themeIds = asRows<{ id: string }>(data).map((theme) => theme.id);
  if (themeIds.length === 0) return [];

  const [typedResult, legacyResult] = await Promise.all([
    supabase
      .from("theme_evidence")
      .select("theme_id, evidence_id, relationship, review_state, confidence, created_at")
      .eq("org_id", org_id)
      .eq("project_id", project_id)
      .in("theme_id", themeIds)
      .in("review_state", [...VISIBLE_REVIEW_STATES]),
    supabase
      .from("evidence_themes")
      .select("theme_id, evidence_id, confidence")
      .eq("org_id", org_id)
      .in("theme_id", themeIds),
  ]);

  if (typedResult.error) {
    throw new Error(`Failed to load theme evidence links: ${typedResult.error.message}`);
  }
  if (legacyResult.error) {
    throw new Error(`Failed to load legacy theme evidence links: ${legacyResult.error.message}`);
  }

  const typedRows = asRows<{
    theme_id: string;
    evidence_id: string;
    relationship: string | null;
    confidence: number | string | null;
    created_at: string | null;
  }>(typedResult.data);
  const legacyRows = asRows<{
    theme_id: string;
    evidence_id: string;
    confidence: number | string | null;
  }>(legacyResult.data);

  const evidenceIds: string[] = [];
  const seen = new Set<string>();

  for (const themeId of themeIds) {
    const candidates = [
      ...typedRows
        .filter((row) => row.theme_id === themeId)
        .sort(compareEvidenceLinks)
        .map((row) => row.evidence_id),
      ...legacyRows
        .filter((row) => row.theme_id === themeId)
        .sort((a, b) => confidenceScore(b.confidence) - confidenceScore(a.confidence))
        .map((row) => row.evidence_id),
    ];

    let addedForTheme = 0;
    for (const evidenceId of candidates) {
      const before = evidenceIds.length;
      addUniqueId(evidenceIds, seen, evidenceId);
      if (evidenceIds.length > before) addedForTheme += 1;
      if (addedForTheme >= LINKED_EVIDENCE_PER_RECORD || evidenceIds.length >= limit) break;
    }
    if (evidenceIds.length >= limit) break;
  }

  return evidenceIds;
}

async function collectProblemEvidenceIds(input: {
  supabase: SupabaseLike;
  org_id: string;
  project_id: string;
  limit: number;
}) {
  const { supabase, org_id, project_id, limit } = input;
  const { data, error } = await supabase
    .from("problems")
    .select("id, severity, source_evidence_ids, created_at")
    .eq("org_id", org_id)
    .eq("project_id", project_id)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) throw new Error(`Failed to load problems for linked evidence: ${error.message}`);

  const severityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const problemRows = asRows<{
    id: string;
    severity: string | null;
    source_evidence_ids: string[] | null;
    created_at: string;
  }>(data).sort((a, b) => {
    const severityDelta =
      (severityOrder[a.severity ?? ""] ?? 99) - (severityOrder[b.severity ?? ""] ?? 99);
    if (severityDelta !== 0) return severityDelta;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const problemIds = problemRows.map((problem) => problem.id);
  if (problemIds.length === 0) return [];

  const { data: linkData, error: linkError } = await supabase
    .from("problem_evidence")
    .select("problem_id, evidence_id, relationship, review_state, confidence, created_at")
    .eq("org_id", org_id)
    .eq("project_id", project_id)
    .in("problem_id", problemIds)
    .in("review_state", [...VISIBLE_REVIEW_STATES]);

  if (linkError) {
    throw new Error(`Failed to load problem evidence links: ${linkError.message}`);
  }

  const typedRows = asRows<{
    problem_id: string;
    evidence_id: string;
    relationship: string | null;
    confidence: number | string | null;
    created_at: string | null;
  }>(linkData);

  const evidenceIds: string[] = [];
  const seen = new Set<string>();

  for (const problem of problemRows) {
    const candidates = [
      ...typedRows
        .filter((row) => row.problem_id === problem.id)
        .sort(compareEvidenceLinks)
        .map((row) => row.evidence_id),
      ...asStringArray(problem.source_evidence_ids),
    ];

    let addedForProblem = 0;
    for (const evidenceId of candidates) {
      const before = evidenceIds.length;
      addUniqueId(evidenceIds, seen, evidenceId);
      if (evidenceIds.length > before) addedForProblem += 1;
      if (addedForProblem >= LINKED_EVIDENCE_PER_RECORD || evidenceIds.length >= limit) break;
    }
    if (evidenceIds.length >= limit) break;
  }

  return evidenceIds;
}

async function collectOpportunityEvidenceIds(input: {
  supabase: SupabaseLike;
  org_id: string;
  project_id: string;
  limit: number;
}) {
  const { supabase, org_id, project_id, limit } = input;
  const { data, error } = await supabase
    .from("opportunities")
    .select("id, updated_at")
    .eq("org_id", org_id)
    .eq("project_id", project_id)
    .in("status", [...VISIBLE_OPPORTUNITY_STATUSES])
    .in("review_state", [...VISIBLE_REVIEW_STATES])
    .order("updated_at", { ascending: false })
    .limit(10);

  if (error) throw new Error(`Failed to load opportunities for linked evidence: ${error.message}`);

  const opportunityIds = asRows<{ id: string }>(data).map((opportunity) => opportunity.id);
  if (opportunityIds.length === 0) return [];

  const [directResult, problemLinksResult, themeLinksResult] = await Promise.all([
    supabase
      .from("opportunity_evidence")
      .select("opportunity_id, evidence_id, relationship, created_at")
      .eq("org_id", org_id)
      .eq("project_id", project_id)
      .in("opportunity_id", opportunityIds),
    supabase
      .from("problem_opportunities")
      .select("opportunity_id, problem_id, relationship, review_state, created_at")
      .eq("org_id", org_id)
      .eq("project_id", project_id)
      .in("opportunity_id", opportunityIds)
      .in("review_state", [...VISIBLE_REVIEW_STATES]),
    supabase
      .from("opportunity_themes")
      .select("opportunity_id, theme_id, relationship, created_at")
      .eq("org_id", org_id)
      .eq("project_id", project_id)
      .in("opportunity_id", opportunityIds),
  ]);

  if (directResult.error) {
    throw new Error(`Failed to load opportunity evidence links: ${directResult.error.message}`);
  }
  if (problemLinksResult.error) {
    throw new Error(`Failed to load opportunity problem links: ${problemLinksResult.error.message}`);
  }
  if (themeLinksResult.error) {
    throw new Error(`Failed to load opportunity theme links: ${themeLinksResult.error.message}`);
  }

  const directRows = asRows<{
    opportunity_id: string;
    evidence_id: string;
    relationship: string | null;
    created_at: string | null;
  }>(directResult.data);
  const problemLinks = asRows<{ opportunity_id: string; problem_id: string }>(problemLinksResult.data);
  const themeLinks = asRows<{ opportunity_id: string; theme_id: string }>(themeLinksResult.data);
  const problemIds = unique(problemLinks.map((link) => link.problem_id));
  const themeIds = unique(themeLinks.map((link) => link.theme_id));

  const [problemEvidenceResult, themeEvidenceResult] = await Promise.all([
    problemIds.length > 0
      ? supabase
          .from("problem_evidence")
          .select("problem_id, evidence_id, relationship, review_state, confidence, created_at")
          .eq("org_id", org_id)
          .eq("project_id", project_id)
          .in("problem_id", problemIds)
          .in("review_state", [...VISIBLE_REVIEW_STATES])
      : Promise.resolve({ data: [], error: null }),
    themeIds.length > 0
      ? supabase
          .from("theme_evidence")
          .select("theme_id, evidence_id, relationship, review_state, confidence, created_at")
          .eq("org_id", org_id)
          .eq("project_id", project_id)
          .in("theme_id", themeIds)
          .in("review_state", [...VISIBLE_REVIEW_STATES])
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (problemEvidenceResult.error) {
    throw new Error(
      `Failed to load opportunity-linked problem evidence: ${problemEvidenceResult.error.message}`
    );
  }
  if (themeEvidenceResult.error) {
    throw new Error(
      `Failed to load opportunity-linked theme evidence: ${themeEvidenceResult.error.message}`
    );
  }

  const problemEvidenceRows = asRows<{
    problem_id: string;
    evidence_id: string;
    relationship: string | null;
    confidence: number | string | null;
    created_at: string | null;
  }>(problemEvidenceResult.data);
  const themeEvidenceRows = asRows<{
    theme_id: string;
    evidence_id: string;
    relationship: string | null;
    confidence: number | string | null;
    created_at: string | null;
  }>(themeEvidenceResult.data);

  const evidenceIds: string[] = [];
  const seen = new Set<string>();

  for (const opportunityId of opportunityIds) {
    const linkedProblemIds = problemLinks
      .filter((link) => link.opportunity_id === opportunityId)
      .map((link) => link.problem_id);
    const linkedThemeIds = themeLinks
      .filter((link) => link.opportunity_id === opportunityId)
      .map((link) => link.theme_id);
    const candidates = [
      ...directRows
        .filter((row) => row.opportunity_id === opportunityId)
        .sort(compareEvidenceLinks)
        .map((row) => row.evidence_id),
      ...problemEvidenceRows
        .filter((row) => linkedProblemIds.includes(row.problem_id))
        .sort(compareEvidenceLinks)
        .map((row) => row.evidence_id),
      ...themeEvidenceRows
        .filter((row) => linkedThemeIds.includes(row.theme_id))
        .sort(compareEvidenceLinks)
        .map((row) => row.evidence_id),
    ];

    let addedForOpportunity = 0;
    for (const evidenceId of candidates) {
      const before = evidenceIds.length;
      addUniqueId(evidenceIds, seen, evidenceId);
      if (evidenceIds.length > before) addedForOpportunity += 1;
      if (addedForOpportunity >= LINKED_EVIDENCE_PER_RECORD || evidenceIds.length >= limit) break;
    }
    if (evidenceIds.length >= limit) break;
  }

  return evidenceIds;
}

export async function loadAskStructuralLinkedEvidence(input: {
  supabase: SupabaseLike;
  org_id: string;
  project_id: string;
  intent: AskStructuralIntent;
  trust_scope: TrustScope | "include_pending" | "all";
  limit?: number;
}): Promise<EvidenceRecord[]> {
  const { supabase, org_id, project_id, intent, trust_scope, limit = 20 } = input;
  if (!shouldLoadLinkedEvidenceForStructuralIntent(intent)) return [];

  const evidenceIds: string[] = [];
  const seen = new Set<string>();

  const collectors = await Promise.all([
    intent.focuses.includes("problems")
      ? collectProblemEvidenceIds({ supabase, org_id, project_id, limit })
      : Promise.resolve([]),
    intent.focuses.includes("themes")
      ? collectThemeEvidenceIds({ supabase, org_id, project_id, limit })
      : Promise.resolve([]),
    intent.focuses.includes("opportunities")
      ? collectOpportunityEvidenceIds({ supabase, org_id, project_id, limit })
      : Promise.resolve([]),
  ]);

  for (const ids of collectors) {
    for (const evidenceId of ids) {
      addUniqueId(evidenceIds, seen, evidenceId);
      if (evidenceIds.length >= limit) break;
    }
    if (evidenceIds.length >= limit) break;
  }

  return loadEvidenceRecordsByIds({
    supabase,
    org_id,
    project_id,
    evidenceIds,
    trust_scope,
  });
}

export function detectAskStructuralIntent(question: string): AskStructuralIntent | null {
  const focuses = FOCUS_PATTERNS.filter(([, pattern]) => pattern.test(question)).map(
    ([focus]) => focus
  );

  if (focuses.length === 0) return null;
  if (!STRUCTURAL_VERB_RE.test(question) && focuses.length === 1 && focuses[0] === "actions") {
    return null;
  }

  return {
    focuses: unique(focuses),
    needsEvidence: EVIDENCE_REQUEST_RE.test(question),
  };
}

export async function loadAskStructuralContext(input: {
  supabase: SupabaseLike;
  org_id: string;
  project_id: string;
  intent: AskStructuralIntent;
}): Promise<AskStructuralContext> {
  const { supabase, org_id, project_id, intent } = input;
  const wants = (focus: StructuralFocus) => intent.focuses.includes(focus);
  const lines: string[] = [
    "Project registry context. These are DiscOS app records, not raw source quotes.",
  ];
  let hasData = false;

  const countTasks = intent.focuses.map(async (focus) => {
    const table = focus === "artifacts" ? "artifacts" : focus;
    return [focus, await scopedCount({ supabase, table, org_id, project_id })] as const;
  });
  const counts = new Map(await Promise.all(countTasks));

  lines.push(
    `Counts: ${intent.focuses
      .map((focus) => `${focus}=${counts.get(focus) ?? 0}`)
      .join(", ")}.`
  );

  if (wants("topics")) {
    const { data, error } = await supabase
      .from("topics")
      .select("id, label, description, review_state, source, updated_at")
      .eq("org_id", org_id)
      .eq("project_id", project_id)
      .in("review_state", [...VISIBLE_REVIEW_STATES])
      .order("updated_at", { ascending: false })
      .limit(20);

    if (error) throw new Error(`Failed to load topics: ${error.message}`);
    const rows = asRows<{
      id: string;
      label: string;
      description: string | null;
      review_state: string;
      source: string;
    }>(data);
    hasData ||= rows.length > 0;
    lines.push("\nTOPICS / CODES:");
    lines.push(
      rows.length > 0
        ? rows.map((row, index) => `T${index + 1}. ${row.label} (${row.review_state}, ${row.source})${row.description ? `: ${truncate(row.description)}` : ""}`).join("\n")
        : "No visible topics yet."
    );
  }

  if (wants("themes")) {
    const { data, error } = await supabase
      .from("themes")
      .select(
        "id, label, description, evidence_count, central_concept, interpretation, status, review_state, confidence"
      )
      .eq("org_id", org_id)
      .eq("project_id", project_id)
      .in("review_state", [...VISIBLE_REVIEW_STATES])
      .order("evidence_count", { ascending: false })
      .limit(20);

    if (error) throw new Error(`Failed to load themes: ${error.message}`);
    const rows = asRows<{
      id: string;
      label: string;
      description: string | null;
      evidence_count: number | null;
      central_concept: string | null;
      interpretation: string | null;
      status: string | null;
      review_state: string | null;
      confidence: string | null;
    }>(data);
    const themeIds = rows.map((row) => row.id);
    const [evidenceLinksResult, topicLinksResult] = await Promise.all([
      themeIds.length > 0
        ? supabase
            .from("theme_evidence")
            .select("theme_id")
            .eq("org_id", org_id)
            .eq("project_id", project_id)
            .in("theme_id", themeIds)
            .in("review_state", [...VISIBLE_REVIEW_STATES])
        : Promise.resolve({ data: [], error: null }),
      themeIds.length > 0
        ? supabase
            .from("theme_topics")
            .select("theme_id")
            .eq("org_id", org_id)
            .eq("project_id", project_id)
            .in("theme_id", themeIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (evidenceLinksResult.error) {
      throw new Error(`Failed to load theme evidence links: ${evidenceLinksResult.error.message}`);
    }
    if (topicLinksResult.error) {
      throw new Error(`Failed to load theme topic links: ${topicLinksResult.error.message}`);
    }

    const evidenceCounts = countBy(asRows<{ theme_id: string }>(evidenceLinksResult.data), "theme_id");
    const topicCounts = countBy(asRows<{ theme_id: string }>(topicLinksResult.data), "theme_id");

    hasData ||= rows.length > 0;
    lines.push("\nTHEMES:");
    lines.push(
      rows.length > 0
        ? rows
            .map((row, index) => {
              const concept = row.central_concept ?? row.description ?? row.interpretation;
              return `TH${index + 1}. ${row.label} (${row.status ?? "draft"}, ${row.review_state ?? "suggested"}, confidence ${row.confidence ?? "unknown"}, ${countFor(evidenceCounts, row.id) || row.evidence_count || 0} evidence links, ${countFor(topicCounts, row.id)} topic links): ${truncate(concept)}`;
            })
            .join("\n")
        : "No visible themes yet."
    );
  }

  if (wants("problems")) {
    const { data, error } = await supabase
      .from("problems")
      .select(
        "id, title, description, statement, status, severity, confidence, review_state, who_affected, what_is_hard, why_it_matters, current_workarounds, current_tools, source_theme_ids, source_evidence_ids, created_at"
      )
      .eq("org_id", org_id)
      .eq("project_id", project_id)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) throw new Error(`Failed to load problems: ${error.message}`);
    const rows = asRows<{
      id: string;
      title: string;
      description: string | null;
      statement: string | null;
      status: string | null;
      severity: string | null;
      confidence: string | null;
      review_state: string | null;
      who_affected: string | null;
      what_is_hard: string | null;
      why_it_matters: string | null;
      current_workarounds: string[] | null;
      current_tools: string[] | null;
      source_theme_ids: string[] | null;
      source_evidence_ids: string[] | null;
    }>(data);
    const problemIds = rows.map((row) => row.id);
    const [topicLinksResult] = await Promise.all([
      problemIds.length > 0
        ? supabase
            .from("problem_topics")
            .select("problem_id")
            .eq("org_id", org_id)
            .eq("project_id", project_id)
            .in("problem_id", problemIds)
            .in("review_state", [...VISIBLE_REVIEW_STATES])
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (topicLinksResult.error) {
      throw new Error(`Failed to load problem topic links: ${topicLinksResult.error.message}`);
    }

    const topicCounts = countBy(asRows<{ problem_id: string }>(topicLinksResult.data), "problem_id");

    hasData ||= rows.length > 0;
    lines.push("\nPROBLEMS:");
    lines.push(
      rows.length > 0
        ? rows
            .map((row, index) => {
              const statement = row.statement ?? row.description;
              const evidenceCount = asStringArray(row.source_evidence_ids).length;
              const themeCount = asStringArray(row.source_theme_ids).length;
              return [
                `P${index + 1}. ${row.title} (${row.status ?? "surfaced"}, ${row.severity ?? "severity unknown"}, confidence ${row.confidence ?? "unknown"}, ${evidenceCount} evidence links, ${themeCount} theme links, ${countFor(topicCounts, row.id)} topic links)`,
                statement ? `   Statement: ${truncate(statement)}` : null,
                row.who_affected ? `   Who: ${truncate(row.who_affected)}` : null,
                row.what_is_hard ? `   Hard part: ${truncate(row.what_is_hard)}` : null,
                row.why_it_matters ? `   Why it matters: ${truncate(row.why_it_matters)}` : null,
                `   Current tools: ${formatList(row.current_tools)}`,
                `   Workarounds: ${formatList(row.current_workarounds)}`,
              ].filter(Boolean).join("\n");
            })
            .join("\n")
        : "No visible problems yet."
    );
  }

  if (wants("opportunities")) {
    const { data, error } = await supabase
      .from("opportunities")
      .select("id, title, description, how_might_we, status, confidence, review_state, updated_at")
      .eq("org_id", org_id)
      .eq("project_id", project_id)
      .in("status", [...VISIBLE_OPPORTUNITY_STATUSES])
      .in("review_state", [...VISIBLE_REVIEW_STATES])
      .order("updated_at", { ascending: false })
      .limit(20);

    if (error) throw new Error(`Failed to load opportunities: ${error.message}`);
    const rows = asRows<{
      id: string;
      title: string;
      description: string | null;
      how_might_we: string | null;
      status: string;
      confidence: string;
      review_state: string;
    }>(data);
    const opportunityIds = rows.map((row) => row.id);
    const [problemLinksResult, evidenceLinksResult, themeLinksResult] = await Promise.all([
      opportunityIds.length > 0
        ? supabase
            .from("problem_opportunities")
            .select("opportunity_id")
            .eq("org_id", org_id)
            .eq("project_id", project_id)
            .in("opportunity_id", opportunityIds)
            .in("review_state", [...VISIBLE_REVIEW_STATES])
        : Promise.resolve({ data: [], error: null }),
      opportunityIds.length > 0
        ? supabase
            .from("opportunity_evidence")
            .select("opportunity_id")
            .eq("org_id", org_id)
            .eq("project_id", project_id)
            .in("opportunity_id", opportunityIds)
        : Promise.resolve({ data: [], error: null }),
      opportunityIds.length > 0
        ? supabase
            .from("opportunity_themes")
            .select("opportunity_id")
            .eq("org_id", org_id)
            .eq("project_id", project_id)
            .in("opportunity_id", opportunityIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (problemLinksResult.error) {
      throw new Error(`Failed to load opportunity problem links: ${problemLinksResult.error.message}`);
    }
    if (evidenceLinksResult.error) {
      throw new Error(`Failed to load opportunity evidence links: ${evidenceLinksResult.error.message}`);
    }
    if (themeLinksResult.error) {
      throw new Error(`Failed to load opportunity theme links: ${themeLinksResult.error.message}`);
    }

    const problemCounts = countBy(asRows<{ opportunity_id: string }>(problemLinksResult.data), "opportunity_id");
    const evidenceCounts = countBy(asRows<{ opportunity_id: string }>(evidenceLinksResult.data), "opportunity_id");
    const themeCounts = countBy(asRows<{ opportunity_id: string }>(themeLinksResult.data), "opportunity_id");

    hasData ||= rows.length > 0;
    lines.push("\nOPPORTUNITIES:");
    lines.push(
      rows.length > 0
        ? rows
            .map((row, index) => {
              const framing = row.how_might_we ?? row.description;
              return `O${index + 1}. ${row.title} (${row.status}, confidence ${row.confidence}, ${countFor(problemCounts, row.id)} problem links, ${countFor(evidenceCounts, row.id)} evidence links, ${countFor(themeCounts, row.id)} theme links): ${truncate(framing)}`;
            })
            .join("\n")
        : "No visible opportunities yet."
    );
  }

  if (wants("actions")) {
    const { data, error } = await supabase
      .from("actions")
      .select("id, description, owner, due_note, status, created_at")
      .eq("org_id", org_id)
      .eq("project_id", project_id)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) throw new Error(`Failed to load actions: ${error.message}`);
    const rows = asRows<{
      description: string;
      owner: string | null;
      due_note: string | null;
      status: string;
    }>(data);
    hasData ||= rows.length > 0;
    lines.push("\nACTIONS:");
    lines.push(
      rows.length > 0
        ? rows
            .map(
              (row, index) =>
                `A${index + 1}. ${truncate(row.description)} (${row.status}, owner ${row.owner ?? "unassigned"}, due ${row.due_note ?? "not set"})`
            )
            .join("\n")
        : "No actions yet."
    );
  }

  if (wants("artifacts")) {
    const { data, error } = await supabase
      .from("artifacts")
      .select("id, title, type, verification_status, created_at, updated_at")
      .eq("org_id", org_id)
      .eq("project_id", project_id)
      .order("updated_at", { ascending: false })
      .limit(20);

    if (error) throw new Error(`Failed to load artifacts: ${error.message}`);
    const rows = asRows<{
      title: string;
      type: string;
      verification_status: string;
    }>(data);
    hasData ||= rows.length > 0;
    lines.push("\nARTIFACTS:");
    lines.push(
      rows.length > 0
        ? rows
            .map(
              (row, index) =>
                `AR${index + 1}. ${row.title} (${row.type}, verification ${row.verification_status})`
            )
            .join("\n")
        : "No artifacts yet."
    );
  }

  return {
    intent,
    text: lines.join("\n"),
    hasData,
  };
}
