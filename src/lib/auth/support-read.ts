import { cookies } from "next/headers";
import { getActiveOrgId } from "@/lib/auth/org";
import { IMPERSONATE_COOKIE, isSuperAdmin } from "@/lib/auth/super-admin";
import { createClient, createServiceClient } from "@/lib/supabase/server";

type ReadClient = Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createServiceClient>;
type SelectOptions = {
  count?: "exact" | "planned" | "estimated";
  head?: boolean;
};

const ORG_SCOPED_TABLES = [
  "actions",
  "agent_runs",
  "artifact_claim_evidence",
  "artifact_claims",
  "artifact_evidence",
  "artifact_opportunities",
  "artifact_problems",
  "artifact_themes",
  "artifact_versions",
  "artifacts",
  "companies",
  "company_projects",
  "competitors",
  "evidence",
  "evidence_entities",
  "evidence_themes",
  "evidence_topics",
  "ingest_jobs",
  "opportunities",
  "opportunity_evidence",
  "opportunity_themes",
  "org_invites",
  "org_members",
  "people",
  "person_projects",
  "problem_evidence",
  "problem_opportunities",
  "problem_themes",
  "problem_topics",
  "problems",
  "product_requests",
  "project_opportunities",
  "project_opportunity_evidence",
  "project_opportunity_projects",
  "projects",
  "sources",
  "source_segments",
  "theme_evidence",
  "theme_topics",
  "themes",
  "topics",
] as const;

export type OrgScopedTable = (typeof ORG_SCOPED_TABLES)[number];

const ORG_SCOPED_TABLE_SET = new Set<string>(ORG_SCOPED_TABLES);

function assertOrgId(orgId: string) {
  if (!orgId.trim()) {
    throw new Error("Support read attempted without a scoped org id");
  }
}

/**
 * Read-only org-scoped data access.
 *
 * Threat model: the impersonation cookie is transport only. A forged cookie does
 * not help a non-admin because getSupportModeOrgRead() first verifies the caller
 * against super_admins, then verifies the target org exists. The raw service
 * client is never returned to call sites; support-mode reads can only start from
 * a select with org_id already applied.
 */
export class OrgScopedRead {
  readonly orgId: string;
  readonly mode: "member" | "support";
  private readonly client: ReadClient;

  constructor(client: ReadClient, orgId: string, mode: "member" | "support") {
    assertOrgId(orgId);
    this.client = client;
    this.orgId = orgId;
    this.mode = mode;
  }

  from(table: OrgScopedTable) {
    if (!ORG_SCOPED_TABLE_SET.has(table)) {
      throw new Error(`Table ${table} is not approved for org-scoped support reads`);
    }

    return {
      select: (columns: string, options?: SelectOptions) => {
        assertOrgId(this.orgId);
        return this.client.from(table).select(columns, options).eq("org_id", this.orgId);
      },
    };
  }

  org(select: string) {
    assertOrgId(this.orgId);
    return this.client.from("orgs").select(select).eq("id", this.orgId);
  }
}

export function createUserOrgRead(client: ReadClient, orgId: string) {
  return new OrgScopedRead(client, orgId, "member");
}

export async function getSupportModeOrgRead(userId: string): Promise<OrgScopedRead | null> {
  try {
    const admin = await isSuperAdmin(userId);
    if (!admin) return null;

    const cookieStore = await cookies();
    const impersonatedOrgId = cookieStore.get(IMPERSONATE_COOKIE)?.value?.trim();
    if (!impersonatedOrgId) return null;

    const service = createServiceClient();
    const { data, error } = await service
      .from("orgs")
      .select("id")
      .eq("id", impersonatedOrgId)
      .maybeSingle();

    if (error || !data?.id) return null;
    return new OrgScopedRead(service, data.id, "support");
  } catch {
    return null;
  }
}

export async function getOrgScopedReadForUser(
  userId: string,
  memberClient?: ReadClient
): Promise<OrgScopedRead | null> {
  const supportRead = await getSupportModeOrgRead(userId);
  if (supportRead) return supportRead;

  const client = memberClient ?? (await createClient());
  const orgId = await getActiveOrgId(userId);
  if (!orgId) return null;

  return createUserOrgRead(client, orgId);
}

export async function getProjectOrgReadForUser({
  userId,
  orgId,
  memberClient,
}: {
  userId: string;
  orgId: string;
  memberClient?: ReadClient;
}): Promise<OrgScopedRead> {
  const supportRead = await getSupportModeOrgRead(userId);
  if (supportRead?.orgId === orgId) return supportRead;

  const client = memberClient ?? (await createClient());
  return createUserOrgRead(client, orgId);
}
