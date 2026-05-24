"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { EvidenceRecord } from "@/types/database";
import { trustScopeClasses, trustScopeLabel } from "@/lib/labels";
import Link from "next/link";
import { loadEvidenceRecordsAction, updateEvidenceTrustAction } from "./actions";

interface EvidenceBrowserProps {
  projectId: string;
  initialRecords: EvidenceRecord[];
  pendingCount: number;
  trustedCount: number;
  uncertainCount: number;
  researchContextEmpty: boolean;
}

function TrustBadge({ trustScope }: { trustScope: string }) {
  return (
    <span className={`rounded-full border border-transparent px-2 py-0.5 text-xs font-medium ${trustScopeClasses(trustScope)}`}>
      {trustScopeLabel(trustScope)}
    </span>
  );
}

function ClassificationBadge({ classification }: { classification: EvidenceRecord["classification"] }) {
  if (!classification) return null;

  const classes =
    classification === "insight"
      ? "border-[var(--brand)]/30 bg-[var(--brand)]/10 text-[var(--brand)]"
      : classification === "verbatim"
      ? "border-blue-500/25 bg-blue-500/10 text-blue-300"
      : classification === "data_point"
      ? "border-cyan-500/25 bg-cyan-500/10 text-cyan-300"
      : "border-amber-500/25 bg-amber-500/10 text-amber-300";

  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${classes}`}>
      {classification.replace("_", " ")}
    </span>
  );
}

function SentimentIndicator({ sentiment }: { sentiment: EvidenceRecord["sentiment"] }) {
  if (!sentiment) return null;

  const classes =
    sentiment === "positive"
      ? "bg-green-400"
      : sentiment === "negative"
      ? "bg-red-400"
      : sentiment === "mixed"
      ? "bg-yellow-400"
      : "bg-[var(--ink-faint)]";

  return (
    <span className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--ink-muted)]">
      <span className={`h-1.5 w-1.5 rounded-full ${classes}`} />
      {sentiment}
    </span>
  );
}

function ConfidenceBadge({ grade }: { grade: EvidenceRecord["ai_trust_grade"] }) {
  if (!grade || grade === "trusted") return null;

  const classes =
    grade === "uncertain"
      ? "border-yellow-500/25 bg-yellow-500/10 text-yellow-300"
      : "border-[var(--border)] bg-[var(--surface-2)] text-[var(--ink-muted)]";

  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${classes}`}>
      {grade === "uncertain" ? "Needs a look" : "Low signal"}
    </span>
  );
}

function EvidenceCard({ projectId, record }: { projectId: string; record: EvidenceRecord }) {
  const showGradeReason =
    (record.ai_trust_grade === "uncertain" || record.ai_trust_grade === "weak") &&
    record.ai_trust_reason;
  const trustLabel =
    record.ai_trust_grade === "weak"
      ? "Keep anyway"
      : record.ai_trust_grade === "uncertain"
      ? "Keep"
      : "Trust";
  const excludeLabel =
    record.ai_trust_grade === "uncertain" || record.ai_trust_grade === "weak"
      ? "Dismiss"
      : "Exclude";

  return (
    <article className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5 transition-colors hover:border-white/15">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          {record.source_title && (
            <div className="truncate text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
              {record.source_title}
            </div>
          )}
          {record.segment_speaker && (
            <div className="mt-1 text-xs font-medium text-[var(--brand)]">{record.segment_speaker}</div>
          )}
          <SentimentIndicator sentiment={record.sentiment} />
          {record.summary && (
            <div className="mt-1 text-sm font-medium text-[var(--ink)]">{record.summary}</div>
          )}
          {record.segment_id && (
            <Link
              href={`/projects/${projectId}/sources/${record.source_id}#segment-${record.segment_id}`}
              className="mt-2 inline-flex text-xs font-medium text-[var(--ink-muted)] transition-colors hover:text-[var(--brand)]"
            >
              View source segment
            </Link>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <ConfidenceBadge grade={record.ai_trust_grade} />
          <ClassificationBadge classification={record.classification} />
          <TrustBadge trustScope={record.trust_scope} />
        </div>
      </div>

      <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--ink)]">
        {record.content}
      </p>

      {showGradeReason && (
        <p className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-xs leading-5 text-[var(--ink-muted)]">
          {record.ai_trust_reason}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <form action={updateEvidenceTrustAction}>
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="evidence_id" value={record.id} />
          <input type="hidden" name="trust_scope" value="trusted" />
          <button
            type="submit"
            disabled={record.trust_scope === "trusted"}
            className="rounded-lg border border-green-500/20 px-3 py-1.5 text-xs font-medium text-green-300 transition-colors hover:border-green-400 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {trustLabel}
          </button>
        </form>
        <form action={updateEvidenceTrustAction}>
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="evidence_id" value={record.id} />
          <input type="hidden" name="trust_scope" value="excluded" />
          <button
            type="submit"
            disabled={record.trust_scope === "excluded"}
            className="rounded-lg border border-red-500/20 px-3 py-1.5 text-xs font-medium text-red-300 transition-colors hover:border-red-400 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {excludeLabel}
          </button>
        </form>
      </div>
    </article>
  );
}

