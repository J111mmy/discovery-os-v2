"use server";

import { accessRedirectPath, requireActiveAccess } from "@/lib/auth/access";
import { getProjectForUser, projectSlugFromName } from "@/lib/auth/org";
import { inngest } from "@/lib/inngest/client";
import { createClient, createServiceClient } from "@/lib/supabase/server";
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

  const access = await requireActiveAccess({ id: user.id, email: user.email });
  if (!access.ok) redirect(accessRedirectPath(access.status));

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

function uniqueProjectSlug(baseName: string, attempt: number) {
  const base = projectSlugFromName(baseName);
  return attempt === 0 ? base : `${base}-${attempt + 1}`;
}

export async function updateProjectOpportunityStatusAction(formData: FormData) {
  const projectId = String(formData.get("project_id") ?? "");
  const opportunityId = String(formData.get("opportunity_id") ?? "");
  const status = String(formData.get("status") ?? "");

  if (!projectId || !opportunityId) return;
  if (!["suggested", "watching", "dismissed"].includes(status)) return;

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

  const { data: link } = await supabase
    .from("project_opportunity_projects")
    .select("opportunity_id")
    .eq("org_id", project.org_id)
    .eq("project_id", project.id)
    .eq("opportunity_id", opportunityId)
    .maybeSingle();

  if (!link) return;

  await supabase
    .from("project_opportunities")
    .update({ status })
    .eq("org_id", project.org_id)
    .eq("id", opportunityId);

  revalidatePath(`/projects/${project.id}`);
}

export async function createProjectFromOpportunityAction(formData: FormData) {
  const projectId = String(formData.get("project_id") ?? "");
  const opportunityId = String(formData.get("opportunity_id") ?? "");

  if (!projectId || !opportunityId) return;

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

  const service = createServiceClient();

  const [{ data: opportunity }, { data: link }] = await Promise.all([
    service
      .from("project_opportunities")
      .select("id, org_id, title, description, suggested_frame, status")
      .eq("org_id", project.org_id)
      .eq("id", opportunityId)
      .single(),
    service
      .from("project_opportunity_projects")
      .select("opportunity_id")
      .eq("org_id", project.org_id)
      .eq("project_id", project.id)
      .eq("opportunity_id", opportunityId)
      .maybeSingle(),
  ]);

  if (!opportunity || !link || opportunity.status === "dismissed") return;

  let createdProject: { id: string } | null = null;
  let lastError: string | null = null;

  for (let attempt = 0; attempt < 5 && !createdProject; attempt += 1) {
    const slug = uniqueProjectSlug(opportunity.title, attempt);
    const { data, error } = await service
      .from("projects")
      .insert({
        org_id: project.org_id,
        name: opportunity.title,
        slug,
        description: opportunity.description,
        frame: opportunity.suggested_frame,
        created_by: user.id,
      })
      .select("id")
      .single();

    if (data) createdProject = data;
    if (error) lastError = error.message;
  }

  if (!createdProject) {
    throw new Error(`Could not create project${lastError ? `: ${lastError}` : ""}`);
  }

  await Promise.all([
    service
      .from("project_opportunities")
      .update({
        status: "accepted",
        created_project_id: createdProject.id,
      })
      .eq("org_id", project.org_id)
      .eq("id", opportunity.id),
    service.from("project_opportunity_projects").upsert(
      {
        org_id: project.org_id,
        opportunity_id: opportunity.id,
        project_id: createdProject.id,
        relationship: "created",
      },
      { onConflict: "opportunity_id,project_id,relationship" }
    ),
  ]);

  revalidatePath(`/projects/${project.id}`);
  redirect(`/projects/${createdProject.id}`);
}
