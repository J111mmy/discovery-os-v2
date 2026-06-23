// /admin/costs - super-admin LLM cost observability.
import { createClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/auth/super-admin";
import { redirect } from "next/navigation";
import Link from "next/link";

type CostWindow = "24h" | "7d" | "30d" | "all";
type CostBucket = "day" | "week" | "month";

type TokenTotals = {
  input_tokens?: number | string | null;
  output_tokens?: number | string | null;
  cache_write_tokens?: number | string | null;
  cache_read_tokens?: number | string | null;
};

type CostSummary = TokenTotals & {
  estimated_usd?: number | string | null;
  call_count?: number | string | null;
  pricing_versions?: string[] | null;
  first_event_at?: string | null;
  last_event_at?: string | null;
};

type CostRow = TokenTotals & {
  estimated_usd?: number | string | null;
  call_count?: number | string | null;
  agent_type?: string | null;
  step?: string | null;
  org_id?: string | null;
  org_name?: string | null;
  org_slug?: string | null;
  provider?: string | null;
  model?: string | null;
  tier?: string | null;
  bucket_start?: string | null;
  artifact_id?: string | null;
  artifact_title?: string | null;
  source_id?: string | null;
  source_title?: string | null;
  source_type?: string | null;
  project_id?: string | null;
  project_name?: string | null;
  last_event_at?: string | null;
};

type CostDashboard = {
  window?: CostWindow;
  bucket?: CostBucket;
  summary?: CostSummary;
  by_operation?: CostRow[];
  by_step?: CostRow[];
  by_org?: CostRow[];
  by_model?: CostRow[];
  over_time?: CostRow[];
  top_artifacts?: CostRow[];
  top_ingest_sources?: CostRow[];
  notes?: {
    top_ingest_sources?: string;
    security?: string;
  };
};

type Props = {
  searchParams?: {
    window?: string;
    bucket?: string;
  };
};

const WINDOW_OPTIONS: Array<{ value: CostWindow; label: string }> = [
  { value: "24h", label: "Last 24h" },
  { value: "7d", label: "Last 7d" },
  { value: "30d", label: "Last 30d" },
  { value: "all", label: "All time" },
];

const BUCKET_OPTIONS: Array<{ value: CostBucket; label: string }> = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

function normalizeWindow(value: string | undefined): CostWindow {
  return WINDOW_OPTIONS.some((option) => option.value === value)
    ? (value as CostWindow)
    : "7d";
}

function normalizeBucket(value: string | undefined): CostBucket {
  return BUCKET_OPTIONS.some((option) => option.value === value)
    ? (value as CostBucket)
    : "day";
}

function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatUsd(value: number | string | null | undefined): string {
  const amount = toNumber(value);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: amount >= 1 ? 2 : 4,
    maximumFractionDigits: amount >= 1 ? 2 : 4,
  }).format(amount);
}

