import { getProjectForUser } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import { PipelineRail } from "../PipelineRail";
import { ProblemsList, type ProblemRow } from "./problems-list";

interface Props {
  params: { projectId: string };
}

const severityOrder: Record<ProblemRow["severity"], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function sortProblems(problems: ProblemRow[]) {
  return [...problems].sort((a, b) => {
    const severityDelta = severityOrder[a.severity] - severityOrder[b.severity];
    if (severityDelta !== 0) return severityDelta;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

export default async function ProblemsPage({ params }: Props) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const project = await getProjectForUser<{
    id: string;
    org_id: string;
    name: string;
    problems_discovered_at: string | null;
  }>(
    user.id,
    params.projectId,
    "id, org_id, name, problems_discovered_at"
  );

  if (!project) notFound();

  const [{ data }, { count: sourcesCount }, { count: evidenceCount }] = await Promise.all([
    supabase
      .from("problems")
      .select("id, title, description, severity, status, source_theme_ids, source_evidence_ids, created_at")
      .eq("org_id", project.org_id)
      .eq("project_id", project.id)
      .order("severity", { ascending: true })
      .order("created_at", { ascending: false }),
    supabase
      .from("sources")
      .select("*", { count: "exact", head: true })
      .eq("org_id", project.org_id)
      .eq("project_id", project.id),
    supabase
      .from("evidence")
      .select("*", { count: "exact", head: true })
      .eq("org_id", project.org_id)
      .eq("project_id", project.id),
  ]);

  const problems = sortProblems((data ?? []) as ProblemRow[]);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
          {project.name}
        </div>
        <h1 className="text-2xl font-semibold text-[var(--ink)]">Problems</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-2)]">
          Surfaced from synthesised evidence.
        </p>
      </div>

      <PipelineRail
        projectId={project.id}
        sourcesCount={sourcesCount ?? 0}
        evidenceCount={evidenceCount ?? 0}
        problemCount={problems.length}
      />

      {!project.problems_discovered_at ? (
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-12 text-center text-sm text-[var(--ink-2)]">
          No problems discovered yet. Add sources, trust evidence, and run synthesis to surface problems automatically.
        </div>
      ) : (
        <ProblemsList problems={problems} projectId={project.id} />
      )}
    </div>
  );
}
