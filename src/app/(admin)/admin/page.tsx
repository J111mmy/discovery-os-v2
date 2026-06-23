// /admin — super admin dashboard: all orgs with stats and impersonation entry
import { createClient } from "@/lib/supabase/server";
import { isSuperAdmin, getAllOrgsWithStats } from "@/lib/auth/super-admin";
import { getAIProviderSettings } from "@/lib/llm/settings";
import { redirect } from "next/navigation";
import { AIProviderSettingsPanel } from "./ai-provider-settings";

function relativeTime(value: string | null): string {
  if (!value) return "never";
  const diffMs = Date.now() - new Date(value).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default async function AdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isSuperAdmin(user.id))) redirect("/projects");

  const [orgs, aiSettings] = await Promise.all([
    getAllOrgsWithStats(),
    getAIProviderSettings(),
  ]);

  return (
    <div>
      <div className="mb-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--ink)]">All organisations</h1>
            <p className="mt-2 text-sm text-[var(--ink-2)]">
              {orgs.length} organisation{orgs.length === 1 ? "" : "s"} · Enter any workspace to browse as support
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href="/admin/costs"
              className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]"
            >
              AI costs
            </a>
            <a
              href="/admin/access-requests"
              className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]"
            >
              Access requests
            </a>
          </div>
        </div>
      </div>

      <AIProviderSettingsPanel initialSettings={aiSettings} />

      {orgs.length === 0 ? (
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-12 text-center text-sm text-[var(--ink-2)]">
          No organisations yet.
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--line)]">
                <th className="px-5 py-3 font-semibold text-[var(--ink)]">Organisation</th>
                <th className="px-5 py-3 font-semibold text-[var(--ink)] text-right">Members</th>
                <th className="px-5 py-3 font-semibold text-[var(--ink)] text-right">Projects</th>
                <th className="px-5 py-3 font-semibold text-[var(--ink)] text-right">Sources</th>
                <th className="px-5 py-3 font-semibold text-[var(--ink)]">Last activity</th>
                <th className="px-5 py-3 font-semibold text-[var(--ink)]">Last run</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {orgs.map((org) => (
                <tr key={org.id} className="hover:bg-[var(--surface-2)] transition-colors">
                  <td className="px-5 py-4">
                    <div className="font-medium text-[var(--ink)]">{org.name}</div>
                    <div className="text-xs text-[var(--ink-faint)] mt-0.5">{org.slug}</div>
                  </td>
                  <td className="px-5 py-4 text-right text-[var(--ink-2)]">
                    {org.member_count}
                  </td>
                  <td className="px-5 py-4 text-right text-[var(--ink-2)]">
                    {org.project_count}
                  </td>
                  <td className="px-5 py-4 text-right text-[var(--ink-2)]">
                    {org.source_count}
                  </td>
                  <td className="px-5 py-4 text-[var(--ink-2)]">
                    {relativeTime(org.last_source_at)}
                  </td>
                  <td className="px-5 py-4">
                    {org.last_run ? (
                      <span className={`text-xs font-medium ${
                        org.last_run.status === "failed"
                          ? "text-red-400"
                          : org.last_run.status === "running"
                          ? "text-yellow-400"
                          : "text-[var(--ink-2)]"
                      }`}>
                        {org.last_run.status === "failed" ? "⚠ failed" : relativeTime(org.last_run.started_at)}
                      </span>
                    ) : (
                      <span className="text-xs text-[var(--ink-faint)]">—</span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <a
                        href={`/admin/orgs/${org.id}`}
                        className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]"
                      >
                        Detail
                      </a>
                      <form method="POST" action="/api/admin/impersonate">
                        <input type="hidden" name="org_id" value={org.id} />
                        <button
                          type="submit"
                          className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[var(--accent-hover)]"
                        >
                          Enter workspace
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
