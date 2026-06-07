"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { EvidenceRecord, TrustScope } from "@/types/database";
import Link from "next/link";
import {
  loadEvidenceRecordsAction,
  setEvidenceTrustBulkAction,
} from "./actions";

type BucketKey = Extract<TrustScope, "pending" | "trusted" | "excluded">;

interface EvidenceBrowserProps {
  projectId: string;
  initialRecords: EvidenceRecord[];
  pendingCount: number;
  trustedCount: number;
  excludedCount: number;
  researchContextEmpty: boolean;
}

const BUCKETS: {
  key: BucketKey;
  label: string;
  blurb: string;
  accent: string;
  activeAccent: string;
}[] = [
  {
    key: "pending",
    label: "Needs review",
    blurb: "AI wasn't sure — your call. Pull the keepers into Trusted.",
    accent: "text-warn",
    activeAccent: "border-warn/60 bg-warn-bg text-warn",
  },
  {
    key: "trusted",
    label: "Trusted",
    blurb: "Strong, on-topic evidence. These feed synthesis and drafts.",
    accent: "text-pos",
    activeAccent: "border-pos/60 bg-pos-bg text-pos",
  },
  {
    key: "excluded",
    label: "Excluded",
    blurb: "Off-topic or weak. Kept out of drafts — restore anything we got wrong.",
    accent: "text-[var(--ink-muted)]",
    activeAccent: "border-[var(--border)] bg-[var(--surface-2)] text-[var(--ink)]",
  },
];

function ClassificationBadge({ classification }: { classification: EvidenceRecord["classification"] }) {
  if (!classification) return null;

  const classes =
    classification === "insight"
      ? "border-[var(--accent)]/30 bg-[var(--accent-soft)] text-[var(--accent)]"
      : classification === "verbatim"
      ? "border-info/25 bg-info-bg text-info"
      : classification === "data_point"
      ? "border-info/25 bg-info-bg text-info"
      : "border-warn/25 bg-warn-bg text-warn";

  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${classes}`}>
      {classification.replace("_", " ")}
    </span>
  );
}

function GradeBadge({ grade }: { grade: EvidenceRecord["ai_trust_grade"] }) {
  if (!grade) {
    return (
      <span className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-xs font-medium text-[var(--ink-muted)]">
        Ungraded
      </span>
    );
  }
  if (grade === "trusted") {
    return (
      <span className="rounded-full border border-pos/25 bg-pos-bg px-2 py-0.5 text-xs font-medium text-pos">
        Strong
      </span>
    );
  }
  const classes =
    grade === "uncertain"
      ? "border-warn/25 bg-warn-bg text-warn"
      : "border-[var(--border)] bg-[var(--surface-2)] text-[var(--ink-muted)]";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${classes}`}>
      {grade === "uncertain" ? "Uncertain" : "Weak"}
    </span>
  );
}

function SentimentIndicator({ sentiment }: { sentiment: EvidenceRecord["sentiment"] }) {
  if (!sentiment) return null;

  const classes =
    sentiment === "positive"
      ? "bg-pos"
      : sentiment === "negative"
      ? "bg-neg"
      : sentiment === "mixed"
      ? "bg-warn"
      : "bg-[var(--ink-faint)]";

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--ink-muted)]">
      <span className={`h-1.5 w-1.5 rounded-full ${classes}`} />
      {sentiment}
    </span>
  );
}

