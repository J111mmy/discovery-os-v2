"use server";

import { getProjectForUser } from "@/lib/auth/org";
import { inngest } from "@/lib/inngest/client";
import { createClient } from "@/lib/supabase/server";
import type { EvidenceRecord, TrustScope, TrustScopeSource } from "@/types/database";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

type EvidenceFeedbackState = {
  id: string;
  org_id: string;
  project_id: string;
  ai_trust_grade: "trusted" | "uncertain" | "weak" | null;
  trust_scope: TrustScope;
  trust_scope_source: TrustScopeSource;
};

function isMissingTrustScopeSourceColumn(error: { message?: string } | null) {
  return Boolean(error?.message?.includes("trust_scope_source"));
}

function normalizeTrustScopeSource(value: unknown): TrustScopeSource {
  return value === "ai" || value === "human" || value === "pending" ? value : "pending";
}

async function fetchEvidenceFeedbackStates({
  supabase,
  orgId,
  projectId,
  evidenceIds,
  pendingOnly = false,
}: {
  supabase: SupabaseClient;
  orgId: string;
  projectId: string;
  evidenceIds?: string[];
  pendingOnly?: boolean;
}): Promise<{ rows: EvidenceFeedbackState[]; error?: string }> {
  const selectWithSource =
    "id, org_id, project_id, ai_trust_grade, trust_scope, trust_scope_source";
  const selectWithoutSource = "id, org_id, project_id, ai_trust_grade, trust_scope";

  async function runSelect(columns: string) {
    let query = supabase
      .from("evidence")
      .select(columns)
      .eq("org_id", orgId)
      .eq("project_id", projectId);

    if (evidenceIds && evidenceIds.length > 0) {
      query = query.in("id", evidenceIds);
    }

    if (pendingOnly) {
      query = query.eq("trust_scope", "pending");
    }

    return query;
  }

  const { data, error } = await runSelect(selectWithSource);
  if (error && isMissingTrustScopeSourceColumn(error)) {
    const { data: fallbackData, error: fallbackError } = await runSelect(selectWithoutSource);
    if (fallbackError) return { rows: [], error: fallbackError.message };

    return {
      rows: ((fallbackData ?? []) as unknown as Omit<
        EvidenceFeedbackState,
        "trust_scope_source"
      >[]).map((row) => ({ ...row, trust_scope_source: "pending" })),
    };
  }

  if (error) return { rows: [], error: error.message };

  return {
    rows: ((data ?? []) as unknown as Array<
      EvidenceFeedbackState & { trust_scope_source?: unknown }
    >).map((row) => ({
        ...row,
        trust_scope_source: normalizeTrustScopeSource(row.trust_scope_source),
      })),
  };
}

async function updateEvidenceTrustScope({
  supabase,
  orgId,
  projectId,
  evidenceIds,
  trustScope,
}: {
  supabase: SupabaseClient;
  orgId: string;
  projectId: string;
  evidenceIds: string[];
  trustScope: TrustScope;
}) {
  const payload: { trust_scope: TrustScope; trust_scope_source?: TrustScopeSource } = {
    trust_scope: trustScope,
    trust_scope_source: "human",
  };

  const runUpdate = (updates: typeof payload) =>
    supabase
      .from("evidence")
      .update(updates)
      .eq("org_id", orgId)
      .eq("project_id", projectId)
      .in("id", evidenceIds);

  const { error } = await runUpdate(payload);
  if (!error) return null;

  // Backward-compatible deploy safety: if this code ships before migration
  // 0026, keep the trust action working and skip provenance until the schema lands.
  if (isMissingTrustScopeSourceColumn(error)) {
    const { error: fallbackError } = await runUpdate({ trust_scope: trustScope });
    return fallbackError;
  }

  return error;
}

