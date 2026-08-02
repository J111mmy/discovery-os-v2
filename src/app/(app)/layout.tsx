import { createClient } from "@/lib/supabase/server";
import { getOrgScopedReadForUser } from "@/lib/auth/support-read";
import { getImpersonatedOrgName, isSuperAdmin } from "@/lib/auth/super-admin";
import { ACTIVE_PROJECT_FILTER } from "@/lib/projects/active-projects";
import { redirect } from "next/navigation";
import { PostHogIdentify } from "./components/PostHogIdentify";
import { Rail } from "./components/Rail";
import type { RailProject } from "./components/Rail";

interface AppLayoutProps {
  children: React.ReactNode;
}

export default async function AppLayout({ children }: AppLayoutProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // ── Auth guard (unchanged behaviour) ──────────────────────────
  if (!user) redirect("/login");

  const superAdmin = await isSuperAdmin(user.id);
  const impersonation = superAdmin ? await getImpersonatedOrgName(user.id) : null;
  const read = await getOrgScopedReadForUser(user.id, supabase);

  // ── Orgs this user belongs to, for the org switcher (#203) ─────
  // Skipped during support-mode impersonation — that already has its own
  // "viewing as X" banner and Exit control; a second switcher would conflict.
  // Regular (RLS-scoped) client only — no service role for this read.
  let userOrgs: { id: string; name: string }[] = [];
  if (!impersonation) {
    try {
      const { data: memberRows } = await supabase
        .from("org_members")
        .select("org_id")
        .eq("user_id", user.id)
        .order("joined_at", { ascending: true });
      const orgIds = (memberRows ?? []).map((row) => row.org_id as string);
      if (orgIds.length > 0) {
        const { data: orgRows } = await supabase
          .from("orgs")
          .select("id, name")
          .in("id", orgIds);
        const orgById = new Map((orgRows ?? []).map((org) => [org.id, org.name as string]));
        userOrgs = orgIds
          .filter((id) => orgById.has(id))
          .map((id) => ({ id, name: orgById.get(id) ?? "Untitled organisation" }));
      }
    } catch {
      // Graceful degradation — rail renders without the org switcher
    }
  }

  // ── Projects list for rail ─────────────────────────────────────
  let projects: RailProject[] = [];
  try {
    if (read) {
      const { data } = await read
        .from("projects")
        .select("id, name")
        .or(ACTIVE_PROJECT_FILTER)
        .order("created_at", { ascending: true });
      if (data) projects = data as RailProject[];
    }
  } catch {
    // Graceful degradation — rail renders without project list
  }

  // ── Directory counts for rail ──────────────────────────────────
  let dirCounts = { people: 0, companies: 0, competitors: 0 };
  try {
    if (read) {
      const [{ count: pCount }, { count: cCount }, { count: compCount }] =
        await Promise.all([
          read.from("people").select("*", { count: "exact", head: true }),
          read.from("companies").select("*", { count: "exact", head: true }),
          read.from("competitors").select("*", { count: "exact", head: true }),
        ]);
      dirCounts = {
        people: pCount ?? 0,
        companies: cCount ?? 0,
        competitors: compCount ?? 0,
      };
    }
  } catch {
    // Graceful degradation — counts show as 0
  }

  return (
    <div className="app-shell">
      <PostHogIdentify
        userId={user.id}
        userEmail={user.email ?? null}
        superAdmin={superAdmin}
      />

      {/* Support mode banner — spans full width, above rail + content.
          Behaviour unchanged from Phase 0. */}
      {impersonation && (
        <div className="impersonation-banner">
          <span>
            🛟 Support mode — viewing as <strong>{impersonation.orgName}</strong>
          </span>
          <form method="POST" action="/api/admin/impersonate">
            <input type="hidden" name="intent" value="exit" />
            <button type="submit" className="impersonation-exit-btn">
              Exit
            </button>
          </form>
        </div>
      )}

      {/* Rail + content */}
      <div className="app-body">
        <Rail
          userEmail={user.email ?? ""}
          superAdmin={superAdmin}
          projects={projects}
          dirCounts={dirCounts}
          orgs={userOrgs}
          currentOrgId={read?.orgId ?? null}
        />

        {/* Page content — scrolls independently of the rail */}
        <main className="app-content">
          {children}
        </main>
      </div>
    </div>
  );
}