function EvidenceRow({
  projectId,
  record,
  selected,
  onToggle,
  onQuickMove,
  busy,
}: {
  projectId: string;
  record: EvidenceRecord;
  selected: boolean;
  onToggle: () => void;
  onQuickMove: (target: BucketKey) => void;
  busy: boolean;
}) {
  const showReason =
    record.ai_trust_reason &&
    (record.ai_trust_grade === "uncertain" || record.ai_trust_grade === "weak");

  // Quick actions depend on which bucket the record currently lives in.
  const quick: { target: BucketKey; label: string; tone: string }[] =
    record.trust_scope === "pending"
      ? [
          { target: "trusted", label: "Trust", tone: "text-pos hover:border-pos border-pos/20" },
          { target: "excluded", label: "Exclude", tone: "text-neg hover:border-neg border-neg/20" },
        ]
      : record.trust_scope === "trusted"
      ? [
          { target: "pending", label: "To review", tone: "text-warn hover:border-warn border-warn/20" },
          { target: "excluded", label: "Exclude", tone: "text-neg hover:border-neg border-neg/20" },
        ]
      : [
          { target: "pending", label: "To review", tone: "text-warn hover:border-warn border-warn/20" },
          { target: "trusted", label: "Trust", tone: "text-pos hover:border-pos border-pos/20" },
        ];

  return (
    <article
      className={`flex gap-3 rounded-xl border bg-[var(--surface-1)] p-4 transition-colors ${
        selected ? "border-[var(--brand)]/60" : "border-[var(--border)] hover:border-white/15"
      }`}
    >
      <label className="mt-0.5 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="h-4 w-4 cursor-pointer accent-[var(--brand)]"
        />
      </label>

      <div className="min-w-0 flex-1">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {record.source_title && (
              <div className="truncate text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
                {record.source_title}
              </div>
            )}
            {record.segment_speaker && (
              <div className="mt-0.5 text-xs font-medium text-[var(--brand)]">{record.segment_speaker}</div>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
            <GradeBadge grade={record.ai_trust_grade} />
            <ClassificationBadge classification={record.classification} />
          </div>
        </div>

        {record.summary && (
          <div className="mb-1 text-sm font-medium text-[var(--ink)]">{record.summary}</div>
        )}
        <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--ink)]">{record.content}</p>

        {showReason && (
          <p className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-xs leading-5 text-[var(--ink-muted)]">
            {record.ai_trust_reason}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <SentimentIndicator sentiment={record.sentiment} />
          {record.segment_id && (
            <Link
              href={`/projects/${projectId}/sources/${record.source_id}#segment-${record.segment_id}`}
              className="text-xs font-medium text-[var(--ink-muted)] transition-colors hover:text-[var(--brand)]"
            >
              View source segment
            </Link>
          )}
          <span className="flex-1" />
          {quick.map((action) => (
            <button
              key={action.target}
              type="button"
              disabled={busy}
              onClick={() => onQuickMove(action.target)}
              className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${action.tone}`}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </article>
  );
}

export function EvidenceBrowser({
  projectId,
  initialRecords,
  pendingCount,
  trustedCount,
  excludedCount,
  researchContextEmpty,
}: EvidenceBrowserProps) {
  const [activeTab, setActiveTab] = useState<BucketKey>("pending");
  const [counts, setCounts] = useState<Record<BucketKey, number>>({
    pending: pendingCount,
    trusted: trustedCount,
    excluded: excludedCount,
  });

  const [records, setRecords] = useState<EvidenceRecord[]>(initialRecords);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showContextNudge, setShowContextNudge] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(initialRecords.length === 20);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isLoadingTab, setIsLoadingTab] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [isSearching, startSearch] = useTransition();
  // Whether the pending bucket still holds its server-seeded initial page.
  const [pendingSeeded, setPendingSeeded] = useState(true);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingMoreRef = useRef(false);

  const trimmedQuery = useMemo(() => query.trim(), [query]);
  const activeBucket = BUCKETS.find((b) => b.key === activeTab)!;

  const loadTab = useCallback(
    async (tab: BucketKey) => {
      setIsLoadingTab(true);
      setError(null);
      try {
        const next = await loadEvidenceRecordsAction({
          projectId,
          offset: 0,
          limit: 20,
          trustScope: tab,
        });
        setRecords(next);
        setHasMore(next.length === 20);
      } catch {
        setError("Could not load evidence.");
      } finally {
        setIsLoadingTab(false);
      }
    },
    [projectId]
  );

  useEffect(() => {
    const dismissed =
      window.sessionStorage.getItem(`research-context-nudge:${projectId}`) === "dismissed";
    setShowContextNudge(researchContextEmpty && pendingCount > 0 && !dismissed);
  }, [pendingCount, projectId, researchContextEmpty]);

  function switchTab(tab: BucketKey) {
    if (tab === activeTab) return;
    setActiveTab(tab);
    setSelected(new Set());
    setQuery("");
    if (tab === "pending" && pendingSeeded) {
      setRecords(initialRecords);
      setHasMore(initialRecords.length === 20);
      setError(null);
      return;
    }
    void loadTab(tab);
  }

  // Debounced search, scoped to the active bucket.
  useEffect(() => {
    if (!trimmedQuery) return;
    const timeout = window.setTimeout(() => {
      startSearch(async () => {
        const response = await fetch("/api/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_id: projectId,
            q: trimmedQuery,
            limit: 30,
            trust_scope: activeTab,
          }),
        });
        const payload = await response.json();
        if (!response.ok) {
          setError(payload.error ?? "Search failed.");
          return;
        }
        setError(null);
        setSelected(new Set());
        setRecords(payload.records ?? []);
        setHasMore(false);
      });
    }, 400);
    return () => window.clearTimeout(timeout);
  }, [activeTab, projectId, trimmedQuery]);

  // Clearing the search restores the bucket view.
  useEffect(() => {
    if (trimmedQuery) return;
    if (activeTab === "pending" && pendingSeeded) {
      setRecords(initialRecords);
      setHasMore(initialRecords.length === 20);
      return;
    }
    void loadTab(activeTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmedQuery]);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore) return;
    loadingMoreRef.current = true;
    setIsLoadingMore(true);
    setError(null);
    try {
      const next = await loadEvidenceRecordsAction({
        projectId,
        offset: records.length,
        limit: 20,
        trustScope: activeTab,
      });
      setRecords((current) => {
        const seen = new Set(current.map((r) => r.id));
        return [...current, ...next.filter((r) => !seen.has(r.id))];
      });
      setHasMore(next.length === 20);
    } catch {
      setError("Could not load more evidence.");
    } finally {
      setIsLoadingMore(false);
      loadingMoreRef.current = false;
    }
  }, [activeTab, hasMore, projectId, records.length]);

  // Infinite scroll: load the next page when the sentinel scrolls into view.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || trimmedQuery || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: "300px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [trimmedQuery, hasMore, loadMore]);

  function toggleOne(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((current) =>
      current.size === records.length ? new Set() : new Set(records.map((r) => r.id))
    );
  }

  async function moveRecords(ids: string[], target: BucketKey) {
    if (ids.length === 0) return;
    setIsMutating(true);
    setError(null);

    const moving = records.filter((r) => ids.includes(r.id));
    const result = await setEvidenceTrustBulkAction({
      projectId,
      evidenceIds: ids,
      trustScope: target,
    });
    setIsMutating(false);

    if (!result.ok) {
      setError(result.error ?? "Could not update evidence.");
      return;
    }

    // Remove from the current view and reconcile bucket counts.
    setRecords((current) => current.filter((r) => !ids.includes(r.id)));
    setSelected((current) => {
      const next = new Set(current);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    setCounts((current) => {
      const next = { ...current };
      for (const rec of moving) {
        const from = rec.trust_scope as BucketKey;
        if (from in next) next[from] = Math.max(0, next[from] - 1);
      }
      if (target in next) next[target] += moving.length;
      return next;
    });
    if (activeTab === "pending") setPendingSeeded(false);
  }

  const selectedIds = useMemo(() => Array.from(selected), [selected]);
  const bulkTargets: { target: BucketKey; label: string; tone: string }[] =
    activeTab === "pending"
      ? [
          { target: "trusted", label: "Trust selected", tone: "border-pos/30 text-pos hover:border-pos" },
          { target: "excluded", label: "Exclude selected", tone: "border-neg/30 text-neg hover:border-neg" },
        ]
      : activeTab === "trusted"
      ? [
          { target: "pending", label: "Move to review", tone: "border-warn/30 text-warn hover:border-warn" },
          { target: "excluded", label: "Exclude selected", tone: "border-neg/30 text-neg hover:border-neg" },
        ]
      : [
          { target: "pending", label: "Move to review", tone: "border-warn/30 text-warn hover:border-warn" },
          { target: "trusted", label: "Trust selected", tone: "border-pos/30 text-pos hover:border-pos" },
        ];

  function dismissContextNudge() {
    window.sessionStorage.setItem(`research-context-nudge:${projectId}`, "dismissed");
    setShowContextNudge(false);
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)]">
      {/* Tab bar */}
      <div className="flex flex-wrap gap-2 border-b border-[var(--border)] p-3 sm:p-4">
        {BUCKETS.map((bucket) => {
          const active = bucket.key === activeTab;
          return (
            <button
              key={bucket.key}
              type="button"
              onClick={() => switchTab(bucket.key)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? bucket.activeAccent
                  : "border-[var(--border)] text-[var(--ink-muted)] hover:border-white/15 hover:text-[var(--ink)]"
              }`}
            >
              {bucket.label}
              <span className={`text-xs font-semibold ${active ? "" : bucket.accent}`}>
                {counts[bucket.key]}
              </span>
            </button>
          );
        })}
      </div>

      <div className="border-b border-[var(--border)] p-4 sm:p-5">
        <p className="mb-3 text-sm text-[var(--ink-muted)]">{activeBucket.blurb}</p>

        {showContextNudge && activeTab === "pending" && (
          <div className="mb-4 flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-[var(--ink-muted)]">
              Add your research focus in settings so the AI can sort what matters automatically.
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

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-faint)] focus:border-[var(--brand)]"
            placeholder={`Search ${activeBucket.label.toLowerCase()}`}
          />
          {records.length > 0 && (
            <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-xs font-medium text-[var(--ink-muted)]">
              <input
                type="checkbox"
                checked={selected.size === records.length && records.length > 0}
                onChange={toggleAll}
                className="h-4 w-4 cursor-pointer accent-[var(--brand)]"
              />
              Select all
            </label>
          )}
        </div>

        <div className="mt-3 text-xs text-[var(--ink-muted)]">
          {isSearching || isLoadingTab
            ? "Loading..."
            : trimmedQuery
            ? `${records.length} match${records.length === 1 ? "" : "es"} in ${activeBucket.label.toLowerCase()}`
            : `Showing ${records.length} of ${counts[activeTab]}`}
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="sticky top-14 z-10 flex flex-wrap items-center gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 sm:px-5">
          <span className="text-sm font-medium text-[var(--ink)]">{selected.size} selected</span>
          <span className="flex-1" />
          {bulkTargets.map((action) => (
            <button
              key={action.target}
              type="button"
              disabled={isMutating}
              onClick={() => moveRecords(selectedIds, action.target)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${action.tone}`}
            >
              {action.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-xs font-medium text-[var(--ink-faint)] transition-colors hover:text-[var(--ink-muted)]"
          >
            Clear
          </button>
        </div>
      )}

      {error && (
        <div className="m-5 rounded-lg border border-neg/20 bg-neg-bg px-3 py-2 text-sm text-neg">
          {error}
        </div>
      )}

      {records.length === 0 ? (
        <div className="p-12 text-center">
          <div className="text-sm font-medium text-[var(--ink)]">
            {trimmedQuery
              ? "No matches in this bucket."
              : activeTab === "pending"
              ? "Nothing left to review"
              : activeTab === "trusted"
              ? "No trusted evidence yet"
              : "Nothing excluded"}
          </div>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--ink-muted)]">
            {trimmedQuery
              ? "Try a broader search or clear the search field."
              : activeTab === "pending"
              ? "Every record has been sorted. New sessions will add more here when the AI is unsure."
              : activeTab === "trusted"
              ? "Promote records from Needs review to build your trusted set."
              : "Weak or off-topic records land here automatically."}
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-3 p-4 sm:p-5">
            {records.map((record) => (
              <EvidenceRow
                key={record.id}
                projectId={projectId}
                record={record}
                selected={selected.has(record.id)}
                onToggle={() => toggleOne(record.id)}
                onQuickMove={(target) => moveRecords([record.id], target)}
                busy={isMutating}
              />
            ))}
          </div>
          {!trimmedQuery && hasMore && (
            <div
              ref={sentinelRef}
              className="border-t border-[var(--border)] p-5 text-center text-sm text-[var(--ink-muted)]"
            >
              {isLoadingMore ? "Loading more…" : (
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--ink)] transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)]"
                >
                  Load more
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
