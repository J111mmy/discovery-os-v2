"use server";

import { getProjectForUser } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
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

  await query;

  revalidatePath(`/projects/${project.id}/evidence`);
  revalidatePath(`/projects/${project.id}`);
  revalidatePath(`/projects/${project.id}/compose`);
}

export const trustEvidenceAction = updateEvidenceTrustAction;
