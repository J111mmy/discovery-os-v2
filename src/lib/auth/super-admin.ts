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
