import { getProjectForUser } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import { PipelineRail } from "../PipelineRail";
import { ThemesList, type ThemeRow, type ThemeStatus } from "./themes-list";

interface Props {
  params: { projectId: string };
}

export default async function ThemesPage({ params }: Props) {
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

  const [themesResult, problemThemesResult, { count: sourcesCount }, { count: evidenceCount }, { count: problemCount }] =
    await Promise.all([
      supabase
        .from("themes")
        .select("id, label, central_concept, description, status, evidence_count, updated_at")
        .eq("org_id", project.org_id)
        .eq("project_id", project.id),
      supabase
        .from("problem_themes")
        .select("theme_id")
        .eq("org_id", project.org_id)
        .eq("project_id", project.id),
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
      supabase
        .from("problems")
        .select("*", { count: "exact", head: true })
        .eq("org_id", project.org_id)
        .eq("project_id", project.id),
    ]);

  const loadError = themesResult.error || problemThemesResult.error;

  const problemCounts = new Map<string, number>();
  for (const link of (problemThemesResult.data ?? []) as Array<{ theme_id: string }>) {
    problemCounts.set(link.theme_id, (problemCounts.get(link.theme_id) ?? 0) + 1);
  }

  const themes: ThemeRow[] = ((themesResult.data ?? []) as Array<{
    id: string;
    label: string;
    central_concept: string | null;
    description: string | null;
    status: ThemeStatus;
    evidence_count: number;
    updated_at: string;
  }>).map((theme) => ({
    ...theme,
    problem_count: problemCounts.get(theme.id) ?? 0,
  }));

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
          {project.name}
        </div>
        <h1 className="text-2xl font-semibold text-[var(--ink)]">Themes</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-2)]">
          Patterns synthesised from trusted evidence.
        </p>
      </div>

      <PipelineRail
        projectId={project.id}
        sourcesCount={sourcesCount ?? 0}
        evidenceCount={evidenceCount ?? 0}
        problemCount={problemCount ?? 0}
      />

      {loadError ? (
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-12 text-center text-sm text-[var(--ink-2)]">
          We could not load themes. Try again.
        </div>
      ) : (
        <ThemesList themes={themes} projectId={project.id} />
      )}
    </div>
  );
}
