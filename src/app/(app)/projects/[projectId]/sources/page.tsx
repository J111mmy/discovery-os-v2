import { getProjectForUser } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import type { JobStatus, SourceType, TrustScope } from "@/types/database";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { SourceActions } from "./source-actions";

interface Props {
  params: { projectId: string };
}

type SourceRow = {
  id: string;
  org_id: string;
  project_id: string;
  title: string;
  type: SourceType;
  trust_scope: TrustScope;
  ingested_at: string;
  created_at: string;
};

type JobRow = {
  id: string;
  source_id: string;
  status: JobStatus;
  error: string | null;
  result: { evidence_created?: number; segments_created?: number } | null;
  created_at: string;
  completed_at: string | null;
};

function StatusBadge({ status }: { status: JobStatus | "not_started" }) {
  const label =
    status === "done" ? "ready" :
    status === "failed" ? "check needed" :
    status === "processing" || status === "pending" ? "analyzing" :
    "not started";
  const classes =
    status === "done"
      ? "border-green-500/20 bg-green-500/10 text-green-300"
      : status === "failed"
      ? "border-red-500/20 bg-red-500/10 text-red-300"
      : status === "processing" || status === "pending"
      ? "border-yellow-500/20 bg-yellow-500/10 text-yellow-300"
      : "border-[var(--border)] bg-[var(--surface-2)] text-[var(--ink-muted)]";

  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${classes}`}>
      {label}
    </span>
  );
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default async function SourcesPage({ params }: Props) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const project = await getProjectForUser<{ id: string; org_id: string; name: string }>(
    user.id,
    params.projectId,
    "id, org_id, name"
  );

  if (!project) notFound();

  const { data: sourceData } = await supabase
    .from("sources")
    .select("id, org_id, project_id, title, type, trust_scope, ingested_at, created_at")
    .eq("org_id", project.org_id)
    .eq("project_id", project.id)
    .order("ingested_at", { ascending: false });

  const sources = (sourceData ?? []) as SourceRow[];
  const sourceIds = sources.map((source) => source.id);
  const [jobsResult, evidenceResult, segmentsResult] =
    sourceIds.length > 0
      ? await Promise.all([
          supabase
            .from("ingest_jobs")
            .select("id, org_id, source_id, status, error, result, created_at, completed_at")
            .eq("org_id", project.org_id)
            .in("source_id", sourceIds)
            .order("created_at", { ascending: false }),
          supabase
            .from("evidence")
            .select("id, org_id, project_id, source_id")
            .eq("org_id", project.org_id)
            .eq("project_id", project.id)
            .in("source_id", sourceIds),
          supabase
            .from("source_segments")
            .select("id, org_id, source_id")
            .eq("org_id", project.org_id)
            .in("source_id", sourceIds),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }];

  const latestJobBySource = new Map<string, JobRow>();
  ((jobsResult.data ?? []) as JobRow[]).forEach((job) => {
    if (!latestJobBySource.has(job.source_id)) {
      latestJobBySource.set(job.source_id, job);
    }
  });

  const evidenceCountBySource = new Map<string, number>();
  (evidenceResult.data ?? []).forEach((record: { source_id: string }) => {
    evidenceCountBySource.set(
      record.source_id,
      (evidenceCountBySource.get(record.source_id) ?? 0) + 1
    );
  });

  const segmentCountBySource = new Map<string, number>();
  (segmentsResult.data ?? []).forEach((record: { source_id: string }) => {
    segmentCountBySource.set(
      record.source_id,
      (segmentCountBySource.get(record.source_id) ?? 0) + 1
    );
  });

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
            Sources
          </div>
          <h1 className="text-2xl font-semibold text-[var(--ink)]">Manage source material</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">
            Inspect ingest jobs, retry source processing, and remove inputs that should not feed evidence.
          </p>
        </div>
        <Link
          href={`/projects/${project.id}/ingest`}
          className="inline-flex rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-dim)]"
        >
          Add evidence
        </Link>
      </div>

      {sources.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-12 text-center">
          <div className="text-sm font-medium text-[var(--ink)]">No sources yet</div>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--ink-muted)]">
            Add a transcript, document, or note to start creating source-backed evidence.
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {sources.map((source) => {
            const job = latestJobBySource.get(source.id);
            const evidenceCount = evidenceCountBySource.get(source.id) ?? 0;
            const segmentCount = segmentCountBySource.get(source.id) ?? 0;

            const jobStatus = job?.status ?? "not_started";
            const isAnalyzing = jobStatus === "processing" || jobStatus === "pending";
            const hasFailed = jobStatus === "failed";

            return (
              <article
                key={source.id}
                className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <StatusBadge status={jobStatus} />
                      <span className="text-xs capitalize text-[var(--ink-muted)]">{source.type}</span>
                      <span className="text-xs text-[var(--ink-faint)]">{dateLabel(source.ingested_at)}</span>
                    </div>
                    <Link
                      href={`/projects/${project.id}/sources/${source.id}`}
                      className="text-base font-semibold text-[var(--ink)] transition-colors hover:text-[var(--brand)]"
                    >
                      {source.title}
                    </Link>
                    <div className="mt-2 text-xs text-[var(--ink-muted)]">
                      {isAnalyzing
                        ? "Extracting evidence — this may take a minute for long transcripts."
                        : hasFailed
                        ? "Processing did not complete. Use Retry to try again."
                        : `${evidenceCount} evidence record${evidenceCount === 1 ? "" : "s"}`}
                    </div>
                  </div>
                  <div className="flex flex-col gap-3 lg:items-end">
                    <Link
                      href={`/projects/${project.id}/sources/${source.id}`}
                      className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--ink)] transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)]"
                    >
                      View evidence
                    </Link>
                    <SourceActions
                      projectId={project.id}
                      sourceId={source.id}
                      showRetry={hasFailed}
                    />
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