async function insertEvidenceGradeFeedback({
  supabase,
  userId,
  rows,
  trustScope,
}: {
  supabase: SupabaseClient;
  userId: string;
  rows: EvidenceFeedbackState[];
  trustScope: TrustScope;
}) {
  const feedbackRows = rows
    .filter((row) => row.trust_scope !== trustScope)
    .map((row) => ({
      org_id: row.org_id,
      project_id: row.project_id,
      user_id: userId,
      evidence_id: row.id,
      model_grade: row.ai_trust_grade,
      from_scope: row.trust_scope,
      to_scope: trustScope,
      from_source: row.trust_scope_source,
    }));

  if (feedbackRows.length === 0) return;

  const { error } = await supabase.from("evidence_grade_feedback").insert(feedbackRows);
  if (error) {
    console.warn("[evidence-feedback] failed to log trust override", {
      project_id: rows[0]?.project_id,
      count: feedbackRows.length,
      message: error.message,
    });
  }
}

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
  if (!evidenceId && !bulkTrustAll) return;

  const before = await fetchEvidenceFeedbackStates({
    supabase,
    orgId: project.org_id,
    projectId: project.id,
    evidenceIds: evidenceId ? [evidenceId] : undefined,
    pendingOnly: !evidenceId,
  });

  if (before.error || before.rows.length === 0) return;

  const affectedIds = before.rows.map((row) => row.id);
  const error = await updateEvidenceTrustScope({
    supabase,
    orgId: project.org_id,
    projectId: project.id,
    evidenceIds: affectedIds,
    trustScope: trustScope as TrustScope,
  });
  if (error) return;

  await insertEvidenceGradeFeedback({
    supabase,
    userId: user.id,
    rows: before.rows,
    trustScope: trustScope as TrustScope,
  });

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

// Bulk move a selected set of evidence records into a trust bucket. Used by the
// checkbox selection in the evidence browser. Only ever touches the rows whose
// ids are passed in, scoped to the user's org + project.
export async function setEvidenceTrustBulkAction({
  projectId,
  evidenceIds,
  trustScope,
}: {
  projectId: string;
  evidenceIds: string[];
  trustScope: TrustScope;
}): Promise<{ ok: boolean; error?: string }> {
  if (!["trusted", "excluded", "pending"].includes(trustScope)) {
    return { ok: false, error: "Invalid trust scope." };
  }

  const ids = Array.from(new Set(evidenceIds.filter(Boolean)));
  if (ids.length === 0) return { ok: false, error: "Nothing selected." };

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

  if (!project) return { ok: false, error: "Project not found." };

  const before = await fetchEvidenceFeedbackStates({
    supabase,
    orgId: project.org_id,
    projectId: project.id,
    evidenceIds: ids,
  });

  if (before.error) return { ok: false, error: before.error };
  if (before.rows.length === 0) return { ok: false, error: "No matching evidence found." };

  const error = await updateEvidenceTrustScope({
    supabase,
    orgId: project.org_id,
    projectId: project.id,
    evidenceIds: before.rows.map((row) => row.id),
    trustScope,
  });

  if (error) return { ok: false, error: error.message };

  await insertEvidenceGradeFeedback({
    supabase,
    userId: user.id,
    rows: before.rows,
    trustScope,
  });

  await supabase
    .from("projects")
    .update({ synthesis_stale: true })
    .eq("org_id", project.org_id)
    .eq("id", project.id);

  revalidatePath(`/projects/${project.id}/evidence`);
  revalidatePath(`/projects/${project.id}`);
  revalidatePath(`/projects/${project.id}/compose`);

  return { ok: true };
}

export async function loadEvidenceRecordsAction({
  projectId,
  offset,
  limit = 20,
  trustScope = "all",
}: {
  projectId: string;
  offset: number;
  limit?: number;
  trustScope?: TrustScope | "all";
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

  let evidenceQuery = supabase
    .from("evidence")
    .select("id, org_id, project_id, source_id, segment_id, content, trust_scope, summary, classification, sentiment, themes, metadata, ai_trust_grade, ai_trust_reason, ai_graded_at, created_at")
    .eq("org_id", project.org_id)
    .eq("project_id", project.id);

  if (trustScope !== "all") {
    evidenceQuery = evidenceQuery.eq("trust_scope", trustScope);
  }

  const { data: evidence } = await evidenceQuery
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
      .eq("project_id", project.id)
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
      .in("source_id", sourceIds)
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
