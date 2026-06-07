import { createClient } from "@/lib/supabase/server";
import { getImpersonatedOrgName, isSuperAdmin } from "@/lib/auth/super-admin";
import { getActiveOrgId } from "@/lib/auth/org";
import { redirect } from "next/navigation";
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

  // ── Projects list for rail ─────────────────────────────────────
  let projects: RailProject[] = [];
  try {
    const orgId = await getActiveOrgId(user.id);
    if (orgId) {
      const { data } = await supabase
        .from("projects")
        .select("id, name")
        .eq("org_id", orgId)
        .order("created_at", { ascending: true });
      if (data) projects = data as RailProject[];
    }
  } catch {
    // Graceful degradation — rail renders without project list
  }

  // ── Directory counts for rail ──────────────────────────────────
  let dirCounts = { people: 0, companies: 0, competitors: 0 };
  try {
    const [{ count: pCount }, { count: cCount }, { count: compCount }] =
      await Promise.all([
        supabase.from("people").select("*", { count: "exact", head: true }),
        supabase.from("companies").select("*", { count: "exact", head: true }),
        supabase.from("competitors").select("*", { count: "exact", head: true }),
      ]);
    dirCounts = {
      people: pCount ?? 0,
      companies: cCount ?? 0,
      competitors: compCount ?? 0,
    };
  } catch {
    // Graceful degradation — counts show as 0
  }

  return (
    <div className="app-shell">
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
