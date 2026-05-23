// Project workspace — evidence browser + compose entry point
import { createClient } from "@/lib/supabase/server";
import { getProjectForUser } from "@/lib/auth/org";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { runProjectSynthesisAction } from "./actions";

interface Props {
  params: { projectId: string };
}

type ThemeRow = {
  id: string;
  label: string;
  evidence_count: number;
};

function synthesisTimeLabel(value: string | null) {
  if (!value) return "not synthesised yet";

  const diffMs = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(diffMs / 60_000));

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default async function ProjectPage({ params }: Props) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const project = await getProjectForUser<{
    id: string;
    org_id: string;
    name: string;
    description: string | null;
    frame: string | null;
    synthesis_stale: boolean;
    last_synthesised_at: string | null;
    gap_signals: Array<{ area: string; description: string; severity: string; suggested_action: string }> | null;
    created_at: string;
  }>(
    user.id,
    params.projectId,
    "id, org_id, name, description, frame, synthesis_stale, last_synthesised_at, gap_signals, created_at"
  );

  if (!project) notFound();

  const [
    { count: evidenceCount },
    { count: trustedCount },
    { count: pendingCount },
    { count: artifactCount },
    { count: sourceCount },
    { data: sources },
    { data: themes, count: themeCount },
    { count: problemCount },
    { count: runningSynthesisCount },
  ] =
    await Promise.all([
      supabase
        .from("evidence")
        .select("*", { count: "exact", head: true })
        .eq("org_id", project.org_id)
        .eq("project_id", project.id),
      supabase
        .from("evidence")
        .select("*", { count: "exact", head: true })
        .eq("org_id", project.org_id)
        .eq("project_id", project.id)
        .eq("trust_scope", "trusted"),
      supabase
        .from("evidence")
        .select("*", { count: "exact", head: true })
        .eq("org_id", project.org_id)
        .eq("project_id", project.id)
        .eq("trust_scope", "pending"),
      supabase
        .from("artifacts")
        .select("*", { count: "exact", head: true })
        .eq("org_id", project.org_id)
        .eq("project_id", project.id),
      supabase
        .from("sources")
        .select("*", { count: "exact", head: true })
        .eq("org_id", project.org_id)
        .eq("project_id", project.id),
      supabase
        .from("sources")
        .select("id, org_id, title, type, trust_scope, ingested_at")
        .eq("org_id", project.org_id)
        .eq("project_id", project.id)
        .order("ingested_at", { ascending: false })
        .limit(5),
      supabase
        .from("themes")
        .select("id, label, evidence_count", { count: "exact" })
        .eq("org_id", project.org_id)
        .eq("project_id", project.id)
        .order("evidence_count", { ascending: false })
        .limit(6),
      supabase
        .from("problems")
        .select("*", { count: "exact", head: true })
        .eq("org_id", project.org_id)
        .eq("project_id", project.id)
        .in("status", ["surfaced", "acknowledged", "active"]),
      supabase
        .from("agent_runs")
        .select("*", { count: "exact", head: true })
        .eq("org_id", project.org_id)
        .eq("project_id", project.id)
        .eq("agent_type", "project-synthesis")
        .eq("status", "running"),
    ]);

  const themeRows = (themes ?? []) as ThemeRow[];
  const hiddenThemeCount = Math.max((themeCount ?? themeRows.length) - themeRows.length, 0);
  const trustedTotal = trustedCount ?? 0;
  const synthesisRunning = (runningSynthesisCount ?? 0) > 0;

  // Confidence score — four equally-weighted signals (25 pts each, 100 max)
  // Targets: 20 trusted records, 5 sources, 5 themes, 3 problems
  const confidenceTrusted   = Math.min((trustedTotal / 20), 1) * 25;
  const confidenceSources   = Math.min(((sourceCount ?? 0) / 5), 1) * 25;
  const confidenceThemes    = Math.min(((themeCount ?? 0) / 5), 1) * 25;
  const confidenceProblems  = Math.min(((problemCount ?? 0) / 3), 1) * 25;
  const confidenceScore     = Math.round(confidenceTrusted + confidenceSources + confidenceThemes + confidenceProblems);

  function confidenceLabel(score: number) {
    if (score >= 80) return "Strong";
    if (score >= 55) return "Building";
    if (score >= 25) return "Early";
    return "Just started";
  }

  function confidenceColour(score: number) {
    if (score >= 80) return "bg-green-400";
    if (score >= 55) return "bg-[var(--brand)]";
    if (score >= 25) return "bg-yellow-400";
    return "bg-[var(--ink-faint)]";
  }

  // Explain the weakest signal so users know what to do next
  const signals = [
    { score: confidenceTrusted,  max: 25, hint: `${trustedTotal} trusted record${trustedTotal === 1 ? "" : "s"} — aim for 20+` },
    { score: confidenceSources,  max: 25, hint: `${sourceCount ?? 0} source${(sourceCount ?? 0) === 1 ? "" : "s"} — aim for 5+` },
    { score: confidenceThemes,   max: 25, hint: `${themeCount ?? 0} theme${(themeCount ?? 0) === 1 ? "" : "s"} — run synthesis to surface more` },
    { score: confidenceProblems, max: 25, hint: `${problemCount ?? 0} open problem${(problemCount ?? 0) === 1 ? "" : "s"} — synthesis surfaces these automatically` },
  ];
  const weakestSignal = signals.slice().sort((a, b) => (a.score / a.max) - (b.score / b.max))[0];

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
            Workspace
          </div>
          <h1 className="text-2xl font-semibold text-[var(--ink)]">{project.name}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">
            {project.description || "Turn raw discovery input into trusted evidence and working artifacts."}
          </p>
        </div>
        <Link
          href={`/projects/${project.id}/ingest`}
          className="inline-flex rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-dim)]"
        >
          Add evidence
        </Link>
      </div>

      <div className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5">
          <div className="text-2xl font-semibold text-[var(--ink)]">{evidenceCount ?? 0}</div>
          <div className="mt-1 text-sm text-[var(--ink-muted)]">Evidence records</div>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5">
          <div className="text-2xl font-semibold text-green-300">{trustedCount ?? 0}</div>
          <div className="mt-1 text-sm text-[var(--ink-muted)]">Trusted</div>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5">
          <div className="text-2xl font-semibold text-yellow-300">{pendingCount ?? 0}</div>
          <div className="mt-1 text-sm text-[var(--ink-muted)]">Pending review</div>
        </div>
        <Link
          href={`/projects/${project.id}/documents`}
          className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5 transition-colors hover:border-[var(--brand)]"
        >
          <div className="text-2xl font-semibold text-[var(--ink)]">{artifactCount ?? 0}</div>
          <div className="mt-1 text-sm text-[var(--ink-muted)]">Documents</div>
        </Link>
      </div>

      {/* Confidence indicator */}
      <div className="mb-8 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-[var(--ink)]">
                Research confidence
              </span>
              <span className="text-sm font-semibold text-[var(--ink)]">
                {confidenceScore}%
              </span>
              <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-xs font-medium text-[var(--ink-muted)]">
                {confidenceLabel(confidenceScore)}
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
              <div
                className={`h-full rounded-full transition-all ${confidenceColour(confidenceScore)}`}
                style={{ width: `${confidenceScore}%` }}
              />
            </div>
            {confidenceScore < 100 && (
              <p className="mt-2 text-xs text-[var(--ink-muted)]">
                Next: {weakestSignal.hint}
              </p>
            )}
          </div>
        </div>
      </div>

      {(themeRows.length > 0 || trustedTotal > 0) && (
        <section className="mb-8 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-[var(--ink)]">
                Themes from trusted evidence
              </h2>
              {themeRows.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {themeRows.map((theme) => (
                    <span
                      key={theme.id}
                      className="rounded-full border border-[var(--border)] bg-[var(--surface-0)] px-3 py-1 text-xs font-medium text-[var(--ink)]"
                    >
                      {theme.label}
                    </span>
                  ))}
                  {hiddenThemeCount > 0 && (
                    <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-medium text-[var(--ink-muted)]">
                      +{hiddenThemeCount} more
                    </span>
                  )}
                </div>
              ) : (
                <p className="mt-3 text-sm text-[var(--ink-muted)]">
                  Trust evidence and run synthesis to discover themes.
                </p>
              )}
              <p className="mt-3 text-xs text-[var(--ink-muted)]">
                {trustedTotal} trusted records · last synthesised{" "}
                {synthesisTimeLabel(project.last_synthesised_at)}
              </p>
            </div>

            {synthesisRunning ? (
              <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 px-3 py-2 text-xs font-medium text-yellow-300">
                Synthesis is updating themes.
              </div>
            ) : project.synthesis_stale || (themeRows.length === 0 && trustedTotal > 0) ? (
              <form action={runProjectSynthesisAction} className="shrink-0">
                <input type="hidden" name="project_id" value={project.id} />
                <button
                  type="submit"
                  className="rounded-lg border border-[var(--brand)] px-3 py-2 text-sm font-medium text-[var(--brand)] transition-colors hover:bg-[var(--brand)] hover:text-white"
                >
                  {project.synthesis_stale
                    ? "New trusted evidence - run synthesis →"
                    : "Run synthesis"}
                </button>
              </form>
            ) : null}
          </div>
        </section>
      )}

      {!project.frame?.trim() && (
        <Link
          href={`/projects/${project.id}/settings`}
          className="mb-8 block rounded-xl border border-[var(--brand)] bg-[var(--surface-1)] p-5 text-[var(--ink)] transition-colors hover:bg-[var(--surface-2)]"
        >
          <div className="text-sm font-semibold">Add a Project Frame to improve compose quality →</div>
          <div className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            Give drafts a clearer north star, audience, and decision context.
          </div>
        </Link>
      )}

      {/* Research gaps */}
      {project.gap_signals && project.gap_signals.length > 0 && (
        <section className="mb-8 rounded-xl border border-yellow-500/20 bg-[var(--surface-1)] p-5">
          <h2 className="text-sm font-semibold text-[var(--ink)]">Research gaps</h2>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            Areas from your project frame with little or no evidence coverage
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {project.gap_signals.map((gap, i) => (
              <div
                key={i}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface-0)] p-4"
              >
                <div className="flex items-start gap-2">
                  <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                    gap.severity === "high"
                      ? "bg-red-900/30 text-red-400"
                      : gap.severity === "medium"
                      ? "bg-yellow-900/30 text-yellow-400"
                      : "bg-[var(--surface-2)] text-[var(--ink-muted)]"
                  }`}>
                    {gap.severity}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-[var(--ink)]">{gap.area}</div>
                    <div className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">{gap.description}</div>
                    <div className="mt-2 text-xs text-[var(--brand)]">→ {gap.suggested_action}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="mb-8 grid gap-3 lg:grid-cols-4">
        <Link
          href={`/projects/${project.id}/evidence`}
          className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5 text-[var(--ink)] transition-colors hover:border-[var(--brand)]"
        >
          <div className="text-sm font-semibold">Review evidence</div>
          <div className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            Search, inspect, and trust source-backed claims.
          </div>
        </Link>
        <Link
          href={`/projects/${project.id}/sources`}
          className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5 text-[var(--ink)] transition-colors hover:border-[var(--brand)]"
        >
          <div className="text-sm font-semibold">Manage sources</div>
          <div className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            View segments, retry ingest, and remove source material.
          </div>
        </Link>
        <Link
          href={`/projects/${project.id}/compose`}
          className="rounded-xl border border-[var(--brand)] bg-[var(--brand)] p-5 text-white transition-colors hover:bg-[var(--brand-dim)]"
        >
          <div className="text-sm font-semibold">Draft artifact</div>
          <div className="mt-2 text-sm leading-6 text-white/75">
            Generate a working document grounded in trusted evidence.
          </div>
        </Link>
        <Link
          href={`/projects/${project.id}/ingest`}
          className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5 text-[var(--ink)] transition-colors hover:border-[var(--brand)]"
        >
          <div className="text-sm font-semibold">Add source material</div>
          <div className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            Paste a transcript, document, note, or raw research input.
          </div>
        </Link>
      </div>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)]">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-[var(--ink)]">Recent sources</h2>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">Latest raw inputs added to this workspace</p>
          </div>
          <Link
            href={`/projects/${project.id}/sources`}
            className="text-xs font-medium text-[var(--ink-muted)] transition-colors hover:text-[var(--brand)]"
          >
            View all
          </Link>
        </div>
        {sources && sources.length > 0 && (
          <div className="divide-y divide-[var(--border)]">
              {sources.map((s) => (
                <div
                  key={s.id}
                className="flex items-center justify-between gap-4 px-5 py-4"
                >
                  <div>
                    <div className="text-sm font-medium text-[var(--ink)]">{s.title}</div>
                    <div className="text-xs text-[var(--ink-muted)] mt-0.5 capitalize">{s.type}</div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    s.trust_scope === "trusted"
                      ? "bg-green-900/30 text-green-400"
                      : s.trust_scope === "pending"
                      ? "bg-yellow-900/30 text-yellow-400"
                      : "bg-red-900/30 text-red-400"
                  }`}>
                    {s.trust_scope}
                  </span>
                </div>
              ))}
          </div>
        )}
        {(!sources || sources.length === 0) && (
          <div className="px-5 py-12 text-center text-sm text-[var(--ink-muted)]">
            No sources yet. Add a transcript or note to start building evidence.
          </div>
        )}
      </section>
    </div>
  );
}
