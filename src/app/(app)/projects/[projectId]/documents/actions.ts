"use server";

import { getProjectForUser } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function deleteArtifactAction(formData: FormData) {
  const projectId = String(formData.get("project_id") ?? "");
  const artifactId = String(formData.get("artifact_id") ?? "");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  if (!projectId || !artifactId) return;

  const project = await getProjectForUser<{ id: string; org_id: string }>(
    user.id,
    projectId,
    "id, org_id"
  );

  if (!project) return;

  await supabase
    .from("artifacts")
    .delete()
    .eq("org_id", project.org_id)
    .eq("project_id", project.id)
    .eq("id", artifactId);

  revalidatePath(`/projects/${project.id}/documents`);
  revalidatePath(`/projects/${project.id}`);
}
