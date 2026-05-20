// Evidence query — semantic similarity search with org_id guard
import { createServiceClient } from "@/lib/supabase/server";
import { embed } from "@/lib/llm/client";
import type { TrustScope, EvidenceRecord } from "@/types/database";

export interface EvidenceQueryOptions {
  org_id: string;
  project_id: string;
  q: string;
  limit?: number;
  trust_scope?: TrustScope | "include_pending";
}

export interface EvidenceQueryResult {
  records: EvidenceRecord[];
  query: string;
}

export async function queryEvidence(
  opts: EvidenceQueryOptions
): Promise<EvidenceQueryResult> {
  const { org_id, project_id, q, limit = 18, trust_scope = "trusted" } = opts;

  const supabase = createServiceClient();
  const embedding = await embed(q);
  const embeddingStr = `[${embedding.join(",")}]`;

  // Build trust filter
  const trustFilter =
    trust_scope === "include_pending"
      ? ["trusted", "pending"]
      : [trust_scope];

  // pgvector cosine similarity — ALWAYS filter by org_id first
  const { data, error } = await supabase.rpc("match_evidence", {
    p_org_id: org_id,
    p_project_id: project_id,
    p_embedding: embeddingStr,
    p_trust_scopes: trustFilter,
    p_limit: limit,
  });

  if (error) throw new Error(`Evidence query failed: ${error.message}`);

  const records = (data ?? []) as EvidenceRecord[];
  const sourceIds = Array.from(new Set(records.map((record) => record.source_id).filter(Boolean)));

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
    queryEvidence({ org_id, project_id, q: prompt, limit, trust_scope: "include_pending" }),
    queryEvidence({ org_id, project_id, q: project_name, limit: 10, trust_scope: "include_pending" }),
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
