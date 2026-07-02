// /admin/learning - read-only evidence-grading feedback view.

import Link from "next/link";
import { getLearningDashboard } from "@/lib/auth/super-admin";

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatPercent(numerator: number, denominator: number) {
  const value = denominator === 0 ? 0 : numerator / denominator;
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
}

function relativeTime(value: string) {
  const diffMs = Date.now() - new Date(value).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function scopeLabel(scope: string) {
  return scope.replace(/_/g, " ");
}

function MetricCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <article className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
      <div className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
        {label}
      </div>
      <div className="mt-3 text-2xl font-semibold text-[var(--ink)]">{value}</div>
      {note ? <p className="mt-1 text-xs text-[var(--ink-2)]">{note}</p> : null}
    </article>
  );
}

function EmptyRow({ colSpan, label }: { colSpan: number; label: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-5 py-8 text-center text-sm text-[var(--ink-2)]">
        {label}
      </td>
    </tr>
  );
}

export default async function AdminLearningPage() {
  const dashboard = await getLearningDashboard(30);

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/admin"
          className="mb-3 inline-flex text-xs text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]"
        >
          Back to admin
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--ink)]">Learning signals</h1>
            <p className="mt-2 max-w-3xl text-sm text-[var(--ink-2)]">
              Read-only view of human evidence-grade corrections across organisations and projects.
              This shows where the grader is being taught, without exposing prompts or evidence text.
            </p>
          </div>
          <span className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1 text-xs font-medium text-[var(--ink-2)]">
            Last {dashboard.window_days} days
          </span>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Feedback events" value={formatNumber(dashboard.total_events)} />
        <MetricCard
          label="AI-origin corrections"
          value={formatNumber(dashboard.ai_events)}
          note={formatPercent(dashboard.ai_events, dashboard.total_events)}
        />
        <MetricCard
          label="False excludes"
          value={formatNumber(dashboard.false_exclude_events)}
          note="AI excluded, human restored"
        />
        <MetricCard
          label="False trusts"
          value={formatNumber(dashboard.false_trust_events)}
          note="AI trusted, human rejected"
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)]">
          <div className="border-b border-[var(--line)] px-5 py-4">
            <h2 className="text-base font-semibold text-[var(--ink)]">Scope transitions</h2>
            <p className="mt-1 text-sm text-[var(--ink-2)]">
              Human review direction, grouped by trust-scope change.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-xs text-[var(--ink-faint)]">
                  <th className="px-5 py-3 font-semibold uppercase tracking-wide">Change</th>
                  <th className="px-5 py-3 text-right font-semibold uppercase tracking-wide">Events</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {dashboard.transitions.length === 0 ? (
                  <EmptyRow colSpan={2} label="No feedback events in this window." />
                ) : (
                  dashboard.transitions.map((transition) => (
                    <tr
                      key={`${transition.from_scope}-${transition.to_scope}`}
                      className="hover:bg-[var(--surface-2)]"
                    >
                      <td className="px-5 py-4 text-[var(--ink)]">
                        {scopeLabel(transition.from_scope)} to {scopeLabel(transition.to_scope)}
                      </td>
                      <td className="px-5 py-4 text-right text-[var(--ink-2)]">
                        {formatNumber(transition.count)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)]">
          <div className="border-b border-[var(--line)] px-5 py-4">
            <h2 className="text-base font-semibold text-[var(--ink)]">Organisations</h2>
            <p className="mt-1 text-sm text-[var(--ink-2)]">
              Where learning signals are coming from.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-xs text-[var(--ink-faint)]">
                  <th className="px-5 py-3 font-semibold uppercase tracking-wide">Org</th>
                  <th className="px-5 py-3 text-right font-semibold uppercase tracking-wide">Events</th>
                  <th className="px-5 py-3 text-right font-semibold uppercase tracking-wide">False excludes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {dashboard.orgs.length === 0 ? (
                  <EmptyRow colSpan={3} label="No organisations with feedback in this window." />
                ) : (
                  dashboard.orgs.slice(0, 8).map((org) => (
                    <tr key={org.org_id} className="hover:bg-[var(--surface-2)]">
                      <td className="px-5 py-4">
                        <div className="font-medium text-[var(--ink)]">
                          {org.org_name ?? org.org_id}
                        </div>
                        <div className="mt-0.5 text-xs text-[var(--ink-faint)]">{org.org_id}</div>
                      </td>
                      <td className="px-5 py-4 text-right text-[var(--ink-2)]">
                        {formatNumber(org.total_events)}
                      </td>
                      <td className="px-5 py-4 text-right text-[var(--ink-2)]">
                        {formatNumber(org.false_exclude_events)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-[var(--line)] bg-[var(--surface)]">
        <div className="border-b border-[var(--line)] px-5 py-4">
          <h2 className="text-base font-semibold text-[var(--ink)]">Projects</h2>
          <p className="mt-1 text-sm text-[var(--ink-2)]">
            Highest-volume correction sources, useful for spotting where the grader is misaligned.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] text-xs text-[var(--ink-faint)]">
                <th className="px-5 py-3 font-semibold uppercase tracking-wide">Project</th>
                <th className="px-5 py-3 text-right font-semibold uppercase tracking-wide">Events</th>
                <th className="px-5 py-3 text-right font-semibold uppercase tracking-wide">AI-origin</th>
                <th className="px-5 py-3 text-right font-semibold uppercase tracking-wide">False excludes</th>
                <th className="px-5 py-3 text-right font-semibold uppercase tracking-wide">False trusts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {dashboard.projects.length === 0 ? (
                <EmptyRow colSpan={5} label="No projects with feedback in this window." />
              ) : (
                dashboard.projects.slice(0, 12).map((project) => (
                  <tr key={project.project_id} className="hover:bg-[var(--surface-2)]">
                    <td className="px-5 py-4">
                      <div className="font-medium text-[var(--ink)]">
                        {project.project_name ?? project.project_id}
                      </div>
                      <div className="mt-0.5 text-xs text-[var(--ink-faint)]">
                        {project.org_name ?? project.org_id}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-right text-[var(--ink-2)]">
                      {formatNumber(project.total_events)}
                    </td>
                    <td className="px-5 py-4 text-right text-[var(--ink-2)]">
                      {formatNumber(project.ai_events)}
                    </td>
                    <td className="px-5 py-4 text-right text-[var(--ink-2)]">
                      {formatNumber(project.false_exclude_events)}
                    </td>
                    <td className="px-5 py-4 text-right text-[var(--ink-2)]">
                      {formatNumber(project.false_trust_events)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-[var(--line)] bg-[var(--surface)]">
        <div className="border-b border-[var(--line)] px-5 py-4">
          <h2 className="text-base font-semibold text-[var(--ink)]">Recent feedback</h2>
          <p className="mt-1 text-sm text-[var(--ink-2)]">
            Event metadata only. Evidence text stays inside the project trust workflow.
          </p>
        </div>
        <div className="divide-y divide-[var(--line)]">
          {dashboard.recent_events.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-[var(--ink-2)]">
              No recent feedback events.
            </div>
          ) : (
            dashboard.recent_events.map((event) => (
              <article key={event.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-medium text-[var(--ink)]">
                      {scopeLabel(event.from_scope)} to {scopeLabel(event.to_scope)}
                    </div>
                    <div className="mt-0.5 text-xs text-[var(--ink-faint)]">
                      {event.project_name ?? event.project_id} · {event.org_name ?? event.org_id}
                    </div>
                  </div>
                  <div className="text-right text-xs text-[var(--ink-2)]">
                    <div>{relativeTime(event.created_at)}</div>
                    <div className="mt-0.5 text-[var(--ink-faint)]">
                      {event.from_source}
                      {event.model_grade ? ` · ${event.model_grade}` : ""}
                    </div>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
