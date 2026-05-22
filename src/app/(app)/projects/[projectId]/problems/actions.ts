"use server";

import { getProjectForUser } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const allowedStatuses = ["surfaced", "acknowledged", "active", "resolved", "dismissed"];

export async function updateProblemStatusAction(formData: FormData) {
  const problemId = String(formData.get("problem_id") ?? "");
  const projectId = String(formData.get("project_id") ?? "");
  const status = String(formData.get("status") ?? "");

  if (!problemId || !projectId || !allowedStatuses.includes(status)) return;

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

  if (!project) return;

  await supabase
    .from("problems")
    .update({ status })
    .eq("org_id", project.org_id)
    .eq("project_id", project.id)
    .eq("id", problemId);

  revalidatePath(`/projects/${project.id}/problems`);
  revalidatePath(`/projects/${project.id}`);
}