function formatNumber(value: number | string | null | undefined): string {
  return new Intl.NumberFormat("en-US").format(Math.round(toNumber(value)));
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "--";
  return new Intl.DateTimeFormat("en-IE", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatBucket(value: string | null | undefined, bucket: CostBucket): string {
  if (!value) return "--";
  const date = new Date(value);
  if (bucket === "month") {
    return new Intl.DateTimeFormat("en-IE", {
      month: "short",
      year: "numeric",
    }).format(date);
  }
  return new Intl.DateTimeFormat("en-IE", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function buildHref(windowValue: CostWindow, bucketValue: CostBucket): string {
  const params = new URLSearchParams({ window: windowValue, bucket: bucketValue });
  return `/admin/costs?${params.toString()}`;
}

function labelOrFallback(value: string | null | undefined, fallback = "Unknown"): string {
  return value?.trim() || fallback;
}

function MetricCard({
  label,
  value,
  subtext,
}: {
  label: string;
  value: string;
  subtext?: string;
}) {
  return (
    <article className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
      <div className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
        {label}
      </div>
      <div className="mt-3 text-2xl font-semibold text-[var(--ink)]">{value}</div>
      {subtext ? <div className="mt-1 text-xs text-[var(--ink-2)]">{subtext}</div> : null}
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

function CostCells({ row }: { row: CostRow }) {
  return (
    <>
      <td className="px-5 py-3 text-right font-medium text-[var(--ink)]">
        {formatUsd(row.estimated_usd)}
      </td>
      <td className="px-5 py-3 text-right text-[var(--ink-2)]">{formatNumber(row.call_count)}</td>
      <td className="px-5 py-3 text-right text-[var(--ink-2)]">
        {formatNumber(row.input_tokens)}
      </td>
      <td className="px-5 py-3 text-right text-[var(--ink-2)]">
        {formatNumber(row.output_tokens)}
      </td>
      <td className="px-5 py-3 text-right text-[var(--ink-2)]">
        {formatNumber(row.cache_read_tokens)}
      </td>
      <td className="px-5 py-3 text-right text-[var(--ink-2)]">
        {formatNumber(row.cache_write_tokens)}
      </td>
    </>
  );
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-base font-semibold text-[var(--ink)]">{title}</h2>
      <p className="mt-1 text-sm text-[var(--ink-2)]">{description}</p>
    </div>
  );
}

export default async function AdminCostsPage({ searchParams }: Props) {
  const selectedWindow = normalizeWindow(searchParams?.window);
  const selectedBucket = normalizeBucket(searchParams?.bucket);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  if (!(await isSuperAdmin(user.id))) redirect("/projects");

  const { data, error } = await supabase.rpc("admin_llm_cost_dashboard", {
    p_window: selectedWindow,
    p_bucket: selectedBucket,
    p_top_n: 10,
  });

  const dashboard = (data ?? {}) as CostDashboard;
  const summary = dashboard.summary ?? {};
  const pricingVersions = summary.pricing_versions ?? [];

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
            <h1 className="text-2xl font-semibold text-[var(--ink)]">AI costs</h1>
            <p className="mt-2 max-w-3xl text-sm text-[var(--ink-2)]">
              Aggregate LLM spend by operation, organisation, model, and expensive outputs.
            </p>
          </div>
          <span className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1 text-xs font-medium text-[var(--ink-2)]">
            Super admin only
          </span>
        </div>
      </div>

      <section className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
              Window
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {WINDOW_OPTIONS.map((option) => (
                <Link
                  key={option.value}
                  href={buildHref(option.value, selectedBucket)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    selectedWindow === option.value
                      ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                      : "border-[var(--line)] text-[var(--ink-2)] hover:text-[var(--ink)]"
                  }`}
                >
                  {option.label}
                </Link>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
              Time bucket
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {BUCKET_OPTIONS.map((option) => (
                <Link
                  key={option.value}
                  href={buildHref(selectedWindow, option.value)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    selectedBucket === option.value
                      ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                      : "border-[var(--line)] text-[var(--ink-2)] hover:text-[var(--ink)]"
                  }`}
                >
                  {option.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      {error ? (
        <article className="rounded-xl border border-red-500/40 bg-red-500/10 p-5 text-sm text-red-200">
          Could not load cost dashboard: {error.message}
        </article>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Estimated spend" value={formatUsd(summary.estimated_usd)} />
        <MetricCard label="LLM calls" value={formatNumber(summary.call_count)} />
        <MetricCard
          label="Tokens"
          value={formatNumber(toNumber(summary.input_tokens) + toNumber(summary.output_tokens))}
          subtext={`${formatNumber(summary.input_tokens)} in / ${formatNumber(summary.output_tokens)} out`}
        />
        <MetricCard
          label="Cache tokens"
          value={formatNumber(toNumber(summary.cache_read_tokens) + toNumber(summary.cache_write_tokens))}
          subtext={`${formatNumber(summary.cache_read_tokens)} read / ${formatNumber(summary.cache_write_tokens)} write`}
        />
      </section>

      <section className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
        <SectionHeader
          title="Spend over time"
          description="Bucketed server-side from cost events so spikes are visible without loading raw rows."
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] text-xs font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
                <th className="px-5 py-3">Bucket</th>
                <th className="px-5 py-3 text-right">Spend</th>
                <th className="px-5 py-3 text-right">Calls</th>
                <th className="px-5 py-3 text-right">Input</th>
                <th className="px-5 py-3 text-right">Output</th>
                <th className="px-5 py-3 text-right">Cache read</th>
                <th className="px-5 py-3 text-right">Cache write</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {(dashboard.over_time ?? []).length === 0 ? (
                <EmptyRow colSpan={7} label="No cost events in this window." />
              ) : (
                (dashboard.over_time ?? []).map((row) => (
                  <tr key={row.bucket_start ?? "unknown"}>
                    <td className="px-5 py-3 text-[var(--ink)]">
                      {formatBucket(row.bucket_start, selectedBucket)}
                    </td>
                    <CostCells row={row} />
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <SectionHeader
            title="By operation"
            description="Grouped by agent_type to identify whether ingest, Ask, compose, or review work is driving spend."
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-xs font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
                  <th className="px-5 py-3">Operation</th>
                  <th className="px-5 py-3 text-right">Spend</th>
                  <th className="px-5 py-3 text-right">Calls</th>
                  <th className="px-5 py-3 text-right">Input</th>
                  <th className="px-5 py-3 text-right">Output</th>
                  <th className="px-5 py-3 text-right">Cache read</th>
                  <th className="px-5 py-3 text-right">Cache write</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {(dashboard.by_operation ?? []).length === 0 ? (
                  <EmptyRow colSpan={7} label="No operations in this window." />
                ) : (
                  (dashboard.by_operation ?? []).map((row) => (
                    <tr key={row.agent_type ?? "unknown"}>
                      <td className="px-5 py-3 font-medium text-[var(--ink)]">
                        {labelOrFallback(row.agent_type, "Unknown operation")}
                      </td>
                      <CostCells row={row} />
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <SectionHeader
            title="By model"
            description="Shows model, provider, and tier so premium spend is easy to separate from cheap extraction."
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-xs font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
                  <th className="px-5 py-3">Model</th>
                  <th className="px-5 py-3 text-right">Spend</th>
                  <th className="px-5 py-3 text-right">Calls</th>
                  <th className="px-5 py-3 text-right">Input</th>
                  <th className="px-5 py-3 text-right">Output</th>
                  <th className="px-5 py-3 text-right">Cache read</th>
                  <th className="px-5 py-3 text-right">Cache write</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {(dashboard.by_model ?? []).length === 0 ? (
                  <EmptyRow colSpan={7} label="No model usage in this window." />
                ) : (
                  (dashboard.by_model ?? []).map((row) => (
                    <tr key={`${row.provider}-${row.model}-${row.tier}`}>
                      <td className="px-5 py-3">
                        <div className="font-medium text-[var(--ink)]">
                          {labelOrFallback(row.model, "Unknown model")}
                        </div>
                        <div className="mt-0.5 text-xs text-[var(--ink-faint)]">
                          {labelOrFallback(row.provider, "unknown")} / {labelOrFallback(row.tier, "unknown")}
                        </div>
                      </td>
                      <CostCells row={row} />
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
        <SectionHeader
          title="By organisation"
          description="Cross-org rollup for the super-admin view. Per-org self-serve caps are a separate work order."
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] text-xs font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
                <th className="px-5 py-3">Organisation</th>
                <th className="px-5 py-3 text-right">Spend</th>
                <th className="px-5 py-3 text-right">Calls</th>
                <th className="px-5 py-3 text-right">Input</th>
                <th className="px-5 py-3 text-right">Output</th>
                <th className="px-5 py-3 text-right">Cache read</th>
                <th className="px-5 py-3 text-right">Cache write</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {(dashboard.by_org ?? []).length === 0 ? (
                <EmptyRow colSpan={7} label="No organisation spend in this window." />
              ) : (
                (dashboard.by_org ?? []).map((row) => (
                  <tr key={row.org_id ?? row.org_name ?? "unknown"}>
                    <td className="px-5 py-3">
                      <div className="font-medium text-[var(--ink)]">
                        {labelOrFallback(row.org_name, "Unknown organisation")}
                      </div>
                      <div className="mt-0.5 text-xs text-[var(--ink-faint)]">
                        {row.org_slug ?? row.org_id ?? "--"}
                      </div>
                    </td>
                    <CostCells row={row} />
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
        <SectionHeader
          title="By operation step"
          description="Drill-down by agent_type and step for spotting one expensive phase inside an operation."
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] text-xs font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
                <th className="px-5 py-3">Operation / step</th>
                <th className="px-5 py-3 text-right">Spend</th>
                <th className="px-5 py-3 text-right">Calls</th>
                <th className="px-5 py-3 text-right">Input</th>
                <th className="px-5 py-3 text-right">Output</th>
                <th className="px-5 py-3 text-right">Cache read</th>
                <th className="px-5 py-3 text-right">Cache write</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {(dashboard.by_step ?? []).length === 0 ? (
                <EmptyRow colSpan={7} label="No step spend in this window." />
              ) : (
                (dashboard.by_step ?? []).map((row) => (
                  <tr key={`${row.agent_type}-${row.step}`}>
                    <td className="px-5 py-3">
                      <div className="font-medium text-[var(--ink)]">
                        {labelOrFallback(row.agent_type, "Unknown operation")}
                      </div>
                      <div className="mt-0.5 text-xs text-[var(--ink-faint)]">
                        {labelOrFallback(row.step, "unknown step")}
                      </div>
                    </td>
                    <CostCells row={row} />
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <SectionHeader
            title="Top-cost artifacts"
            description="Most expensive generated artifacts by summed linked LLM call cost."
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-xs font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
                  <th className="px-5 py-3">Artifact</th>
                  <th className="px-5 py-3 text-right">Spend</th>
                  <th className="px-5 py-3 text-right">Calls</th>
                  <th className="px-5 py-3">Last event</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {(dashboard.top_artifacts ?? []).length === 0 ? (
                  <EmptyRow colSpan={4} label="No artifact-linked spend in this window." />
                ) : (
                  (dashboard.top_artifacts ?? []).map((row) => {
                    const artifactHref =
                      row.project_id && row.artifact_id
                        ? `/projects/${row.project_id}/documents/${row.artifact_id}`
                        : null;
                    return (
                      <tr key={row.artifact_id ?? row.artifact_title ?? "unknown"}>
                        <td className="px-5 py-3">
                          <div className="font-medium text-[var(--ink)]">
                            {artifactHref ? (
                              <Link className="hover:text-[var(--accent)]" href={artifactHref}>
                                {labelOrFallback(row.artifact_title, "Untitled artifact")}
                              </Link>
                            ) : (
                              labelOrFallback(row.artifact_title, "Untitled artifact")
                            )}
                          </div>
                          <div className="mt-0.5 text-xs text-[var(--ink-faint)]">
                            {labelOrFallback(row.project_name, "Unknown project")} / {labelOrFallback(row.org_name, "Unknown org")}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-right font-medium text-[var(--ink)]">
                          {formatUsd(row.estimated_usd)}
                        </td>
                        <td className="px-5 py-3 text-right text-[var(--ink-2)]">
                          {formatNumber(row.call_count)}
                        </td>
                        <td className="px-5 py-3 text-[var(--ink-2)]">
                          {formatDate(row.last_event_at)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <SectionHeader
            title="Top-cost ingest sources"
            description="Uses source_id recorded on the ingest agent run; older rows without that attribution are omitted."
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-xs font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
                  <th className="px-5 py-3">Source</th>
                  <th className="px-5 py-3 text-right">Spend</th>
                  <th className="px-5 py-3 text-right">Calls</th>
                  <th className="px-5 py-3">Last event</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {(dashboard.top_ingest_sources ?? []).length === 0 ? (
                  <EmptyRow colSpan={4} label="No ingest source attribution in this window." />
                ) : (
                  (dashboard.top_ingest_sources ?? []).map((row) => {
                    const sourceHref = row.project_id
                      ? `/projects/${row.project_id}/sources`
                      : null;
                    return (
                      <tr key={row.source_id ?? row.source_title ?? "unknown"}>
                        <td className="px-5 py-3">
                          <div className="font-medium text-[var(--ink)]">
                            {sourceHref ? (
                              <Link className="hover:text-[var(--accent)]" href={sourceHref}>
                                {labelOrFallback(row.source_title, "Untitled source")}
                              </Link>
                            ) : (
                              labelOrFallback(row.source_title, "Untitled source")
                            )}
                          </div>
                          <div className="mt-0.5 text-xs text-[var(--ink-faint)]">
                            {labelOrFallback(row.source_type, "unknown type")} / {labelOrFallback(row.project_name, "Unknown project")}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-right font-medium text-[var(--ink)]">
                          {formatUsd(row.estimated_usd)}
                        </td>
                        <td className="px-5 py-3 text-right text-[var(--ink-2)]">
                          {formatNumber(row.call_count)}
                        </td>
                        <td className="px-5 py-3 text-[var(--ink-2)]">
                          {formatDate(row.last_event_at)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 text-xs text-[var(--ink-2)]">
        <div className="font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
          Pricing versions
        </div>
        <p className="mt-2">
          {pricingVersions.length > 0 ? pricingVersions.join(", ") : "No pricing versions in this window."}
        </p>
        {dashboard.notes?.security ? <p className="mt-2">{dashboard.notes.security}</p> : null}
        {dashboard.notes?.top_ingest_sources ? (
          <p className="mt-1">{dashboard.notes.top_ingest_sources}</p>
        ) : null}
      </section>
    </div>
  );
}
