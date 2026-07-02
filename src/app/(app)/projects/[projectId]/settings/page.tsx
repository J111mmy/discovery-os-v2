import { getProjectForUser } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import { SettingsForms } from "./settings-forms";

interface Props {
  params: { projectId: string };
}

export default async function SettingsPage({ params }: Props) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const project = await getProjectForUser<{
    id: string;
    org_id: string;
    name: string;
    frame: string | null;
    frame_draft: {
      problem: string;
      hypothesis: string;
      buyers: string;
      research_areas: string[];
    } | null;
    frame_draft_generated_at: string | null;
    research_context: {
      goals?: string;
      outcomes?: string;
      buyers?: string;
      scope_in?: string;
      scope_out?: string;
      research_questions?: string[];
    } | null;
    operating_style: string | null;
    gtm_context: string | null;
  }>(
    user.id,
    params.projectId,
    "id, org_id, name, frame, frame_draft, frame_draft_generated_at, research_context, operating_style, gtm_context"
  );

  if (!project) notFound();

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
          Settings
        </div>
        <h1 className="text-2xl font-semibold text-[var(--ink)]">Project settings</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-2)]">
          Configure the project context that shapes evidence review, synthesis, and document output.
        </p>
      </div>

      <SettingsForms
        projectId={project.id}
        initialProject={{
          frame: project.frame,
          frame_draft: project.frame_draft,
          frame_draft_generated_at: project.frame_draft_generated_at,
          research_context: project.research_context,
          operating_style: project.operating_style,
          gtm_context: project.gtm_context,
        }}
      />
    </div>
  );
}
