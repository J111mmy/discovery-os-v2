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
        />

        {/* Page content — scrolls independently of the rail */}
        <main className="app-content">
          {children}
        </main>
      </div>
    </div>
  );
}
