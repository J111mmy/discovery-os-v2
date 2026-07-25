import type { createClient } from "@/lib/supabase/server";
import type { EvidenceRecord } from "@/types/database";
import type {
  AskCorpusFacts,
  AskCorpusSourceBreakdown,
  AskCoverage,
  AskRetrievalMode,
} from "@/types/ask";

type UserScopedSupabase = Awaited<ReturnType<typeof createClient>>;
type AskTrustScope = "trusted" | "include_pending";

type AskCorpusFactsRow = Omit<AskCorpusFacts, "source_breakdown"> & {
  source_breakdown: unknown;
};

const CORPUS_QUESTION_PATTERNS = [
  /\bhow many\b/i,
  /\bparticipants?\b/i,
  /\brespondents?\b/i,
  /\binterviews?\b/i,
  /\bsources?\b/i,
  /\bcorpus\b/i,
  /\bsample size\b/i,
  /\bcoverage\b/i,
  /\bacross (?:the )?(?:project|research|sources|interviews|evidence)\b/i,
  /\boverall\b/i,
  /\bevery (?:source|interview|participant|respondent)\b/i,
  /\beach (?:source|interview|participant|respondent)\b/i,
  /\ball (?:sources|interviews|participants|respondents|evidence)\b/i,
  /\bmost (?:common|frequent|mentioned|reported)\b/i,
  /\bmajority\b/i,
  /\bfrequency\b/i,
  /\brepresentative\b/i,
  /\bgeneralis(?:e|a)ble\b/i,
];

const PARTICIPANT_COUNT_CAVEAT =
  "Structured participant counts depend on entity resolution and may change when duplicate or unresolved people are reconciled (GitHub #158). Source coverage is the reliable corpus measure.";

function integer(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return Number.parseInt(value, 10);
  return 0;
}

function parseSourceBreakdown(value: unknown): AskCorpusSourceBreakdown[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object"))
    .map((row) => ({
      source_id: typeof row.source_id === "string" ? row.source_id : "",
      source_title: typeof row.source_title === "string" ? row.source_title : "Untitled source",
      total_evidence: integer(row.total_evidence),
      trusted_evidence: integer(row.trusted_evidence),
      pending_evidence: integer(row.pending_evidence),
      excluded_evidence: integer(row.excluded_evidence),
      disputed_evidence: integer(row.disputed_evidence),
    }))
    .filter((row) => row.source_id.length > 0);
}

export function isCorpusQuestion(question: string) {
  return CORPUS_QUESTION_PATTERNS.some((pattern) => pattern.test(question));
}

export async function loadAskCorpusFacts(input: {
  supabase: UserScopedSupabase;
  org_id: string;
  project_id: string;
}): Promise<AskCorpusFacts> {
  const { data, error } = await input.supabase.rpc("ask_corpus_facts", {
    p_org_id: input.org_id,
    p_project_id: input.project_id,
  });

  if (error) throw new Error(`Ask corpus facts failed: ${error.message}`);

  const row = (Array.isArray(data) ? data[0] : data) as AskCorpusFactsRow | null;
  if (!row) {
    return {
      total_sources: 0,
      evidence_bearing_sources: 0,
      total_evidence: 0,
      trusted_evidence: 0,
      pending_evidence: 0,
      excluded_evidence: 0,
      disputed_evidence: 0,
      structured_participants: 0,
      source_breakdown: [],
    };
  }

  return {
    total_sources: integer(row.total_sources),
    evidence_bearing_sources: integer(row.evidence_bearing_sources),
    total_evidence: integer(row.total_evidence),
    trusted_evidence: integer(row.trusted_evidence),
    pending_evidence: integer(row.pending_evidence),
    excluded_evidence: integer(row.excluded_evidence),
    disputed_evidence: integer(row.disputed_evidence),
    structured_participants: integer(row.structured_participants),
    source_breakdown: parseSourceBreakdown(row.source_breakdown),
  };
}

export function buildAskCoverage(input: {
  facts: AskCorpusFacts;
  retrieved: EvidenceRecord[];
  trust_scope: AskTrustScope;
  retrieval_mode: AskRetrievalMode;
}): AskCoverage {
  const readableForSource = (source: AskCorpusSourceBreakdown) =>
    source.trusted_evidence +
    (input.trust_scope === "include_pending" ? source.pending_evidence : 0);
  const readableRecords =
    input.facts.trusted_evidence +
    (input.trust_scope === "include_pending" ? input.facts.pending_evidence : 0);

  return {
    retrieval_mode: input.retrieval_mode,
    retrieved_records: input.retrieved.length,
    readable_records: readableRecords,
    retrieved_sources: new Set(input.retrieved.map((record) => record.source_id).filter(Boolean)).size,
    readable_sources: input.facts.source_breakdown.filter((source) => readableForSource(source) > 0)
      .length,
    evidence_bearing_sources: input.facts.evidence_bearing_sources,
    total_sources: input.facts.total_sources,
    trust_breakdown: {
      trusted: input.facts.trusted_evidence,
      pending: input.facts.pending_evidence,
      excluded: input.facts.excluded_evidence,
      disputed: input.facts.disputed_evidence,
    },
    structured_participants: input.facts.structured_participants,
    participant_count_caveat: PARTICIPANT_COUNT_CAVEAT,
  };
}

export function formatAskCorpusFacts(input: {
  facts: AskCorpusFacts;
  coverage: AskCoverage;
}) {
  const sourceRows =
    input.facts.source_breakdown.length > 0
      ? input.facts.source_breakdown
          .map(
            (source) =>
              `- ${source.source_title}: ${source.total_evidence} total ` +
              `(${source.trusted_evidence} trusted, ${source.pending_evidence} pending, ` +
              `${source.excluded_evidence} excluded, ${source.disputed_evidence} disputed)`
          )
          .join("\n")
      : "- No sources are recorded.";

  return [
    `Total sources: ${input.facts.total_sources}`,
    `Sources with Ask-eligible evidence: ${input.facts.evidence_bearing_sources}`,
    `Total Ask-eligible evidence records: ${input.facts.total_evidence}`,
    `Ask-readable evidence under the selected trust filter: ${input.coverage.readable_records}`,
    `Trust breakdown: ${input.facts.trusted_evidence} trusted, ${input.facts.pending_evidence} pending, ${input.facts.excluded_evidence} excluded, ${input.facts.disputed_evidence} disputed`,
    `Structured non-internal participant records: ${input.facts.structured_participants}`,
    `Participant-count caveat: ${input.coverage.participant_count_caveat}`,
    `Retrieved answer slice: ${input.coverage.retrieved_records} records from ${input.coverage.retrieved_sources} sources`,
    `Readable source pool under the selected trust filter: ${input.coverage.readable_sources}`,
    "",
    "Per-source evidence counts:",
    sourceRows,
  ].join("\n");
}
