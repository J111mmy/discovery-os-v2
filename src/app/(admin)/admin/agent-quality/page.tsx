// /admin/agent-quality - read-only agent performance and failure view.

import Link from "next/link";
import { AGENT_REGISTRY } from "@/lib/admin/agent-registry";
import { getAgentPerformanceDashboard } from "@/lib/auth/super-admin";

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatPercent(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatDuration(ms: number | null) {
  if (ms === null) return "--";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function relativeTime(value: string | null) {
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

function agentLabel(agentType: string) {
  return AGENT_REGISTRY.find((agent) => agent.id === agentType)?.name ?? agentType;
}

function statusClass(status: string | null) {
  if (status === "failed") return "border-red-500/30 bg-red-500/10 text-red-300";
  if (status === "running") return "border-yellow-500/30 bg-yellow-500/10 text-yellow-200";
  if (status === "completed") return "border-green-500/30 bg-green-500/10 text-green-300";
  return "border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink-2)]";
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

export default async function AdminAgentQualityPage() {
  const dashboard = await getAgentPerformanceDashboard(14);
  const failureRate =
    dashboard.total_runs === 0 ? 0 : dashboard.failed_runs / dashboard.total_runs;

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
            <h1 className="text-2xl font-semibold text-[var(--ink)]">Agent quality</h1>
            <p className="mt-2 max-w-3xl text-sm text-[var(--ink-2)]">
              Read-only health view for recent agent runs. This measures runtime reliability,
              failure rate, and duration from agent_runs; qualitative eval scores are still a
              future layer.
            </p>
          </div>
          <span className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1 text-xs font-medium text-[var(--ink-2)]">
            Last {dashboard.window_days} days
          </span>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Runs" value={formatNumber(dashboard.total_runs)} />
        <MetricCard label="Failure rate" value={formatPercent(failureRate)} />
        <MetricCard
          label="Average duration"
          value={formatDuration(dashboard.average_duration_ms)}
          note="Completed or failed runs with an end timestamp"
        />
        <MetricCard label="Running now" value={formatNumber(dashboard.running_runs)} />
      </section>

      <section className="rounded-xl border border-[var(--line)] bg-[var(--surface)]">
        <div className="border-b border-[var(--line)] px-5 py-4">
          <h2 className="text-base font-semibold text-[var(--ink)]">Agent performance</h2>
          <p className="mt-1 text-sm text-[var(--ink-2)]">
            Sorted by failed runs first, then total volume.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] text-xs text-[var(--ink-faint)]">
                <th className="px-5 py-3 font-semibold uppercase tracking-wide">Agent</th>
                <th className="px-5 py-3 text-right font-semibold uppercase tracking-wide">Runs</th>
                <th className="px-5 py-3 text-right font-semibold uppercase tracking-wide">Failed</th>
                <th className="px-5 py-3 text-right font-semibold uppercase tracking-wide">Failure rate</th>
                <th className="px-5 py-3 text-right font-semibold uppercase tracking-wide">Avg</th>
                <th className="px-5 py-3 text-right font-semibold uppercase tracking-wide">P95</th>
                <th className="px-5 py-3 font-semibold uppercase tracking-wide">Last run</th>
                <th className="px-5 py-3 text-right font-semibold uppercase tracking-wide">Orgs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {dashboard.agents.length === 0 ? (
                <EmptyRow colSpan={8} label="No agent runs in this window." />
              ) : (
                dashboard.agents.map((agent) => (
                  <tr key={agent.agent_type} className="hover:bg-[var(--surface-2)]">
                    <td className="px-5 py-4">
                      <div className="font-medium text-[var(--ink)]">
                        {agentLabel(agent.agent_type)}
                      </div>
                      <div className="mt-0.5 text-xs text-[var(--ink-faint)]">
                        {agent.agent_type}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-right text-[var(--ink-2)]">
                      {formatNumber(agent.run_count)}
                    </td>
                    <td className="px-5 py-4 text-right text-[var(--ink-2)]">
                      {formatNumber(agent.failed_count)}
                    </td>
                    <td className="px-5 py-4 text-right text-[var(--ink-2)]">
                      {formatPercent(agent.failure_rate)}
                    </td>
                    <td className="px-5 py-4 text-right text-[var(--ink-2)]">
                      {formatDuration(agent.average_duration_ms)}
                    </td>
                    <td className="px-5 py-4 text-right text-[var(--ink-2)]">
                      {formatDuration(agent.p95_duration_ms)}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusClass(
                            agent.last_status
                          )}`}
                        >
                          {agent.last_status ?? "none"}
                        </span>
                        <span className="text-xs text-[var(--ink-faint)]">
                          {relativeTime(agent.last_run_at)}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-right text-[var(--ink-2)]">
                      {formatNumber(agent.org_count)}
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
          <h2 className="text-base font-semibold text-[var(--ink)]">Recent failures</h2>
          <p className="mt-1 text-sm text-[var(--ink-2)]">
            Latest failed runs, without input or output payloads.
          </p>
        </div>
        <div className="divide-y divide-[var(--line)]">
          {dashboard.recent_failures.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-[var(--ink-2)]">
              No recent failures in this window.
            </div>
          ) : (
            dashboard.recent_failures.map((failure) => (
              <article key={failure.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-medium text-[var(--ink)]">
                      {agentLabel(failure.agent_type)}
                    </div>
                    <div className="mt-0.5 text-xs text-[var(--ink-faint)]">
                      {failure.org_name ?? failure.org_id} · {relativeTime(failure.started_at)}
                    </div>
                  </div>
                  <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-300">
                    failed
                  </span>
                </div>
                {failure.error ? (
                  <p className="mt-2 line-clamp-2 text-sm text-[var(--ink-2)]" title={failure.error}>
                    {failure.error}
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-[var(--ink-faint)]">No error message recorded.</p>
                )}
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
