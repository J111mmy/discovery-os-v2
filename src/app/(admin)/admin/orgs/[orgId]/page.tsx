// /admin/orgs/[orgId] — org detail: members, projects, recent agent runs
import { createClient } from "@/lib/supabase/server";
import { isSuperAdmin, getOrgDetail } from "@/lib/auth/super-admin";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";

interface Props {
  params: { orgId: string };
}

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
};

const AGENT_LABELS: Record<string, string> = {
  "entity-extraction": "Entity extraction",
  "session-review": "Session review",
  "action-extraction": "Action extraction",
  "project-synthesis": "Project synthesis",
  "problem-discovery": "Problem discovery",
  "gap-detection": "Gap detection",
  "frame-draft": "Frame draft",
  "person-digest": "Person profile",
  "company-digest": "Company profile",
  "competitor-digest": "Competitor profile",
  "claim-verification": "Claim verification",
  "evidence-grading": "Evidence grading",
  "compose": "Compose",
};

function relativeTime(value: string | null): string {
  if (!value) return "—";
  const diffMs = Date.now() - new Date(value).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default async function OrgDetailPage({ params }: Props) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isSuperAdmin(user.id))) redirect("/projects");

  const detail = await getOrgDetail(params.orgId);
  if (!detail) notFound();

  const { org, members, projects, recent_runs } = detail;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Link href="/admin" className="mb-3 inline-flex text-xs text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors">
            ← All organisations
          </Link>
          <h1 className="text-2xl font-semibold text-[var(--ink)]">{org.name}</h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            {org.slug} · Created {new Date(org.created_at).toLocaleDateString()}
          </p>
        </div>
        <form method="POST" action="/api/admin/impersonate">
          <input type="hidden" name="org_id" value={org.id} />
          <button
            type="submit"
            className="rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-dim)] transition-colors"
          >
            Enter workspace
          </button>
        </form>
      </div>

      {/* Members */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-[var(--ink)]">
          Members · {members.length}
        </h2>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] divide-y divide-[var(--border)]">
          {members.length === 0 ? (
            <p className="px-5 py-4 text-sm text-[var(--ink-muted)]">No members.</p>
          ) : members.map((m) => (
            <div key={m.user_id} className="flex items-center justify-between px-5 py-3">
              <div>
                <span className="text-sm font-medium text-[var(--ink)]">
                  {m.display_name ?? "—"}
                </span>
                <span className="ml-3 text-xs text-[var(--ink-faint)]">
                  Joined {relativeTime(m.joined_at)}
                </span>
              </div>
              <span className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-xs font-medium text-[var(--ink-muted)]">
                {ROLE_LABELS[m.role] ?? m.role}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Projects */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-[var(--ink)]">
          Projects · {projects.length}
        </h2>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] divide-y divide-[var(--border)]">
          {projects.length === 0 ? (
            <p className="px-5 py-4 text-sm text-[var(--ink-muted)]">No projects yet.</p>
          ) : projects.map((p) => (
            <div key={p.id} className="flex items-center justify-between px-5 py-3">
              <div>
                <span className="text-sm font-medium text-[var(--ink)]">{p.name}</span>
                {p.description && (
                  <span className="ml-2 text-xs text-[var(--ink-faint)]">{p.description}</span>
                )}
              </div>
              <span className="text-xs text-[var(--ink-faint)]">
                Last synthesised {relativeTime(p.last_synthesised_at)}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Recent agent runs */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-[var(--ink)]">Recent processing</h2>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] divide-y divide-[var(--border)]">
          {recent_runs.length === 0 ? (
            <p className="px-5 py-4 text-sm text-[var(--ink-muted)]">No activity yet.</p>
          ) : recent_runs.map((run) => (
            <div key={run.id} className="flex items-center justify-between px-5 py-3">
              <div className="flex items-center gap-3">
                <span className={`h-2 w-2 rounded-full shrink-0 ${
                  run.status === "completed" ? "bg-green-400"
                  : run.status === "failed" ? "bg-red-400"
                  : "bg-yellow-400"
                }`} />
                <span className="text-sm text-[var(--ink)]">
                  {AGENT_LABELS[run.agent_type] ?? run.agent_type}
                </span>
                {run.status === "failed" && run.error && (
                  <span className="text-xs text-red-400 truncate max-w-xs" title={run.error}>
                    {run.error.slice(0, 60)}
                  </span>
                )}
              </div>
              <span className="text-xs text-[var(--ink-faint)]">
                {relativeTime(run.started_at)}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