export function EvidenceBrowser({
  projectId,
  initialRecords,
  pendingCount,
  trustedCount,
  uncertainCount,
  researchContextEmpty,
}: EvidenceBrowserProps) {
  const [query, setQuery] = useState("");
  const [records, setRecords] = useState(initialRecords);
  const [gradeFilter, setGradeFilter] = useState<"all" | "uncertain">("all");
  const [showContextNudge, setShowContextNudge] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(initialRecords.length === 20);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isPending, startTransition] = useTransition();

  const trimmedQuery = useMemo(() => query.trim(), [query]);
  const visibleRecords = useMemo(
    () =>
      gradeFilter === "uncertain"
        ? records.filter((record) => record.ai_trust_grade === "uncertain")
        : records,
    [gradeFilter, records]
  );

  useEffect(() => {
    const dismissed = window.sessionStorage.getItem(`research-context-nudge:${projectId}`) === "dismissed";
    setShowContextNudge(researchContextEmpty && initialRecords.length > 0 && !dismissed);
  }, [initialRecords.length, projectId, researchContextEmpty]);

  useEffect(() => {
    if (!trimmedQuery) {
      setRecords(initialRecords);
      setHasMore(initialRecords.length === 20);
      setError(null);
      return;
    }

    const timeout = window.setTimeout(() => {
      startTransition(async () => {
        const response = await fetch("/api/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_id: projectId,
            q: trimmedQuery,
            limit: 20,
            trust_scope: "all",
          }),
        });

        const payload = await response.json();
        if (!response.ok) {
          setError(payload.error ?? "Search failed.");
          return;
        }

        setError(null);
        setRecords(payload.records ?? []);
        setHasMore(false);
      });
    }, 400);

    return () => window.clearTimeout(timeout);
  }, [initialRecords, projectId, trimmedQuery]);

  async function loadMoreRecords() {
    setIsLoadingMore(true);
    setError(null);

    try {
      const nextRecords = await loadEvidenceRecordsAction({
        projectId,
        offset: records.length,
        limit: 20,
      });

      setRecords((currentRecords) => {
        const seen = new Set(currentRecords.map((record) => record.id));
        const uniqueNext = nextRecords.filter((record) => !seen.has(record.id));
        return [...currentRecords, ...uniqueNext];
      });
      setHasMore(nextRecords.length === 20);
    } catch {
      setError("Could not load more evidence.");
    } finally {
      setIsLoadingMore(false);
    }
  }

  function dismissContextNudge() {
    window.sessionStorage.setItem(`research-context-nudge:${projectId}`, "dismissed");
    setShowContextNudge(false);
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)]">
      <div className="border-b border-[var(--border)] p-4 sm:p-5">
        {uncertainCount > 5 && (
          <div className="mb-4 flex flex-col gap-3 rounded-lg border border-yellow-500/20 bg-yellow-500/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-medium text-yellow-100">
              {uncertainCount} pieces of evidence are waiting for your input.
            </p>
            <button
              type="button"
              onClick={() => setGradeFilter("uncertain")}
              className="rounded-lg border border-yellow-400/30 px-3 py-1.5 text-xs font-medium text-yellow-100 transition-colors hover:border-yellow-300"
            >
              Review
            </button>
          </div>
        )}

        {showContextNudge && (
          <div className="mb-4 flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-[var(--ink-muted)]">
              Add your research focus to help sort what matters.
            </p>
            <div className="flex items-center gap-3">
              <Link
                href={`/projects/${projectId}/settings`}
                className="text-xs font-medium text-[var(--brand)] transition-colors hover:text-[var(--ink)]"
              >
                Open settings
              </Link>
              <button
                type="button"
                onClick={dismissContextNudge}
                className="text-xs font-medium text-[var(--ink-faint)] transition-colors hover:text-[var(--ink-muted)]"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        <div className="mb-3 flex flex-col gap-3 xl:flex-row">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-faint)] focus:border-[var(--brand)]"
            placeholder="Search evidence"
          />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-xs font-medium text-[var(--ink-muted)]">
              <span className="text-yellow-300">{pendingCount}</span> needs review
              <span className="px-2 text-[var(--ink-faint)]">/</span>
              <span className="text-green-300">{trustedCount}</span> trusted
            </div>
            <form action={updateEvidenceTrustAction}>
              <input type="hidden" name="project_id" value={projectId} />
              <input type="hidden" name="trust_scope" value="trusted" />
              <button
                type="submit"
                className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--ink)] transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)] sm:w-auto"
              >
                Trust all
              </button>
            </form>
          </div>
        </div>
        {gradeFilter === "uncertain" && (
          <div className="mb-3">
            <button
              type="button"
              onClick={() => setGradeFilter("all")}
              className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--ink-muted)] transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)]"
            >
              Showing records that need a look x
            </button>
          </div>
        )}
        <div className="text-xs text-[var(--ink-muted)]">
          {isPending
            ? "Searching..."
            : trimmedQuery
            ? `${visibleRecords.length} matches`
            : gradeFilter === "uncertain"
            ? `${visibleRecords.length} records need a look`
            : "20 most recent records"}
        </div>
      </div>

      {error && (
        <div className="m-5 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {visibleRecords.length === 0 ? (
        <div className="p-12 text-center">
          <div className="text-sm font-medium text-[var(--ink)]">
            {trimmedQuery ? "No evidence found." : "No evidence yet"}
          </div>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--ink-muted)]">
            {trimmedQuery
              ? "Try a broader search or clear the search field."
              : "Add a session to start building source-backed evidence."}
          </p>
          {!trimmedQuery && (
            <Link
              href={`/projects/${projectId}/ingest`}
              className="mt-5 inline-flex rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-dim)]"
            >
              Add your first transcript →
            </Link>
          )}
        </div>
      ) : (
        <>
          <div className="grid gap-3 p-4 sm:p-5">
            {visibleRecords.map((record) => (
              <EvidenceCard key={record.id} projectId={projectId} record={record} />
            ))}
          </div>
          {!trimmedQuery && hasMore && (
            <div className="border-t border-[var(--border)] p-5 text-center">
              <button
                type="button"
                onClick={loadMoreRecords}
                disabled={isLoadingMore}
                className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--ink)] transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isLoadingMore ? "Loading..." : "Load more"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
