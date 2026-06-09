// Evidence query — semantic similarity search with org_id guard
import { createServiceClient } from "@/lib/supabase/server";
import { embed } from "@/lib/llm/client";
import type { TrustScope, EvidenceRecord } from "@/types/database";

export interface EvidenceQueryOptions {
  org_id: string;
  project_id: string;
  q: string;
  limit?: number;
  trust_scope?: TrustScope | "include_pending" | "all";
}

export interface EvidenceQueryResult {
  records: EvidenceRecord[];
  query: string;
}

function providerFailureMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function providerFailureStatus(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { status?: unknown; code?: unknown };
  if (typeof candidate.status === "number") return candidate.status;
  if (typeof candidate.code === "number") return candidate.code;
  return null;
}

function canFallbackFromEmbeddingError(error: unknown) {
  const status = providerFailureStatus(error);
  if (status === 429 || (status !== null && status >= 500 && status <= 504)) return true;

  const message = providerFailureMessage(error).toLowerCase();
  return (
    message.includes("quota") ||
    message.includes("rate limit") ||
    message.includes("billing") ||
    message.includes("overloaded") ||
    message.includes("capacity") ||
    message.includes("api key") ||
    message.includes("not configured") ||
    message.includes("missing")
  );
}

function tokenizeQuery(query: string) {
  const stopWords = new Set([
    "about",
    "after",
    "again",
    "also",
    "because",
    "before",
    "being",
    "could",
    "draft",
    "from",
    "have",
    "into",
    "meeting",
    "next",
    "page",
    "pages",
    "presenting",
    "should",
    "slide",
    "slides",
    "that",
    "their",
    "there",
    "these",
    "they",
    "this",
    "through",
    "want",
    "what",
    "when",
    "where",
    "which",
    "with",
    "would",
  ]);

  const terms = query
    .toLowerCase()
    .match(/[a-z0-9]{3,}/g)
    ?.filter((term) => !stopWords.has(term));

  return Array.from(new Set(terms ?? [])).slice(0, 12);
}

function scoreEvidence(record: Partial<EvidenceRecord>, terms: string[]) {
  if (terms.length === 0) return 0;

  const haystack = [
    record.content,
    record.summary,
    record.classification,
    record.sentiment,
    record.themes?.join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

async function fallbackQueryEvidence(opts: {
  org_id: string;
  project_id: string;
  q: string;
  limit: number;
  trustFilter: string[];
}): Promise<EvidenceRecord[]> {
  const supabase = createServiceClient();
  const fetchLimit = Math.min(Math.max(opts.limit * 6, 60), 200);

  const { data, error } = await supabase
    .from("evidence")
    .select(
      "id, org_id, project_id, content, summary, themes, trust_scope, classification, sentiment, source_id, segment_id, metadata, created_at, ai_trust_grade, ai_trust_reason, ai_graded_at"
    )
    .eq("org_id", opts.org_id)
    .eq("project_id", opts.project_id)
    .in("trust_scope", opts.trustFilter)
    .order("created_at", { ascending: false })
    .limit(fetchLimit);

  if (error) throw new Error(`Evidence fallback query failed: ${error.message}`);

  const terms = tokenizeQuery(opts.q);
  return ((data ?? []) as EvidenceRecord[])
    .map((record) => ({ record, score: scoreEvidence(record, terms) }))
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return String(b.record.created_at ?? "").localeCompare(String(a.record.created_at ?? ""));
    })
    .slice(0, opts.limit)
    .map(({ record }) => record);
}

