// Project workspace — data fetching only; all render is delegated to WorkspaceView.
import { createClient } from "@/lib/supabase/server";
import { getProjectForUser } from "@/lib/auth/org";
import { getProjectOrgReadForUser } from "@/lib/auth/support-read";
import { redirect, notFound } from "next/navigation";
import { computeConfidence } from "@/lib/confidence";
import {
  createProjectFromOpportunityAction,
  runProjectSynthesisAction,
  updateProjectOpportunityStatusAction,
} from "./actions";
import { WorkspaceView } from "./workspace-client";
import type {
  ProjectOpportunityConfidence,
  ProjectOpportunityStatus,
} from "@/types/database";

interface Props {
  params: { projectId: string };
}

type ThemeRow = {
  id: string;
  label: string;
  evidence_count: number;
};

type ProblemPreview = {
  id: string;
  title: string;
  evidence_link_count: number;
};

type ActivityRun = {
  id: string;
  status: "running" | "completed" | "failed";
  started_at: string;
  completed_at: string | null;
};

type SuggestedWorkspacePreview = {
  id: string;
  title: string;
  description: string | null;
  suggested_frame: string | null;
  confidence: ProjectOpportunityConfidence;
  status: ProjectOpportunityStatus;
  supporting_evidence_count: number;
  source_project_count: number;
};

type GapSignal = {
  area: string;
  description: string;
  severity: string;
  suggested_action: string;
};

