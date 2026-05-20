"use server";

import { getProjectForUser } from "@/lib/auth/org";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function trustEvidenceAction(formData: FormData) {
  const projectId = String(formData.get("project_id") ?? "");
  const evidenceId = String(formData.get("evidence_id") ?? "");

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

  const service = createServiceClient();

  let query = service
    .from("evidence")
    .update({ trust_scope: "trusted" })
    .eq("org_id", project.org_id)
    .eq("project_id", project.id);

  if (evidenceId) {
    query = query.eq("id", evidenceId);
  } else {
    query = query.eq("trust_scope", "pending");
  }

  await query;

  revalidatePath(`/projects/${project.id}/evidence`);
}