export async function queryEvidence(
  opts: EvidenceQueryOptions
): Promise<EvidenceQueryResult> {
  const { org_id, project_id, q, limit = 18, trust_scope = "trusted" } = opts;

  const supabase = createServiceClient();
  // Build trust filter
  const trustFilter =
    trust_scope === "include_pending"
      ? ["trusted", "pending"]
      : trust_scope === "all"
      ? ["trusted", "pending", "disputed", "excluded"]
      : [trust_scope];

  let records: EvidenceRecord[];

  try {
    const embedding = await embed(q);
    const embeddingStr = `[${embedding.join(",")}]`;

    // pgvector cosine similarity — ALWAYS filter by org_id first
    const { data, error } = await supabase.rpc("match_evidence", {
      p_org_id: org_id,
      p_project_id: project_id,
      p_embedding: embeddingStr,
      p_trust_scopes: trustFilter,
      p_limit: limit,
    });

    if (error) throw new Error(`Evidence query failed: ${error.message}`);

    records = (data ?? []) as EvidenceRecord[];
  } catch (error) {
    if (!canFallbackFromEmbeddingError(error)) throw error;

    records = await fallbackQueryEvidence({
      org_id,
      project_id,
      q,
      limit,
      trustFilter,
    });
  }

  const recordIds = records.map((record) => record.id).filter(Boolean);
  const sourceIds = Array.from(new Set(records.map((record) => record.source_id).filter(Boolean)));
  const segmentIds = Array.from(
    new Set(records.map((record) => record.segment_id).filter(Boolean))
  ) as string[];

  if (recordIds.length > 0) {
    const { data: evidenceRows } = await supabase
      .from("evidence")
      .select("id, org_id, project_id, classification, sentiment, ai_trust_grade, ai_trust_reason, ai_graded_at")
      .eq("org_id", org_id)
      .eq("project_id", project_id)
      .in("id", recordIds);

    const evidenceById = new Map(
      ((evidenceRows ?? []) as Partial<EvidenceRecord>[]).map((record) => [record.id, record])
    );

    records.forEach((record) => {
      const fullRecord = evidenceById.get(record.id);
      if (fullRecord) {
        record.org_id = fullRecord.org_id ?? org_id;
        record.project_id = fullRecord.project_id ?? project_id;
        record.classification = fullRecord.classification ?? null;
        record.sentiment = fullRecord.sentiment ?? null;
        record.ai_trust_grade = fullRecord.ai_trust_grade ?? null;
        record.ai_trust_reason = fullRecord.ai_trust_reason ?? null;
        record.ai_graded_at = fullRecord.ai_graded_at ?? null;
      }
    });
  }

  if (sourceIds.length > 0) {
    const { data: sources } = await supabase
      .from("sources")
      .select("id, org_id, title, type")
      .eq("org_id", org_id)
      .in("id", sourceIds);

    const sourceRows = (sources ?? []) as Array<{ id: string; title: string; type: string }>;
    const sourceById = new Map<string, { id: string; title: string; type: string }>(
      sourceRows.map((source) => [source.id, source])
    );

    records.forEach((record) => {
      const source = sourceById.get(record.source_id);
      if (source) {
        record.source_title = source.title;
        record.source_type = source.type as EvidenceRecord["source_type"];
      }
    });
  }

  if (segmentIds.length > 0) {
    const { data: segments } = await supabase
      .from("source_segments")
      .select("id, org_id, speaker, segment_index")
      .eq("org_id", org_id)
      .in("id", segmentIds);

    const segmentRows = (segments ?? []) as Array<{
      id: string;
      speaker: string | null;
      segment_index: number;
    }>;
    const segmentById = new Map(segmentRows.map((segment) => [segment.id, segment]));

    records.forEach((record) => {
      const segment = record.segment_id ? segmentById.get(record.segment_id) : null;
      if (segment) {
        record.segment_speaker = segment.speaker;
        record.segment_index = segment.segment_index;
      }
    });
  }

  return { records, query: q };
}

// Dual-query: semantic on the prompt + broad recall on project name
// Merges results, deduplicates, semantic hits first
export async function dualQueryEvidence(opts: {
  org_id: string;
  project_id: string;
  project_name: string;
  prompt: string;
  limit?: number;
}): Promise<EvidenceRecord[]> {
  const { org_id, project_id, project_name, prompt, limit = 18 } = opts;

  const [semantic, broad] = await Promise.all([
    queryEvidence({ org_id, project_id, q: prompt, limit, trust_scope: "trusted" }),
    queryEvidence({ org_id, project_id, q: project_name, limit: 10, trust_scope: "trusted" }),
  ]);

  const seen = new Set<string>();
  const merged: EvidenceRecord[] = [];

  for (const r of [...semantic.records, ...broad.records]) {
    if (r.id && !seen.has(r.id)) {
      seen.add(r.id);
      merged.push(r);
      if (merged.length >= 22) break;
    }
  }

  return merged;
}
