import { getProjectForUser } from "@/lib/auth/org";
import { getProjectOrgReadForUser } from "@/lib/auth/support-read";
import { VISIBLE_REVIEW_STATES } from "@/lib/research-ontology/review-states";
import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import { ThemesList, type ThemeRow, type ThemeStatus } from "./themes-list";

interface Props {
  params: { projectId: string };
}

const THEME_EVIDENCE_PAGE_SIZE = 1000;

type ThemeEvidenceCountLink = {
  theme_id: string;
  evidence_id: string;
};

async function loadVisibleThemeEvidenceCounts(
  read: Awaited<ReturnType<typeof getProjectOrgReadForUser>>,
  projectId: string
) {
  const counts = new Map<string, Set<string>>();
  let from = 0;

  while (true) {
    const { data, error } = await read
      .from("theme_evidence")
      .select("theme_id, evidence_id")
      .eq("project_id", projectId)
      .in("review_state", [...VISIBLE_REVIEW_STATES])
      .range(from, from + THEME_EVIDENCE_PAGE_SIZE - 1);

    if (error) return { counts, error };

    const rows = (data ?? []) as ThemeEvidenceCountLink[];
    for (const link of rows) {
      const evidenceIds = counts.get(link.theme_id) ?? new Set<string>();
      evidenceIds.add(link.evidence_id);
      counts.set(link.theme_id, evidenceIds);
    }

    if (rows.length < THEME_EVIDENCE_PAGE_SIZE) break;
    from += THEME_EVIDENCE_PAGE_SIZE;
  }

  return { counts, error: null };
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
  const read = await getProjectOrgReadForUser({
    userId: user.id,
    orgId: project.org_id,
    memberClient: supabase,
  });

  const [themesResult, themeEvidenceCountsResult, problemThemesResult] = await Promise.all([
    read
      .from("themes")
      .select("id, label, central_concept, description, status, updated_at")
      .eq("project_id", project.id),
    loadVisibleThemeEvidenceCounts(read, project.id),
    read
      .from("problem_themes")
      .select("theme_id")
      .eq("project_id", project.id),
  ]);

  const loadError = themesResult.error || themeEvidenceCountsResult.error || problemThemesResult.error;
  const evidenceCounts = themeEvidenceCountsResult.counts;

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
    updated_at: string;
  }>).map((theme) => ({
    ...theme,
    evidence_count: evidenceCounts.get(theme.id)?.size ?? 0,
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
