"use server";

import { ensureUserOrg, projectSlugFromName } from "@/lib/auth/org";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export interface NewProjectState {
  error?: string;
}

export async function createProjectAction(
  _prevState: NewProjectState,
  formData: FormData
): Promise<NewProjectState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const name = String(formData.get("name") ?? "").trim();
  const slugInput = String(formData.get("slug") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  if (!name) return { error: "Project name is required." };

  const slug = projectSlugFromName(slugInput || name);
  const org = await ensureUserOrg(user);
  const service = createServiceClient();

  const { data: project, error } = await service
    .from("projects")
    .insert({
      org_id: org.id,
      name,
      slug,
      description: description || null,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !project) {
    const message = error?.message.includes("duplicate")
      ? "That slug is already in use for your organization."
      : "Could not create project. Please try again.";
    return { error: message };
  }

  redirect(`/projects/${project.id}`);
}
