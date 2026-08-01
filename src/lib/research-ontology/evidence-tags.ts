import type { createClient, createServiceClient } from "@/lib/supabase/server";
import type { OrgScopedRead } from "@/lib/auth/support-read";
import type { EvidenceRecord } from "@/types/database";

type SupabaseClient =
  | Awaited<ReturnType<typeof createClient>>
  | ReturnType<typeof createServiceClient>
  | OrgScopedRead;

export type TagOption = {
  id: string;
  label: string;
  color: string | null;
};

type TagRow = {
  id: string;
  label: string;
  color: string | null;
};

type EvidenceTagRow = {
  evidence_id: string;
  tag_id: string;
};

// Mirrors the label_key generation in supabase/migrations/0030_research_ontology_v2.sql
// so app-created tags dedupe against the same unique index as the SQL backfill.
export function tagLabelKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export async function loadProjectTags({
  supabase,
  orgId,
  projectId,
}: {
  supabase: SupabaseClient;
  orgId: string;
  projectId: string;
}): Promise<TagOption[]> {
  const { data } = await supabase
    .from("tags")
    .select("id, label, color")
    .eq("org_id", orgId)
    .eq("project_id", projectId)
    .order("label", { ascending: true });

  return (data ?? []) as TagRow[];
}

export async function loadTagsByEvidenceId({
  supabase,
  orgId,
  projectId,
  evidenceIds,
}: {
  supabase: SupabaseClient;
  orgId: string;
  projectId: string;
  evidenceIds: string[];
}): Promise<Map<string, TagOption[]>> {
  const byEvidenceId = new Map<string, TagOption[]>();
  if (evidenceIds.length === 0) return byEvidenceId;

  const { data: links } = await supabase
    .from("evidence_tags")
    .select("evidence_id, tag_id")
    .eq("org_id", orgId)
    .eq("project_id", projectId)
    .in("evidence_id", evidenceIds);

  const linkRows = (links ?? []) as EvidenceTagRow[];
  if (linkRows.length === 0) return byEvidenceId;

  const tagIds = Array.from(new Set(linkRows.map((link) => link.tag_id)));
  const { data: tagsData } = await supabase
    .from("tags")
    .select("id, label, color")
    .eq("org_id", orgId)
    .in("id", tagIds);

  const tagById = new Map(((tagsData ?? []) as TagRow[]).map((tag) => [tag.id, tag]));

  for (const link of linkRows) {
    const tag = tagById.get(link.tag_id);
    if (!tag) continue;
    const list = byEvidenceId.get(link.evidence_id) ?? [];
    list.push(tag);
    byEvidenceId.set(link.evidence_id, list);
  }

  return byEvidenceId;
}

export async function hydrateEvidenceRecordsWithTags({
  supabase,
  orgId,
  projectId,
  records,
}: {
  supabase: SupabaseClient;
  orgId: string;
  projectId: string;
  records: EvidenceRecord[];
}) {
  const tagsByEvidenceId = await loadTagsByEvidenceId({
    supabase,
    orgId,
    projectId,
    evidenceIds: records.map((record) => record.id),
  });

  for (const record of records) {
    record.tags = tagsByEvidenceId.get(record.id) ?? [];
  }

  return records;
}
