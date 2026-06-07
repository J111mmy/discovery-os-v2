import { getProjectForUser } from "@/lib/auth/org";
import { isStaleIngestJob, looksLikeProcessedMarker } from "@/lib/ingest/quality";
import { createClient } from "@/lib/supabase/server";
import type { JobStatus, SourceType, TrustScope } from "@/types/database";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { SourceActions } from "../source-actions";
import { InsightProgress } from "./InsightProgress";
import { SessionExtras } from "./session-extras";

interface Props {
  params: { projectId: string; sourceId: string };
}

type SourceRow = {
  id: string;
  org_id: string;
  project_id: string;
  title: string;
  type: SourceType;
  trust_scope: TrustScope;
  ingested_at: string;
  metadata: Record<string, unknown>;
};

type SegmentRow = {
  id: string;
  org_id: string;
  source_id: string;
  segment_index: number;
  speaker: string | null;
  raw_content: string;
  redacted_content: string | null;
  word_count: number | null;
};

type EvidenceRow = {
  id: string;
  segment_id: string | null;
  trust_scope: TrustScope;
};

type SessionBriefRow = {
  id: string;
  title: string;
  content_md: string;
  created_at: string;
  metadata: Record<string, unknown>;
};

function briefPreview(markdown: string) {
  return (
    markdown
      .split("\n")
      .find((line) => {
        const trimmed = line.trim();
        return trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("---");
      })
      ?.replace(/^>\s?/, "")
      .trim() ?? "Brief generated. Click to read."
  );
}

function TrustBadge({ trustScope }: { trustScope: TrustScope | "missing" }) {
  const classes =
    trustScope === "trusted"
      ? "border-pos/20 bg-pos-bg text-pos"
      : trustScope === "pending"
      ? "border-warn/20 bg-warn-bg text-warn"
      : trustScope === "excluded"
      ? "border-neg/20 bg-neg-bg text-neg"
      : "border-[var(--border)] bg-[var(--surface-2)] text-[var(--ink-muted)]";

  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${classes}`}>
      {trustScope === "missing" ? "no evidence" : trustScope}
    </span>
  );
}

function StatusBadge({ status }: { status: JobStatus | "not_started" }) {
  const label =
    status === "failed"
      ? "check needed"
      : status === "pending"
      ? "queued"
      : status === "processing"
      ? "analyzing"
      : status;
  const classes =
    status === "done"
      ? "border-pos/20 bg-pos-bg text-pos"
      : status === "failed"
      ? "border-neg/20 bg-neg-bg text-neg"
      : status === "processing"
      ? "border-warn/20 bg-warn-bg text-warn"
      : status === "pending"
      ? "border-[var(--border)] bg-[var(--surface-2)] text-[var(--ink-muted)]"
      : "border-[var(--border)] bg-[var(--surface-2)] text-[var(--ink-muted)]";

  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${classes}`}>
      {label}
    </span>
  );
}

