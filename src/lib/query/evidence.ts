// Evidence query — semantic similarity search with org_id guard
import { createServiceClient } from "@/lib/supabase/server";
import { embed } from "@/lib/llm/client";
import type { TrustScope, EvidenceRecord } from "@/types/database";
import {
  recordMatchesSpeakerTargets,
  speakerMatchesTargets,
  type SpeakerResolution,
} from "@/lib/speakers/resolve";
import { filterAdjacentProjectHintedEvidence } from "@/lib/evidence/adjacent-project";
import { hydrateEvidenceRecordsWithTypedTopics } from "@/lib/research-ontology/evidence-topics";
import { hydrateEvidenceRecordsWithTags } from "@/lib/research-ontology/evidence-tags";

export interface EvidenceQueryOptions {
  org_id: string;
  project_id: string;
  q: string;
  limit?: number;
  trust_scope?: TrustScope | "include_pending" | "all";
  speaker_resolution?: SpeakerResolution | null;
}

export interface EvidenceQueryResult {
  records: EvidenceRecord[];
  query: string;
}

export async function queryEvidence(
  opts: EvidenceQueryOptions
): Promise<EvidenceQueryResult> {
  const {
    org_id,
    project_id,
    q,
    limit = 18,
    trust_scope = "trusted",
    speaker_resolution = null,
  } = opts;

  const supabase = createServiceClient();
  const embedding = await embed(q);
  const embeddingStr = `[${embedding.join(",")}]`;
  const speakerTargeted = Boolean(speaker_resolution?.targeted);
  const retrievalLimit = speakerTargeted ? Math.max(limit * 4, 60) : Math.max(limit * 3, 30);

  // Build trust filter
  const trustFilter =
    trust_scope === "include_pending"
      ? ["trusted", "pending"]
      : trust_scope === "all"
      ? ["trusted", "pending", "disputed", "excluded"]
      : [trust_scope];

  // pgvector cosine similarity — ALWAYS filter by org_id first
  const { data, error } = await supabase.rpc("match_evidence", {
    p_org_id: org_id,
    p_project_id: project_id,
    p_embedding: embeddingStr,
    p_trust_scopes: trustFilter,
    p_limit: retrievalLimit,
  });

  if (error) throw new Error(`Evidence query failed: ${error.message}`);

  let records = (data ?? []) as EvidenceRecord[];
  await hydrateEvidenceRecords({ supabase, org_id, project_id, records });
  records = filterAdjacentProjectHintedEvidence(records);

  if (speakerTargeted) {
    const semanticSpeakerRecords = records.filter((record) =>
      recordMatchesSpeakerTargets(record, speaker_resolution)
    );
    const directSpeakerRecords =
      semanticSpeakerRecords.length < limit
        ? await queryEvidenceBySpeaker({
            supabase,
            org_id,
            project_id,
            trustFilter,
            speaker_resolution,
            limit: Math.max(limit * 3, 40),
            excludeIds: new Set(semanticSpeakerRecords.map((record) => record.id)),
          })
        : [];

    const seen = new Set<string>();
    records = [...semanticSpeakerRecords, ...directSpeakerRecords]
      .filter((record) => {
        if (!record.id || seen.has(record.id)) return false;
        seen.add(record.id);
        return true;
      })
      .slice(0, limit);
  } else {
    records = records.slice(0, limit);
  }

  return { records, query: q };
}

async function hydrateEvidenceRecords(input: {
  supabase: ReturnType<typeof createServiceClient>;
  org_id: string;
  project_id: string;
  records: EvidenceRecord[];
}) {
  const { supabase, org_id, project_id, records } = input;
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

  await hydrateEvidenceRecordsWithTypedTopics({
    supabase,
    orgId: org_id,
    projectId: project_id,
    records,
  });
  await hydrateEvidenceRecordsWithTags({
    supabase,
    orgId: org_id,
    projectId: project_id,
    records,
  });

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
}

async function queryEvidenceBySpeaker(input: {
  supabase: ReturnType<typeof createServiceClient>;
  org_id: string;
  project_id: string;
  trustFilter: string[];
  speaker_resolution: SpeakerResolution | null;
  limit: number;
  excludeIds: Set<string>;
}) {
  const { supabase, org_id, project_id, trustFilter, speaker_resolution, limit, excludeIds } = input;
  if (!speaker_resolution?.targeted) return [];

  const { data: sources, error: sourcesError } = await supabase
    .from("sources")
    .select("id")
    .eq("org_id", org_id)
    .eq("project_id", project_id);

  if (sourcesError) throw new Error(`Speaker evidence source lookup failed: ${sourcesError.message}`);

  const sourceIds = ((sources ?? []) as Array<{ id: string }>).map((source) => source.id);
  if (sourceIds.length === 0) return [];

  const { data: segments, error: segmentsError } = await supabase
    .from("source_segments")
    .select("id, speaker")
    .eq("org_id", org_id)
    .in("source_id", sourceIds)
    .not("speaker", "is", null);

  if (segmentsError) throw new Error(`Speaker evidence segment lookup failed: ${segmentsError.message}`);

  const segmentIds = ((segments ?? []) as Array<{ id: string; speaker: string | null }>)
    .filter((segment) => speakerMatchesTargets(segment.speaker, speaker_resolution))
    .map((segment) => segment.id);

  if (segmentIds.length === 0) return [];

  const { data: evidence, error: evidenceError } = await supabase
    .from("evidence")
    .select(
      "id, org_id, project_id, source_id, segment_id, content, trust_scope, trust_scope_source, summary, classification, sentiment, themes, metadata, ai_trust_grade, ai_trust_reason, ai_graded_at, created_at"
    )
    .eq("org_id", org_id)
    .eq("project_id", project_id)
    .in("trust_scope", trustFilter)
    .in("segment_id", segmentIds)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (evidenceError) throw new Error(`Speaker evidence lookup failed: ${evidenceError.message}`);

  const records = ((evidence ?? []) as EvidenceRecord[]).filter(
    (record) => !excludeIds.has(record.id)
  );
  await hydrateEvidenceRecords({ supabase, org_id, project_id, records });

  return filterAdjacentProjectHintedEvidence(records).filter((record) =>
    recordMatchesSpeakerTargets(record, speaker_resolution)
  );
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
