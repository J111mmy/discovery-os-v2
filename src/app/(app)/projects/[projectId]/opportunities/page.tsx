import { getProjectForUser } from "@/lib/auth/org";
import { getProjectOrgReadForUser } from "@/lib/auth/support-read";
import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import { PipelineRail } from "../PipelineRail";
import { OpportunitiesList } from "./opportunities-list";

interface Props {
  params: { projectId: string };
}

export default async function OpportunitiesPage({ params }: Props) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const project = await getProjectForUser<{
    id: string;
    org_id: string;
    name: string;
  }>(user.id, params.projectId, "id, org_id, name");

  if (!project) notFound();
  const read = await getProjectOrgReadForUser({
    userId: user.id,
    orgId: project.org_id,
    memberClient: supabase,
  });

  const [{ count: sourcesCount }, { count: evidenceCount }, { count: problemCount }] = await Promise.all([
    read
      .from("sources")
      .select("*", { count: "exact", head: true })
      .eq("project_id", project.id),
    read
      .from("evidence")
      .select("*", { count: "exact", head: true })
      .eq("project_id", project.id),
    read
      .from("problems")
      .select("*", { count: "exact", head: true })
      .eq("project_id", project.id),
  ]);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
          {project.name}
        </div>
        <h1 className="text-2xl font-semibold text-[var(--ink)]">Product opportunities</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-2)]">
          Problem-linked solution directions, traced back to the evidence and themes behind them.
          Suggested workspaces are managed separately on the workspace overview.
        </p>
      </div>

      <PipelineRail
        projectId={project.id}
        sourcesCount={sourcesCount ?? 0}
        evidenceCount={evidenceCount ?? 0}
        problemCount={problemCount ?? 0}
      />

      <OpportunitiesList projectId={project.id} />
    </div>
  );
}
