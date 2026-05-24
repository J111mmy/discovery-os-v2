"use server";

import { getProjectForUser } from "@/lib/auth/org";
import { inngest } from "@/lib/inngest/client";
import { createClient } from "@/lib/supabase/server";
import type { EvidenceRecord } from "@/types/database";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function updateEvidenceTrustAction(formData: FormData) {
  const projectId = String(formData.get("project_id") ?? "");
  const evidenceId = String(formData.get("evidence_id") ?? "");
  const trustScope = String(formData.get("trust_scope") ?? "trusted");

  if (!["trusted", "excluded"].includes(trustScope)) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  if (!projectId) return;

  const project = await getProjectForUser<{ id: string; org_id: string }>(
    user.id,
    projectId,
    "id, org_id"
  );

  if (!project) return;

  const bulkTrustAll = !evidenceId && trustScope === "trusted";

  let query = supabase
    .from("evidence")
    .update({ trust_scope: trustScope })
    .eq("org_id", project.org_id)
    .eq("project_id", project.id);

  if (evidenceId) {
    query = query.eq("id", evidenceId);
  } else {
    query = query.eq("trust_scope", "pending");
  }

  const { error } = await query;
  if (error) return;

  await supabase
    .from("projects")
    .update({ synthesis_stale: true })
    .eq("org_id", project.org_id)
    .eq("id", project.id);

  if (bulkTrustAll) {
    await inngest.send({
      name: "project/synthesis.requested",
      data: { org_id: project.org_id, project_id: project.id },
    });
  }

  revalidatePath(`/projects/${project.id}/evidence`);
  revalidatePath(`/projects/${project.id}`);
  revalidatePath(`/projects/${project.id}/compose`);
}

export const trustEvidenceAction = updateEvidenceTrustAction;

export async function loadEvidenceRecordsAction({
  projectId,
  offset,
  limit = 20,
}: {
  projectId: string;
  offset: number;
  limit?: number;
}): Promise<EvidenceRecord[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const project = await getProjectForUser<{ id: string; org_id: string }>(
    user.id,
    projectId,
    "id, org_id"
  );

  if (!project) return [];

  const safeOffset = Math.max(0, offset);
  const safeLimit = Math.min(Math.max(1, limit), 50);

  const { data: evidence } = await supabase
    .from("evidence")
    .select("id, org_id, project_id, source_id, segment_id, content, trust_scope, summary, classification, sentiment, themes, metadata, ai_trust_grade, ai_trust_reason, ai_graded_at, created_at")
    .eq("org_id", project.org_id)
    .eq("project_id", project.id)
    .order("created_at", { ascending: false })
    .range(safeOffset, safeOffset + safeLimit - 1);

  const records = (evidence ?? []) as EvidenceRecord[];
  const sourceIds = Array.from(new Set(records.map((record) => record.source_id)));
  const segmentIds = Array.from(
    new Set(records.map((record) => record.segment_id).filter(Boolean))
  ) as string[];

  if (sourceIds.length > 0) {
    const { data: sources } = await supabase
      .from("sources")
      .select("id, org_id, title, type")
      .eq("org_id", project.org_id)
      .in("id", sourceIds);

    const sourceById = new Map(
      (sources ?? []).map((source: { id: string; title: string; type: string }) => [
        source.id,
        source,
      ])
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
      .eq("org_id", project.org_id)
      .in("id", segmentIds);

    const segmentById = new Map(
      (segments ?? []).map((segment: { id: string; speaker: string | null; segment_index: number }) => [
        segment.id,
        segment,
      ])
    );

    records.forEach((record) => {
      const segment = record.segment_id ? segmentById.get(record.segment_id) : null;
      if (segment) {
        record.segment_speaker = segment.speaker;
        record.segment_index = segment.segment_index;
      }
    });
  }

  return records;
}