function synthesisTimeLabel(value: string | null): string {
  if (!value) return "not synthesised yet";
  const diffMs = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(diffMs / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function activityPulse(runs: ActivityRun[]) {
  const twoDaysAgo = Date.now() - 48 * 60 * 60 * 1000;
  const recent = runs.filter((r) => {
    const val = r.completed_at ?? r.started_at;
    return new Date(val).getTime() >= twoDaysAgo;
  });
  if (recent.length === 0) return null;

  if (recent.some((r) => r.status === "failed"))
    return {
      tone: "attention" as const,
      text: "Some insights need attention — check your source pages.",
    };
  if (recent.some((r) => r.status === "running"))
    return { tone: "running" as const, text: "Working through your latest session…" };

  const mostRecentCompleted = recent
    .map((r) => r.completed_at)
    .filter((v): v is string => Boolean(v))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];

  return {
    tone: "quiet" as const,
    text: `Last updated ${synthesisTimeLabel(mostRecentCompleted ?? recent[0].started_at)}`,
  };
}

export default async function ProjectPage({ params }: Props) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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
  const read = await getProjectOrgReadForUser({
    userId: user.id,
    orgId: project.org_id,
    memberClient: supabase,
  });

  // gap_signals added by migration 0011 — optional fetch so a missing migration
  // doesn't 404 the whole page
  const gapSignals = await (async (): Promise<GapSignal[] | null> => {
    try {
      const { data } = await read
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
    { data: themes, count: themeCount },
    { count: problemCount },
    { data: problemPreviews },
    { count: runningSynthesisCount },
    { data: trustedEvidenceMeta },
    { data: activityRuns },
  ] = await Promise.all([
    read
      .from("evidence")
      .select("*", { count: "exact", head: true })
      .eq("project_id", project.id),
    read
      .from("evidence")
      .select("*", { count: "exact", head: true })
      .eq("project_id", project.id)
      .eq("trust_scope", "trusted"),
    read
      .from("evidence")
      .select("*", { count: "exact", head: true })
      .eq("project_id", project.id)
      .eq("trust_scope", "pending"),
    read
      .from("artifacts")
      .select("*", { count: "exact", head: true })
      .eq("project_id", project.id),
    read
      .from("themes")
      .select("id, label, evidence_count", { count: "exact" })
      .eq("project_id", project.id)
      .order("evidence_count", { ascending: false })
      .limit(8),
    read
      .from("problems")
      .select("*", { count: "exact", head: true })
      .eq("project_id", project.id)
      .in("status", ["surfaced", "acknowledged", "active"]),
    read
      .from("problems")
      .select("id, title, source_evidence_ids")
      .eq("project_id", project.id)
      .in("status", ["surfaced", "acknowledged", "active"])
      .order("created_at", { ascending: false })
      .limit(5),
    read
      .from("agent_runs")
      .select("*", { count: "exact", head: true })
      .eq("project_id", project.id)
      .eq("agent_type", "project-synthesis")
      .eq("status", "running"),
    // Lightweight for confidence scoring: source diversity + recency
    read
      .from("evidence")
      .select("source_id, created_at")
      .eq("project_id", project.id)
      .eq("trust_scope", "trusted")
      .order("created_at", { ascending: false }),
    read
      .from("agent_runs")
      .select("id, status, started_at, completed_at")
      .eq("project_id", project.id)
      .order("started_at", { ascending: false })
      .limit(10),
  ]);

  const themeRows = (themes ?? []) as ThemeRow[];
  const hiddenThemeCount = Math.max((themeCount ?? themeRows.length) - themeRows.length, 0);
  const trustedTotal = trustedCount ?? 0;
  const synthesisRunning = (runningSynthesisCount ?? 0) > 0;
  const pulse = activityPulse((activityRuns ?? []) as ActivityRun[]);

  // Confidence scoring — weighted model via src/lib/confidence.ts
  const trustedMeta = (trustedEvidenceMeta ?? []) as Array<{
    source_id: string;
    created_at: string;
  }>;
  const confidence = computeConfidence({
    trustedCount: trustedTotal,
    sourceIds: trustedMeta.map((r) => r.source_id),
    mostRecentAt: trustedMeta[0]?.created_at ?? null,
    themeCount: themeCount ?? 0,
    problemCount: problemCount ?? 0,
  });

  // Suggested workspaces from project_opportunities (adjacent discovery/project areas).
  // Product opportunities live separately in the opportunities table and /opportunities route.
  const suggestedWorkspaceRows = await (async (): Promise<SuggestedWorkspacePreview[]> => {
    try {
      const { data } = await read
        .from("project_opportunity_projects")
        .select(
          "project_opportunities(id, title, description, suggested_frame, confidence, status, supporting_evidence_count, source_project_count)"
        )
        .eq("project_id", project.id)
        .eq("relationship", "source");

      return (
        (
          data ?? []
        ) as Array<{
          project_opportunities: SuggestedWorkspacePreview | SuggestedWorkspacePreview[] | null;
        }>
      )
        .flatMap((row) => {
          if (!row.project_opportunities) return [];
          return Array.isArray(row.project_opportunities)
            ? row.project_opportunities
            : [row.project_opportunities];
        })
        .filter(
          (workspace) => workspace.status === "suggested" || workspace.status === "watching"
        )
        .sort((a, b) => {
          const score = { high: 3, medium: 2, low: 1 };
          return score[b.confidence] - score[a.confidence];
        })
        .slice(0, 3);
    } catch {
      return [];
    }
  })();

  return (
    <WorkspaceView
      project={{
        id: project.id,
        name: project.name,
        description: project.description,
        frame: project.frame,
        synthesis_stale: project.synthesis_stale,
        last_synthesised_at: project.last_synthesised_at,
      }}
      confidenceScore={confidence.score}
      weakestHint={confidence.weakest.hint}
      pulse={pulse}
      evidenceCount={evidenceCount ?? 0}
      trustedTotal={trustedTotal}
      pendingCount={pendingCount ?? 0}
      artifactCount={artifactCount ?? 0}
      themeRows={themeRows}
      hiddenThemeCount={hiddenThemeCount}
      problemCount={problemCount ?? 0}
      problemPreviews={((problemPreviews ?? []) as Array<{
        id: string;
        title: string;
        source_evidence_ids?: unknown;
      }>).map((raw) => {
        return {
          id: raw.id,
          title: raw.title,
          evidence_link_count: Array.isArray(raw.source_evidence_ids)
            ? raw.source_evidence_ids.length
            : 0,
        } satisfies ProblemPreview;
      })}
      gapSignals={gapSignals}
      suggestedWorkspaceRows={suggestedWorkspaceRows}
      synthesisRunning={synthesisRunning}
      onSynthesize={runProjectSynthesisAction}
      onOpportunityStatus={updateProjectOpportunityStatusAction}
      onCreateFromOpportunity={createProjectFromOpportunityAction}
    />
  );
}
