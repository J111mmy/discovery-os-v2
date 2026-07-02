// Super admin auth helpers
// Super admins have cross-org access and can impersonate any org for support.
// All checks go through the service client — the super_admins table has no RLS policies.

import { createServiceClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { ACTIVE_PROJECT_FILTER } from "@/lib/projects/active-projects";

export const IMPERSONATE_COOKIE = "disco_impersonate_org";

type OrgSummary = {
  id: string;
  name: string;
  slug: string;
  created_at: string;
};

type AgentRunSummary = {
  started_at: string;
  status: string;
};

export type OrgStats = OrgSummary & {
  member_count: number;
  project_count: number;
  source_count: number;
  last_source_at: string | null;
  last_run: AgentRunSummary | null;
};

type OrgMemberSummary = {
  user_id: string;
  role: string;
  display_name: string | null;
  joined_at: string;
};

type ProjectSummary = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  last_synthesised_at: string | null;
  archived: boolean | null;
};

type RecentAgentRun = {
  id: string;
  agent_type: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  error: string | null;
};

export type OrgDetail = {
  org: OrgSummary;
  members: OrgMemberSummary[];
  projects: ProjectSummary[];
  recent_runs: RecentAgentRun[];
};

type AgentPerformanceRunRow = {
  id: string;
  org_id: string;
  project_id: string | null;
  agent_type: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  error: string | null;
  model_used: string | null;
};

export type AgentPerformanceSummary = {
  agent_type: string;
  run_count: number;
  completed_count: number;
  failed_count: number;
  running_count: number;
  failure_rate: number;
  average_duration_ms: number | null;
  p95_duration_ms: number | null;
  last_run_at: string | null;
  last_status: string | null;
  model_count: number;
  org_count: number;
};

export type AgentPerformanceFailure = {
  id: string;
  agent_type: string;
  org_id: string;
  org_name: string | null;
  project_id: string | null;
  started_at: string;
  error: string | null;
};

export type AgentPerformanceDashboard = {
  window_days: number;
  total_runs: number;
  completed_runs: number;
  failed_runs: number;
  running_runs: number;
  average_duration_ms: number | null;
  agents: AgentPerformanceSummary[];
  recent_failures: AgentPerformanceFailure[];
};

// ─── Super admin check ────────────────────────────────────────────────────────

/** Returns true if the given user is in the super_admins table. */
export async function isSuperAdmin(userId: string): Promise<boolean> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("super_admins")
    .select("user_id")
    .eq("user_id", userId)
    .single();

  if (error || !data) return false;
  return true;
}

// ─── Impersonation ────────────────────────────────────────────────────────────

/**
 * Returns the org_id being impersonated, but ONLY if the user is a super admin.
 * Always verify super admin status before trusting this value.
 */
export async function getImpersonatedOrgId(userId: string): Promise<string | null> {
  const isAdmin = await isSuperAdmin(userId);
  if (!isAdmin) return null;

  const cookieStore = await cookies();
  return cookieStore.get(IMPERSONATE_COOKIE)?.value ?? null;
}

/**
 * Returns org name for the impersonated org, or null if not impersonating.
 * Used in the support banner.
 */
export async function getImpersonatedOrgName(
  userId: string
): Promise<{ orgId: string; orgName: string } | null> {
  const orgId = await getImpersonatedOrgId(userId);
  if (!orgId) return null;

  const supabase = createServiceClient();
  const { data } = await supabase
    .from("orgs")
    .select("id, name")
    .eq("id", orgId)
    .single();

  if (!data) return null;
  return { orgId: data.id, orgName: data.name };
}

// ─── Super admin data access ──────────────────────────────────────────────────

/** All orgs with stats — for the /admin dashboard. */
export async function getAllOrgsWithStats(): Promise<OrgStats[]> {
  const supabase = createServiceClient();

  const { data: orgs } = await supabase
    .from("orgs")
    .select("id, name, slug, created_at")
    .order("created_at", { ascending: false });

  const orgRows = (orgs ?? []) as OrgSummary[];
  if (orgRows.length === 0) return [];

  const orgIds = orgRows.map((org) => org.id);

  // Parallel: member counts, active project counts, source counts, last agent run per org
  const [membersResult, projectsResult, sourcesResult, runsResult] = await Promise.all([
    supabase
      .from("org_members")
      .select("org_id")
      .in("org_id", orgIds),
    supabase
      .from("projects")
      .select("org_id")
      .in("org_id", orgIds)
      .or(ACTIVE_PROJECT_FILTER),
    supabase
      .from("sources")
      .select("org_id, ingested_at")
      .in("org_id", orgIds)
      .order("ingested_at", { ascending: false }),
    supabase
      .from("agent_runs")
      .select("org_id, started_at, status")
      .in("org_id", orgIds)
      .order("started_at", { ascending: false })
      .limit(500),
  ]);

  const membersByOrg = new Map<string, number>();
  for (const m of membersResult.data ?? []) {
    membersByOrg.set(m.org_id, (membersByOrg.get(m.org_id) ?? 0) + 1);
  }

  const projectsByOrg = new Map<string, number>();
  for (const p of projectsResult.data ?? []) {
    projectsByOrg.set(p.org_id, (projectsByOrg.get(p.org_id) ?? 0) + 1);
  }

  const sourcesByOrg = new Map<string, number>();
  const lastSourceByOrg = new Map<string, string>();
  for (const s of sourcesResult.data ?? []) {
    sourcesByOrg.set(s.org_id, (sourcesByOrg.get(s.org_id) ?? 0) + 1);
    if (!lastSourceByOrg.has(s.org_id)) lastSourceByOrg.set(s.org_id, s.ingested_at);
  }

  const lastRunByOrg = new Map<string, AgentRunSummary>();
  for (const r of runsResult.data ?? []) {
    if (!lastRunByOrg.has(r.org_id)) lastRunByOrg.set(r.org_id, r);
  }

  return orgRows.map((org) => ({
    id: org.id,
    name: org.name,
    slug: org.slug,
    created_at: org.created_at,
    member_count: membersByOrg.get(org.id) ?? 0,
    project_count: projectsByOrg.get(org.id) ?? 0,
    source_count: sourcesByOrg.get(org.id) ?? 0,
    last_source_at: lastSourceByOrg.get(org.id) ?? null,
    last_run: lastRunByOrg.get(org.id) ?? null,
  }));
}

