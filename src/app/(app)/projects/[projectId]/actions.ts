"use server";

import { getProjectForUser } from "@/lib/auth/org";
import { inngest } from "@/lib/inngest/client";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function runProjectSynthesisAction(formData: FormData) {
  const projectId = String(formData.get("project_id") ?? "");
  if (!projectId) return;

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
    .from("projects")
    .update({ synthesis_stale: true })
    .eq("org_id", project.org_id)
    .eq("id", project.id);

  await inngest.send({
    name: "project/synthesis.requested",
    data: { org_id: project.org_id, project_id: project.id },
  });

  revalidatePath(`/projects/${project.id}`);
}
