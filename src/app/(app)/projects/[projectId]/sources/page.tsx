import { getProjectForUser } from "@/lib/auth/org";
import { getProjectOrgReadForUser } from "@/lib/auth/support-read";
import { isStaleIngestJob } from "@/lib/ingest/quality";
import { sourceTypeLabel, trustScopeLabel } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import type { JobStatus, SourceType, TrustScope } from "@/types/database";
import { notFound, redirect } from "next/navigation";
import { AddSourceButton } from "./add-source-button";
import { SourcesClient, type SourceItem } from "./SourcesClient";

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
  const read = await getProjectOrgReadForUser({
    userId: user.id,
    orgId: project.org_id,
    memberClient: supabase,
  });

  const { data: sourceData } = await read
    .from("sources")
    .select("id, org_id, project_id, title, type, trust_scope, ingested_at, created_at")
    .eq("project_id", project.id)
    .order("ingested_at", { ascending: false });

  const sources = (sourceData ?? []) as SourceRow[];
  const sourceIds = sources.map((source) => source.id);

  const [jobsResult, evidenceResult, segmentsResult] = await Promise.all([
    sourceIds.length > 0
      ? read
          .from("ingest_jobs")
          .select("id, org_id, source_id, status, error, result, created_at, completed_at")
          .in("source_id", sourceIds)
          .order("created_at", { ascending: false })
      : { data: [] },
    sourceIds.length > 0
      ? read
          .from("evidence")
          .select("id, org_id, project_id, source_id")
          .eq("project_id", project.id)
          .in("source_id", sourceIds)
      : { data: [] },
    sourceIds.length > 0
      ? read
          .from("source_segments")
          .select("id, org_id, source_id")
          .in("source_id", sourceIds)
      : { data: [] },
  ]);

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

  // Transform sources into serialisable SourceItem[] for the client component
  const sourceItems: SourceItem[] = sources.map((source) => {
    const job = latestJobBySource.get(source.id);
    const evidenceCount = evidenceCountBySource.get(source.id) ?? 0;
    const segmentCount = segmentCountBySource.get(source.id) ?? 0;

    const jobStatus = job?.status ?? "not_started";
    const isStale = isStaleIngestJob(jobStatus, job?.created_at ?? null);
    const needsCheck = jobStatus === "done" && evidenceCount === 0 && segmentCount > 0;
    const displayStatus = (needsCheck || isStale ? "failed" : jobStatus) as SourceItem["displayStatus"];
    const isQueued = !isStale && jobStatus === "pending";
    const isAnalyzing = !isStale && jobStatus === "processing";
    const hasFailed = jobStatus === "failed" || needsCheck || isStale;

    const message = isAnalyzing
      ? "Analyzing — extracting citable evidence from the source."
      : isQueued
      ? "Queued — sources run one at a time for better quality and lower cost."
      : hasFailed
      ? needsCheck
        ? "Processing completed but produced no evidence. Check the source text, then retry."
        : isStale
        ? "Processing took too long. Use Retry to run it again."
        : "Processing did not complete. Use Retry to try again."
      : `${evidenceCount} evidence record${evidenceCount === 1 ? "" : "s"}`;

    return {
      id: source.id,
      title: source.title,
      typeLabel: sourceTypeLabel(source.type),
      trustLabel: trustScopeLabel(source.trust_scope),
      trustScope: source.trust_scope,
      dateLabel: dateLabel(source.ingested_at),
      displayStatus,
      evidenceCount,
      hasFailed,
      isAnalyzing,
      isQueued,
      message,
    };
  });

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
            Sources
          </div>
          <h1 className="text-2xl font-semibold text-[var(--ink)]">Manage source material</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-2)]">
            Inspect ingest jobs, re-process source material, and remove inputs that should not feed evidence.
          </p>
        </div>
        <AddSourceButton
          projectId={project.id}
          className="inline-flex rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
        >
          Add source
        </AddSourceButton>
      </div>

      <SourcesClient projectId={project.id} sources={sourceItems} />
    </div>
  );
}
