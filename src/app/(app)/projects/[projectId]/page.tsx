// Project workspace — evidence browser + compose entry point
import { createClient } from "@/lib/supabase/server";
import { getProjectForUser } from "@/lib/auth/org";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import {
  createProjectFromOpportunityAction,
  runProjectSynthesisAction,
  updateProjectOpportunityStatusAction,
} from "./actions";
import { computeConfidence } from "@/lib/confidence";
import { sourceTypeLabel, trustScopeLabel, trustScopeClasses, priorityLabel, priorityClasses } from "@/lib/labels";
import type { ProjectOpportunityConfidence, ProjectOpportunityStatus } from "@/types/database";

interface Props {
  params: { projectId: string };
}

type ThemeRow = {
  id: string;
  label: string;
  evidence_count: number;
};

type ProductRequestPreview = {
  id: string;
  description: string;
  requester_name: string | null;
  priority_signal: "nice_to_have" | "important" | "critical";
  status: string;
};

type ActivityRun = {
  id: string;
  status: "running" | "completed" | "failed";
  started_at: string;
  completed_at: string | null;
};

type OpportunityPreview = {
  id: string;
  title: string;
  description: string | null;
  suggested_frame: string | null;
  confidence: ProjectOpportunityConfidence;
  status: ProjectOpportunityStatus;
  supporting_evidence_count: number;
  source_project_count: number;
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

function activityPulse(runs: ActivityRun[]) {
  const twoDaysAgo = Date.now() - 48 * 60 * 60 * 1000;
  const recentRuns = runs.filter((run) => {
    const value = run.completed_at ?? run.started_at;
    return new Date(value).getTime() >= twoDaysAgo;
  });

  if (recentRuns.length === 0) return null;

  if (recentRuns.some((run) => run.status === "failed")) {
    return {
      tone: "attention" as const,
      text: "Some insights need attention - check your source pages.",
    };
  }

  if (recentRuns.some((run) => run.status === "running")) {
    return {
      tone: "running" as const,
      text: "Working through your latest session...",
    };
  }

  const mostRecentCompleted = recentRuns
    .map((run) => run.completed_at)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];

  return {
    tone: "quiet" as const,
    text: `Last updated ${synthesisTimeLabel(mostRecentCompleted ?? recentRuns[0].started_at)}`,
  };
}

function confidenceClasses(confidence: ProjectOpportunityConfidence) {
  if (confidence === "high") return "border-green-500/20 bg-green-500/10 text-green-300";
  if (confidence === "medium") return "border-yellow-500/20 bg-yellow-500/10 text-yellow-300";
  return "border-[var(--border)] bg-[var(--surface-2)] text-[var(--ink-muted)]";
}

function opportunityStatusLabel(status: ProjectOpportunityStatus) {
  if (status === "watching") return "Watching";
  if (status === "accepted") return "Created";
  if (status === "dismissed") return "Dismissed";
  return "Suggested project";
}