/** Full detail for a single org — for /admin/orgs/[orgId]. */
export async function getOrgDetail(orgId: string): Promise<OrgDetail | null> {
  const supabase = createServiceClient();

  const [orgResult, membersResult, projectsResult, recentRunsResult] = await Promise.all([
    supabase.from("orgs").select("id, name, slug, created_at").eq("id", orgId).single(),
    supabase
      .from("org_members")
      .select("user_id, role, display_name, joined_at")
      .eq("org_id", orgId)
      .order("joined_at", { ascending: true }),
    supabase
      .from("projects")
      .select("id, name, description, created_at, last_synthesised_at, archived")
      .eq("org_id", orgId)
      .or(ACTIVE_PROJECT_FILTER)
      .order("created_at", { ascending: false }),
    supabase
      .from("agent_runs")
      .select("id, agent_type, status, started_at, completed_at, error")
      .eq("org_id", orgId)
      .order("started_at", { ascending: false })
      .limit(20),
  ]);

  if (!orgResult.data) return null;

  return {
    org: orgResult.data as OrgSummary,
    members: (membersResult.data ?? []) as OrgMemberSummary[],
    projects: (projectsResult.data ?? []) as ProjectSummary[],
    recent_runs: (recentRunsResult.data ?? []) as RecentAgentRun[],
  };
}

function durationMs(row: AgentPerformanceRunRow): number | null {
  if (!row.completed_at) return null;
  const duration = new Date(row.completed_at).getTime() - new Date(row.started_at).getTime();
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index] ?? null;
}

/** Super-admin read-only agent performance summary for /admin/agent-quality. */
export async function getAgentPerformanceDashboard(
  windowDays = 14
): Promise<AgentPerformanceDashboard> {
  const supabase = createServiceClient();
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("agent_runs")
    .select("id, org_id, project_id, agent_type, status, started_at, completed_at, error, model_used")
    .gte("started_at", since)
    .order("started_at", { ascending: false })
    .limit(2500);

  if (error) {
    throw new Error(`Failed to load agent performance: ${error.message}`);
  }

  const rows = (data ?? []) as AgentPerformanceRunRow[];
  const orgIds = Array.from(new Set(rows.map((row) => row.org_id)));
  const { data: orgData } =
    orgIds.length > 0
      ? await supabase.from("orgs").select("id, name").in("id", orgIds)
      : { data: [] };
  const orgNameById = new Map(
    ((orgData ?? []) as Array<{ id: string; name: string }>).map((org) => [org.id, org.name])
  );

  const rowsByAgent = new Map<string, AgentPerformanceRunRow[]>();
  for (const row of rows) {
    const current = rowsByAgent.get(row.agent_type) ?? [];
    current.push(row);
    rowsByAgent.set(row.agent_type, current);
  }

  const agents = Array.from(rowsByAgent.entries())
    .map(([agentType, agentRows]) => {
      const durations = agentRows
        .map(durationMs)
        .filter((duration): duration is number => duration !== null);
      const failedCount = agentRows.filter((row) => row.status === "failed").length;
      const completedCount = agentRows.filter((row) => row.status === "completed").length;
      const runningCount = agentRows.filter((row) => row.status === "running").length;
      const modelCount = new Set(agentRows.map((row) => row.model_used).filter(Boolean)).size;
      const orgCount = new Set(agentRows.map((row) => row.org_id)).size;

      return {
        agent_type: agentType,
        run_count: agentRows.length,
        completed_count: completedCount,
        failed_count: failedCount,
        running_count: runningCount,
        failure_rate: agentRows.length === 0 ? 0 : failedCount / agentRows.length,
        average_duration_ms: average(durations),
        p95_duration_ms: percentile(durations, 95),
        last_run_at: agentRows[0]?.started_at ?? null,
        last_status: agentRows[0]?.status ?? null,
        model_count: modelCount,
        org_count: orgCount,
      } satisfies AgentPerformanceSummary;
    })
    .sort((a, b) => {
      if (b.failed_count !== a.failed_count) return b.failed_count - a.failed_count;
      return b.run_count - a.run_count;
    });

  const durations = rows.map(durationMs).filter((duration): duration is number => duration !== null);
  const recentFailures = rows
    .filter((row) => row.status === "failed")
    .slice(0, 12)
    .map((row) => ({
      id: row.id,
      agent_type: row.agent_type,
      org_id: row.org_id,
      org_name: orgNameById.get(row.org_id) ?? null,
      project_id: row.project_id,
      started_at: row.started_at,
      error: row.error,
    }));

  return {
    window_days: windowDays,
    total_runs: rows.length,
    completed_runs: rows.filter((row) => row.status === "completed").length,
    failed_runs: rows.filter((row) => row.status === "failed").length,
    running_runs: rows.filter((row) => row.status === "running").length,
    average_duration_ms: average(durations),
    agents,
    recent_failures: recentFailures,
  };
}