export default async function SourceDetailPage({ params }: Props) {
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

  const { data: source } = await supabase
    .from("sources")
    .select("id, org_id, project_id, title, type, trust_scope, ingested_at, metadata")
    .eq("org_id", project.org_id)
    .eq("project_id", project.id)
    .eq("id", params.sourceId)
    .single();

  if (!source) notFound();

  const [segmentsResult, evidenceResult, jobResult, briefResult] = await Promise.all([
    supabase
      .from("source_segments")
      .select("id, org_id, source_id, segment_index, speaker, raw_content, redacted_content, word_count")
      .eq("org_id", project.org_id)
      .eq("source_id", source.id)
      .order("segment_index", { ascending: true }),
    supabase
      .from("evidence")
      .select("id, org_id, project_id, source_id, segment_id, trust_scope")
      .eq("org_id", project.org_id)
      .eq("project_id", project.id)
      .eq("source_id", source.id),
    supabase
      .from("ingest_jobs")
      .select("id, org_id, source_id, status, error, result, created_at, completed_at")
      .eq("org_id", project.org_id)
      .eq("source_id", source.id)
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("artifacts")
      .select("id, title, content_md, created_at, metadata")
      .eq("org_id", project.org_id)
      .eq("project_id", project.id)
      .eq("type", "report")
      .filter("metadata->>source_id", "eq", params.sourceId)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const typedSource = source as SourceRow;
  const segments = (segmentsResult.data ?? []) as SegmentRow[];
  const evidenceRows = (evidenceResult.data ?? []) as EvidenceRow[];
  const latestJob = jobResult.data?.[0] as
    | {
        status: JobStatus;
        error: string | null;
        result: Record<string, number> | null;
        created_at: string;
      }
    | undefined;
  const sessionBrief = (briefResult.data?.[0] as SessionBriefRow | undefined) ?? null;

  const evidenceBySegment = new Map<string, EvidenceRow>();
  evidenceRows.forEach((record) => {
    if (record.segment_id) evidenceBySegment.set(record.segment_id, record);
  });
  const zeroEvidenceDone =
    latestJob?.status === "done" && evidenceRows.length === 0 && segments.length > 0;
  const staleJob = isStaleIngestJob(latestJob?.status, latestJob?.created_at);
  const displayStatus = zeroEvidenceDone || staleJob ? "failed" : latestJob?.status ?? "not_started";
  const isQueued = displayStatus === "pending";
  const isAnalyzing = displayStatus === "processing";
  const sourceLooksLikeMarker = looksLikeProcessedMarker(
    segments.map((segment) => segment.raw_content).join("\n\n")
  );

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8">
        <Link
          href={`/projects/${project.id}/sources`}
          className="mb-4 inline-flex text-sm font-medium text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]"
        >
          Back to sources
        </Link>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <StatusBadge status={displayStatus} />
              <span className="text-xs capitalize text-[var(--ink-muted)]">{typedSource.type}</span>
            </div>
            <h1 className="text-2xl font-semibold text-[var(--ink)]">{typedSource.title}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">
              Review the source chunks created during ingest and see which evidence records they produced.
            </p>
          </div>
          <SourceActions
            projectId={project.id}
            sourceId={typedSource.id}
            variant="detail"
            showRetry={displayStatus === "failed"}
          />
        </div>
      </div>

      {latestJob?.error && (
        <div className="mb-6 rounded-xl border border-neg/20 bg-neg-bg p-4 text-sm text-neg">
          {latestJob.error}
        </div>
      )}

      {isQueued && (
        <div className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-4 text-sm leading-6 text-[var(--ink-muted)]">
          <div className="font-semibold text-[var(--ink)]">Queued for ingest.</div>
          <p className="mt-1">
            DiscOS processes one source at a time for better extraction quality, lower cost, and fewer
            provider rate-limit failures. This source will start automatically.
          </p>
        </div>
      )}

      {isAnalyzing && (
        <div className="mb-6 rounded-xl border border-warn/20 bg-warn-bg p-4 text-sm leading-6 text-warn">
          <div className="font-semibold">Analyzing source.</div>
          <p className="mt-1">
            The ingest agent is segmenting the source and extracting citable evidence. Long transcripts
            can take several minutes.
          </p>
        </div>
      )}

      {staleJob && !latestJob?.error && (
        <div className="mb-6 rounded-xl border border-neg/20 bg-neg-bg p-4 text-sm leading-6 text-neg">
          <div className="font-semibold">Processing took too long.</div>
          <p className="mt-1">
            This source appears to be stuck. Use Retry to clear the partial segments and run ingest again.
          </p>
        </div>
      )}

      {zeroEvidenceDone && (
        <div className="mb-6 rounded-xl border border-neg/20 bg-neg-bg p-4 text-sm leading-6 text-neg">
          <div className="font-semibold">No evidence was created from this source.</div>
          <p className="mt-1">
            {sourceLooksLikeMarker
              ? "This looks like a processed marker file rather than the original transcript. Delete this source and upload the original transcript text."
              : "The job completed but did not extract any citable claims. Check the source text below, then retry if it is the original transcript or document."}
          </p>
        </div>
      )}

      <InsightProgress projectId={project.id} sourceId={typedSource.id} projectName={project.name} />

      {latestJob?.status === "done" && !zeroEvidenceDone && (
        <div className="mb-6">
          {sessionBrief ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5">
              <div className="mb-3 flex items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
                    Session brief
                  </div>
                  <h2 className="mt-1 text-base font-semibold text-[var(--ink)]">
                    {sessionBrief.title}
                  </h2>
                </div>
                <Link
                  href={`/projects/${project.id}/documents/${sessionBrief.id}`}
                  className="whitespace-nowrap rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--ink)] transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)]"
                >
                  Read brief
                </Link>
              </div>
              <p className="line-clamp-3 text-sm leading-6 text-[var(--ink-muted)]">
                {briefPreview(sessionBrief.content_md)}
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-1)] p-5">
              <div className="text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
                Session brief
              </div>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                Generating session brief. This usually takes under a minute after evidence is ready.
              </p>
            </div>
          )}
        </div>
      )}

      <SessionExtras sourceId={typedSource.id} />

      <div className="grid gap-3">
        {segments.map((segment) => {
          const evidence = evidenceBySegment.get(segment.id);

          return (
            <article
              key={segment.id}
              id={`segment-${segment.id}`}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5"
            >
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-[var(--ink-faint)]">
                    Segment {segment.segment_index + 1}
                  </span>
                  {segment.speaker && (
                    <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--brand)]">
                      {segment.speaker}
                    </span>
                  )}
                  {segment.word_count !== null && (
                    <span className="text-xs text-[var(--ink-muted)]">{segment.word_count} words</span>
                  )}
                </div>
                <TrustBadge trustScope={evidence?.trust_scope ?? "missing"} />
              </div>
              <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--ink)]">
                {segment.redacted_content || segment.raw_content}
              </p>
            </article>
          );
        })}
      </div>

      {segments.length === 0 && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-12 text-center text-sm text-[var(--ink-muted)]">
          {isQueued
            ? "No segments yet. This source is queued and will start automatically."
            : isAnalyzing
            ? "No segments yet. The ingest agent is preparing this source."
            : "No segments have been created yet. Retry the source if processing did not complete."}
        </div>
      )}
    </div>
  );
}