function firstFrameLine(frame: string | null) {
  if (!frame) return null;
  return frame
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !["Problem", "Hypothesis", "Research Areas", "Success Metrics"].includes(line));
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
    created_at: string;
  }>(
    user.id,
    params.projectId,
    "id, org_id, name, description, frame, synthesis_stale, last_synthesised_at, created_at"
  );

  if (!project) notFound();

  // gap_signals is added by migration 0011 — fetch separately so a missing
  // migration doesn't 404 the entire workspace page
  type GapSignal = { area: string; description: string; severity: string; suggested_action: string };
  const gapSignals = await (async (): Promise<GapSignal[] | null> => {
    try {
      const { data } = await supabase
        .from("projects")
        .select("gap_signals")
        .eq("id", project.id)
        .single();
      return (data as { gap_signals: GapSignal[] | null } | null)?.gap_signals ?? null;
    } catch {
      return null;
    }
  })();

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
    { data: productRequests, count: productRequestCount },
    { data: trustedEvidenceMeta },
    { data: activityRuns },
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
      supabase
        .from("product_requests")
        .select("id, description, requester_name, priority_signal, status", { count: "exact" })
        .eq("org_id", project.org_id)
        .eq("project_id", project.id)
        .order("created_at", { ascending: false })
        .limit(4),
      // Lightweight query for confidence scoring: source_id + created_at per trusted record.
      // Used to compute source diversity (distinct source_ids) and recency (max created_at).
      supabase
        .from("evidence")
        .select("source_id, created_at")
        .eq("org_id", project.org_id)
        .eq("project_id", project.id)
        .eq("trust_scope", "trusted")
        .order("created_at", { ascending: false }),
      supabase
        .from("agent_runs")
        .select("id, status, started_at, completed_at")
        .eq("org_id", project.org_id)
        .eq("project_id", project.id)
        .order("started_at", { ascending: false })
        .limit(10),
    ]);

  const themeRows = (themes ?? []) as ThemeRow[];
  const productRequestRows = (productRequests ?? []) as ProductRequestPreview[];
  const hiddenThemeCount = Math.max((themeCount ?? themeRows.length) - themeRows.length, 0);
  const productRequestTotal = productRequestCount ?? productRequestRows.length;
  const trustedTotal = trustedCount ?? 0;
  const hasTrustedEvidence = trustedTotal > 0;
  const synthesisRunning = (runningSynthesisCount ?? 0) > 0;
  const pulse = activityPulse((activityRuns ?? []) as ActivityRun[]);

  const opportunityRows = await (async (): Promise<OpportunityPreview[]> => {
    try {
      const { data } = await supabase
        .from("project_opportunity_projects")
        .select(
          "project_opportunities(id, title, description, suggested_frame, confidence, status, supporting_evidence_count, source_project_count, created_at)"
        )
        .eq("org_id", project.org_id)
        .eq("project_id", project.id)
        .eq("relationship", "source");

      return ((data ?? []) as Array<{ project_opportunities: OpportunityPreview | OpportunityPreview[] | null }>)
        .flatMap((row) => {
          if (!row.project_opportunities) return [];
          return Array.isArray(row.project_opportunities)
            ? row.project_opportunities
            : [row.project_opportunities];
        })
        .filter((opportunity) => opportunity.status === "suggested" || opportunity.status === "watching")
        .sort((a, b) => {
          const score = { high: 3, medium: 2, low: 1 };
          return score[b.confidence] - score[a.confidence];
        })
        .slice(0, 3);
    } catch {
      return [];
    }
  })();

  // Confidence scoring — weighted model via src/lib/confidence.ts
  // Signals: evidence depth (30), source diversity (30), recency (20), synthesis breadth (20)
  const trustedMeta = (trustedEvidenceMeta ?? []) as Array<{ source_id: string; created_at: string }>;
  const confidence = computeConfidence({
    trustedCount: trustedTotal,
    sourceIds: trustedMeta.map((r) => r.source_id),
    mostRecentAt: trustedMeta[0]?.created_at ?? null,
    themeCount: themeCount ?? 0,
    problemCount: problemCount ?? 0,
  });
  const { score: confidenceScore, label: confidenceLabelText, colour: confidenceColour, weakest: weakestSignal } = confidence;

  return (
    <div className="mx-auto max-w-6xl">
      {/* Page header — sidebar CTA handles Add evidence; no duplicate button here */}
      <div className="mb-6">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
          Workspace
        </div>
        <h1 className="text-2xl font-semibold text-[var(--ink)]">{project.name}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">
          {project.description || "Turn raw discovery input into trusted evidence and working artifacts."}
        </p>
      </div>

      {/* Project context prompt — first element so new users see it immediately */}
      {!project.frame?.trim() && (
        <Link
          href={`/projects/${project.id}/settings`}
          className="mb-6 block rounded-xl border border-[var(--brand)] bg-[var(--surface-1)] p-5 text-[var(--ink)] transition-colors hover:bg-[var(--surface-2)]"
        >
          <div className="text-sm font-semibold">Set up your project context →</div>
          <div className="mt-1.5 text-sm leading-6 text-[var(--ink-muted)]">
            Tell the system what you&apos;re researching and who you&apos;re talking to — the AI gets smarter with each field you fill in.
          </div>
        </Link>
      )}

      {pulse && (
        <div
          className={`mb-5 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${
            pulse.tone === "attention"
              ? "border-red-500/20 bg-red-500/10 text-red-200"
              : pulse.tone === "running"
              ? "border-[var(--brand)] bg-[rgba(124,109,250,0.10)] text-[var(--ink)]"
              : "border-[var(--border)] bg-[var(--surface-1)] text-[var(--ink-muted)]"
          }`}
        >
          {pulse.tone === "running" && (
            <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--brand)]" />
          )}
          <span>{pulse.text}</span>
        </div>
      )}

      {/* Stats — compact one-liner, hidden entirely when project is empty */}
      {(evidenceCount ?? 0) > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="text-[var(--ink-muted)]">{evidenceCount} evidence</span>
          <span className="text-[var(--ink-faint)]">·</span>
          <span className="text-green-400">{trustedCount ?? 0} trusted</span>
          <span className="text-[var(--ink-faint)]">·</span>
          <Link
            href={`/projects/${project.id}/evidence`}
            className={`transition-colors hover:text-[var(--ink)] ${(pendingCount ?? 0) > 0 ? "text-yellow-400" : "text-[var(--ink-muted)]"}`}
          >
            {pendingCount ?? 0} needs review
          </Link>
          <span className="text-[var(--ink-faint)]">·</span>
          <Link
            href={`/projects/${project.id}/documents`}
            className="text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]"
          >
            {artifactCount ?? 0} documents
          </Link>
        </div>
      )}

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
                {confidenceLabelText}
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
              <div
                className={`h-full rounded-full transition-all ${confidenceColour}`}
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

      {/* Project context prompt has moved to the top of the page (above the confidence bar) */}

      {/* Research gaps */}
      {gapSignals && gapSignals.length > 0 && (
        <section className="mb-8 rounded-xl border border-yellow-500/20 bg-[var(--surface-1)] p-5">
          <h2 className="text-sm font-semibold text-[var(--ink)]">Research gaps</h2>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            Areas from your project frame with little or no evidence coverage
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {gapSignals!.map((gap, i) => (
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

      {opportunityRows.length > 0 && (
        <section className="mb-8 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-[var(--ink)]">
                Signals for new workspaces
              </h2>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--ink-muted)]">
                Evidence in this project is pointing at adjacent discovery areas. Review before creating
                a new project so the workspace stays intentional.
              </p>
            </div>
            <span className="rounded-full border border-[var(--border)] bg-[var(--surface-0)] px-2.5 py-1 text-xs font-medium text-[var(--ink-muted)]">
              {opportunityRows.length} active
            </span>
          </div>

          <div className="grid gap-3">
            {opportunityRows.map((opportunity) => {
              const frameLine = firstFrameLine(opportunity.suggested_frame);

              return (
                <article
                  key={opportunity.id}
                  className="rounded-xl border border-[var(--border)] bg-[var(--surface-0)] p-4"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-[var(--border)] bg-[var(--surface-1)] px-2 py-0.5 text-xs font-medium text-[var(--ink-muted)]">
                          {opportunityStatusLabel(opportunity.status)}
                        </span>
                        <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${confidenceClasses(opportunity.confidence)}`}>
                          {opportunity.confidence} confidence
                        </span>
                      </div>
                      <h3 className="text-base font-semibold text-[var(--ink)]">
                        {opportunity.title}
                      </h3>
                      {opportunity.description && (
                        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-muted)]">
                          {opportunity.description}
                        </p>
                      )}
                      {frameLine && (
                        <p className="mt-2 max-w-3xl text-xs leading-5 text-[var(--ink-faint)]">
                          Suggested frame: {frameLine}
                        </p>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--ink-faint)]">
                        <span>{opportunity.supporting_evidence_count} evidence record{opportunity.supporting_evidence_count === 1 ? "" : "s"}</span>
                        <span>·</span>
                        <span>{opportunity.source_project_count} source project{opportunity.source_project_count === 1 ? "" : "s"}</span>
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end">
                      <form action={createProjectFromOpportunityAction}>
                        <input type="hidden" name="project_id" value={project.id} />
                        <input type="hidden" name="opportunity_id" value={opportunity.id} />
                        <button
                          type="submit"
                          className="rounded-lg bg-[var(--brand)] px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[var(--brand-dim)]"
                        >
                          Create project
                        </button>
                      </form>
                      {opportunity.status !== "watching" && (
                        <form action={updateProjectOpportunityStatusAction}>
                          <input type="hidden" name="project_id" value={project.id} />
                          <input type="hidden" name="opportunity_id" value={opportunity.id} />
                          <input type="hidden" name="status" value="watching" />
                          <button
                            type="submit"
                            className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--ink-muted)] transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)]"
                          >
                            Keep watching
                          </button>
                        </form>
                      )}
                      <form action={updateProjectOpportunityStatusAction}>
                        <input type="hidden" name="project_id" value={project.id} />
                        <input type="hidden" name="opportunity_id" value={opportunity.id} />
                        <input type="hidden" name="status" value="dismissed" />
                        <button
                          type="submit"
                          className="rounded-lg border border-red-500/20 px-3 py-2 text-xs font-medium text-red-300 transition-colors hover:border-red-400/50 hover:bg-red-500/10"
                        >
                          Dismiss
                        </button>
                      </form>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {productRequestTotal > 0 && (
        <section className="mb-8 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-[var(--ink)]">Product requests</h2>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">
                {productRequestTotal} request{productRequestTotal === 1 ? "" : "s"} captured from recent sessions
              </p>
            </div>
            <Link
              href={`/projects/${project.id}/sources`}
              className="text-xs font-medium text-[var(--ink-muted)] transition-colors hover:text-[var(--brand)]"
            >
              Review sources
            </Link>
          </div>
          <div className="grid gap-2 lg:grid-cols-2">
            {productRequestRows.map((request) => {
              const priorityClass = priorityClasses(request.priority_signal);
              const priorityLabelText = priorityLabel(request.priority_signal);

              return (
                <div
                  key={request.id}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface-0)] p-4"
                >
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${priorityClass}`}>
                      {priorityLabelText}
                    </span>
                    <span className="text-xs capitalize text-[var(--ink-faint)]">
                      {request.status.replace("_", " ")}
                    </span>
                  </div>
                  <p className="text-sm leading-6 text-[var(--ink)]">{request.description}</p>
                  {request.requester_name && (
                    <p className="mt-2 text-xs text-[var(--ink-faint)]">{request.requester_name}</p>
                  )}
                </div>
              );
            })}
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
        {/* Draft artifact — promoted only when trusted evidence exists to draft from */}
        <Link
          href={`/projects/${project.id}/compose`}
          className={`rounded-xl border p-5 transition-colors ${
            hasTrustedEvidence
              ? "border-[var(--brand)] bg-[var(--brand)] text-white hover:bg-[var(--brand-dim)]"
              : "border-[var(--border)] bg-[var(--surface-1)] text-[var(--ink)] hover:border-[var(--brand)]"
          }`}
        >
          <div className="text-sm font-semibold">Draft artifact</div>
          <div className={`mt-2 text-sm leading-6 ${hasTrustedEvidence ? "text-white/75" : "text-[var(--ink-muted)]"}`}>
            Generate a working document grounded in trusted evidence.
          </div>
        </Link>
        {/* Add source material — promoted when there's nothing yet to draft from */}
        <Link
          href={`/projects/${project.id}/ingest`}
          className={`rounded-xl border p-5 transition-colors ${
            !hasTrustedEvidence
              ? "border-[var(--brand)] bg-[var(--brand)] text-white hover:bg-[var(--brand-dim)]"
              : "border-[var(--border)] bg-[var(--surface-1)] text-[var(--ink)] hover:border-[var(--brand)]"
          }`}
        >
          <div className="text-sm font-semibold">Add source material</div>
          <div className={`mt-2 text-sm leading-6 ${!hasTrustedEvidence ? "text-white/75" : "text-[var(--ink-muted)]"}`}>
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
                <Link
                  key={s.id}
                  href={`/projects/${project.id}/sources/${s.id}`}
                  className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-[var(--surface-2)]"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-[var(--ink)]">{s.title}</div>
                    <div className="mt-0.5 text-xs text-[var(--ink-muted)]">{sourceTypeLabel(s.type)}</div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${trustScopeClasses(s.trust_scope)}`}>
                    {trustScopeLabel(s.trust_scope)}
                  </span>
                </Link>
              ))}
          </div>
        )}
        {(!sources || sources.length === 0) && (
          <div className="px-5 py-12 text-center">
            <div className="text-sm font-medium text-[var(--ink)]">No sessions yet</div>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--ink-muted)]">
              Add a transcript or note to start building evidence.
            </p>
            <Link
              href={`/projects/${project.id}/ingest`}
              className="mt-5 inline-flex rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-dim)]"
            >
              Add your first transcript →
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
