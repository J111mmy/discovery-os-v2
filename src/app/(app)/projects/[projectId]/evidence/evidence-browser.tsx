"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { EvidenceRecord, TrustScope } from "@/types/database";
import Link from "next/link";
import {
  loadEvidenceRecordsAction,
  setEvidenceTrustBulkAction,
} from "./actions";

type BucketKey = Extract<TrustScope, "pending" | "trusted" | "excluded">;
type EvidenceLensKey = "review" | "topics" | "themes" | "problems" | "sources";
type EvidenceFilterKind = "topic" | "theme";

export interface LensTrustMix {
  pending: number;
  trusted: number;
  excluded: number;
}

export interface LensEvidencePreview {
  id: string;
  content: string;
  summary: string | null;
  trust_scope: TrustScope;
  source_title: string | null;
  source_type: string | null;
}

export interface TopicLensItem {
  id: string;
  label: string;
  support_count: number;
  trust_mix: LensTrustMix;
  source_types: string[];
  linked_theme_count: number;
  linked_problem_count: number;
  recent_evidence: LensEvidencePreview | null;
}

export interface ThemeLensItem {
  id: string;
  label: string;
  description: string | null;
  support_count: number;
  supporting_topic_count: number;
  related_problem_count: number;
  recent_evidence: LensEvidencePreview | null;
}

export interface ProblemLensItem {
  id: string;
  title: string;
  description: string | null;
  status: string | null;
  severity: string | null;
  evidence_count: number;
  related_topic_count: number;
  related_theme_count: number;
  recent_evidence: LensEvidencePreview | null;
}

export interface SourceLensItem {
  id: string;
  title: string;
  type: string | null;
  evidence_count: number;
  trust_mix: LensTrustMix;
  topic_count: number;
  recent_evidence: LensEvidencePreview | null;
}

export interface EvidenceLensData {
  topics: TopicLensItem[];
  themes: ThemeLensItem[];
  problems: ProblemLensItem[];
  sources: SourceLensItem[];
}

interface EvidenceBrowserProps {
  projectId: string;
  initialRecords: EvidenceRecord[];
  pendingCount: number;
  trustedCount: number;
  excludedCount: number;
  researchContextEmpty: boolean;
  themeFilter?: string;
  filterKind?: EvidenceFilterKind;
  lensData: EvidenceLensData;
  internalSpeakerNames: string[];
}

const LENSES: { key: EvidenceLensKey; label: string; blurb: string }[] = [
  {
    key: "review",
    label: "Review",
    blurb: "Sort evidence by trust before it feeds synthesis and artifacts.",
  },
  {
    key: "topics",
    label: "Topics",
    blurb: "Snippet-level analytical labels from the current evidence model.",
  },
  {
    key: "themes",
    label: "Themes",
    blurb: "Higher-order patterns linked through the reviewed theme table.",
  },
  {
    key: "problems",
    label: "Problems",
    blurb: "Evidence grouped under the problem objects it currently informs.",
  },
  {
    key: "sources",
    label: "Sources",
    blurb: "A source-first view for provenance and context checks.",
  },
];

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
    blurb: "AI wasn't sure. Your call. Pull the keepers into Trusted.",
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
    blurb: "Off-topic or weak. Kept out of drafts. Restore anything we got wrong.",
    accent: "text-[var(--ink-2)]",
    activeAccent: "border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink)]",
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
      <span className="rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-2 py-0.5 text-xs font-medium text-[var(--ink-2)]">
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
      : "border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink-2)]";
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
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--ink-2)]">
      <span className={`h-1.5 w-1.5 rounded-full ${classes}`} />
      {sentiment}
    </span>
  );
}

function sourceTypeLabel(type: string | null | undefined) {
  if (!type) return "Unknown source";
  return type
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function previewText(preview: LensEvidencePreview | null) {
  if (!preview) return "No representative evidence yet.";
  return preview.summary?.trim() || preview.content;
}

function trustMixText(mix: LensTrustMix) {
  const pieces = [
    mix.trusted > 0 ? `${mix.trusted} trusted` : null,
    mix.pending > 0 ? `${mix.pending} review` : null,
    mix.excluded > 0 ? `${mix.excluded} excluded` : null,
  ].filter(Boolean);

  return pieces.length > 0 ? pieces.join(" · ") : "No evidence";
}

function anchorAffordance(record: EvidenceRecord) {
  const raw = record.metadata?.anchor_method;
  const method = typeof raw === "string" ? raw : null;
  const confident = method === "exact" || method === "normalised";

  return {
    label: confident ? "Open in source" : "Approximate location in source",
    title: confident
      ? "Open the exact source segment for this evidence."
      : "The matcher found the closest available source location, but it may not be an exact quote anchor.",
    className: confident
      ? "text-[var(--accent)] hover:text-[var(--ink)]"
      : "text-warn hover:text-[var(--ink)]",
  };
}

function EvidenceRow({
  projectId,
  record,
  selected,
  onToggle,
  onQuickMove,
  busy,
  isInternal,
}: {
  projectId: string;
  record: EvidenceRecord;
  selected: boolean;
  onToggle: () => void;
  onQuickMove: (target: BucketKey) => void;
  busy: boolean;
  isInternal?: boolean;
}) {
  const showReason =
    record.ai_trust_reason &&
    (record.ai_trust_grade === "uncertain" || record.ai_trust_grade === "weak");
  const sourceLink = anchorAffordance(record);

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
      className={`flex gap-3 rounded-xl border bg-[var(--surface)] p-4 transition-colors ${
        selected ? "border-[var(--accent)]/60" : "border-[var(--line)] hover:border-white/15"
      }`}
    >
      <label className="mt-0.5 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="h-4 w-4 cursor-pointer accent-[var(--accent)]"
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
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className="text-xs font-medium text-[var(--accent)]">{record.segment_speaker}</span>
                {isInternal && (
                  <span className="rounded-full border border-[var(--line)] bg-[var(--bg)] px-1.5 py-0 text-[10px] font-medium text-[var(--ink-2)]">
                    Internal
                  </span>
                )}
              </div>
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
          <p className="mt-2 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-xs leading-5 text-[var(--ink-2)]">
            {record.ai_trust_reason}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <SentimentIndicator sentiment={record.sentiment} />
          {record.segment_id && (
            <Link
              href={`/projects/${projectId}/sources/${record.source_id}#segment-${record.segment_id}`}
              title={sourceLink.title}
              className={`text-xs font-medium transition-colors ${sourceLink.className}`}
            >
              {sourceLink.label}
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

function EmptyLens({ label }: { label: string }) {
  return (
    <div className="p-12 text-center">
      <div className="text-sm font-medium text-[var(--ink)]">No {label.toLowerCase()} yet</div>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--ink-2)]">
        This lens will fill in as the project accumulates reviewed evidence and synthesis links.
      </p>
    </div>
  );
}

function EvidencePreview({ preview }: { preview: LensEvidencePreview | null }) {
  if (!preview) return null;

  return (
    <div className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2">
      <div className="mb-1 flex items-center gap-2 text-[10px] font-medium uppercase tracking-wide text-[var(--ink-faint)]">
        <span className="truncate">{preview.source_title ?? "Unknown source"}</span>
        <span>·</span>
        <span>{sourceTypeLabel(preview.source_type)}</span>
      </div>
      <p className="line-clamp-2 text-xs leading-5 text-[var(--ink-2)]">{previewText(preview)}</p>
    </div>
  );
}

function LensStat({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="rounded-full border border-[var(--line)] bg-[var(--bg)] px-2 py-0.5 text-xs font-medium text-[var(--ink-2)]">
      {value}
      {label ? ` ${label}` : ""}
    </span>
  );
}

function TopicLens({ projectId, items }: { projectId: string; items: TopicLensItem[] }) {
  if (items.length === 0) return <EmptyLens label="topics" />;

  return (
    <div className="grid gap-3 p-4 sm:p-5">
      {items.map((item) => (
        <article
          key={item.id}
          className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <Link
                href={`/projects/${projectId}/evidence?topic_id=${item.id}`}
                className="text-base font-semibold text-[var(--ink)] transition-colors hover:text-[var(--accent)]"
              >
                {item.label}
              </Link>
              <p className="mt-1 text-xs text-[var(--ink-2)]">{trustMixText(item.trust_mix)}</p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-1.5">
              <LensStat label="records" value={item.support_count} />
              <LensStat label="themes" value={item.linked_theme_count} />
              <LensStat label="problems" value={item.linked_problem_count} />
            </div>
          </div>
          {item.source_types.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {item.source_types.slice(0, 4).map((type) => (
                <span
                  key={type}
                  className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-xs text-[var(--ink-2)]"
                >
                  {sourceTypeLabel(type)}
                </span>
              ))}
            </div>
          )}
          <EvidencePreview preview={item.recent_evidence} />
        </article>
      ))}
    </div>
  );
}

function ThemeLens({ projectId, items }: { projectId: string; items: ThemeLensItem[] }) {
  if (items.length === 0) return <EmptyLens label="themes" />;

  return (
    <div className="grid gap-3 p-4 sm:p-5">
      {items.map((item) => (
        <article
          key={item.id}
          className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <Link
                href={`/projects/${projectId}/evidence?theme_id=${item.id}`}
                className="text-base font-semibold text-[var(--ink)] transition-colors hover:text-[var(--accent)]"
              >
                {item.label}
              </Link>
              {item.description && (
                <p className="mt-1 line-clamp-2 text-sm leading-5 text-[var(--ink-2)]">
                  {item.description}
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap gap-1.5">
              <LensStat label="records" value={item.support_count} />
              <LensStat label="topics" value={item.supporting_topic_count} />
              <LensStat label="problems" value={item.related_problem_count} />
            </div>
          </div>
          <EvidencePreview preview={item.recent_evidence} />
        </article>
      ))}
    </div>
  );
}

function ProblemLens({ projectId, items }: { projectId: string; items: ProblemLensItem[] }) {
  if (items.length === 0) return <EmptyLens label="problems" />;

  return (
    <div className="grid gap-3 p-4 sm:p-5">
      {items.map((item) => (
        <article
          key={item.id}
          className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <Link
                href={`/projects/${projectId}/problems?problem=${item.id}`}
                className="text-base font-semibold text-[var(--ink)] transition-colors hover:text-[var(--accent)]"
              >
                {item.title}
              </Link>
              {item.description && (
                <p className="mt-1 line-clamp-2 text-sm leading-5 text-[var(--ink-2)]">
                  {item.description}
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap gap-1.5">
              {item.status && <LensStat label="" value={item.status} />}
              {item.severity && <LensStat label="" value={item.severity} />}
              <LensStat label="records" value={item.evidence_count} />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <LensStat label="topics" value={item.related_topic_count} />
            <LensStat label="themes" value={item.related_theme_count} />
          </div>
          <EvidencePreview preview={item.recent_evidence} />
        </article>
      ))}
    </div>
  );
}

function SourceLens({ projectId, items }: { projectId: string; items: SourceLensItem[] }) {
  if (items.length === 0) return <EmptyLens label="sources" />;

  return (
    <div className="grid gap-3 p-4 sm:p-5">
      {items.map((item) => (
        <article
          key={item.id}
          className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <Link
                href={`/projects/${projectId}/sources/${item.id}`}
                className="text-base font-semibold text-[var(--ink)] transition-colors hover:text-[var(--accent)]"
              >
                {item.title}
              </Link>
              <p className="mt-1 text-xs text-[var(--ink-2)]">
                {sourceTypeLabel(item.type)} · {trustMixText(item.trust_mix)}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-1.5">
              <LensStat label="records" value={item.evidence_count} />
              <LensStat label="topics" value={item.topic_count} />
            </div>
          </div>
          <EvidencePreview preview={item.recent_evidence} />
        </article>
      ))}
    </div>
  );
}

export function EvidenceBrowser({
  projectId,
  initialRecords,
  pendingCount,
  trustedCount,
  excludedCount,
  researchContextEmpty,
  themeFilter,
  filterKind = themeFilter ? "topic" : undefined,
  lensData,
  internalSpeakerNames,
}: EvidenceBrowserProps) {
  const [activeLens, setActiveLens] = useState<EvidenceLensKey>("review");
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
  // Internal-speaker filter — hidden by default everywhere.
  const [showInternal, setShowInternal] = useState(false);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingMoreRef = useRef(false);

  const trimmedQuery = useMemo(() => query.trim(), [query]);
  const activeBucket = BUCKETS.find((b) => b.key === activeTab)!;
  const activeLensConfig = LENSES.find((lens) => lens.key === activeLens)!;

  // ── Internal-speaker derivations ──────────────────────────────────
  const internalSet = useMemo(
    () => new Set(internalSpeakerNames.map((n) => n.trim().toLowerCase())),
    [internalSpeakerNames]
  );
  const isInternal = useCallback(
    (record: EvidenceRecord) => {
      if (record.source_type === "internal_meeting") return true;
      const spk = record.segment_speaker?.trim().toLowerCase();
      return !!spk && internalSet.has(spk);
    },
    [internalSet]
  );
  const visibleRecords = useMemo(
    () => (showInternal ? records : records.filter((r) => !isInternal(r))),
    [records, showInternal, isInternal]
  );
  const hiddenInternalCount = useMemo(
    () => (showInternal ? 0 : records.filter((r) => isInternal(r)).length),
    [records, showInternal, isInternal]
  );

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
      current.size === visibleRecords.length ? new Set() : new Set(visibleRecords.map((r) => r.id))
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
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)]">
      <div className="flex flex-wrap gap-2 border-b border-[var(--line)] p-3 sm:p-4">
        {LENSES.map((lens) => {
          const active = lens.key === activeLens;
          return (
            <button
              key={lens.key}
              type="button"
              onClick={() => {
                setActiveLens(lens.key);
                setSelected(new Set());
                setError(null);
              }}
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "border-[var(--accent)]/50 bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "border-[var(--line)] text-[var(--ink-2)] hover:border-white/15 hover:text-[var(--ink)]"
              }`}
            >
              {lens.label}
            </button>
          );
        })}
      </div>

      {activeLens === "review" ? (
        <>
      {/* Theme filter banner — replaces tab bar when filtering by theme */}
      {themeFilter ? (
        <div className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="flex-shrink-0 text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
              {filterKind === "theme" ? "Theme" : "Topic"}
            </span>
            <span className="truncate rounded-full border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-2.5 py-0.5 text-xs font-medium text-[var(--accent)]">
              {themeFilter}
            </span>
            <span className="text-xs text-[var(--ink-2)]">
              · {initialRecords.length} record{initialRecords.length !== 1 ? "s" : ""}
            </span>
          </div>
          <Link
            href={`/projects/${projectId}/evidence`}
            className="flex-shrink-0 rounded-lg border border-[var(--line)] px-2.5 py-1 text-xs font-medium text-[var(--ink-2)] transition-colors hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
          >
            Clear ×
          </Link>
        </div>
      ) : (
        /* Normal tab bar */
        <div className="flex flex-wrap gap-2 border-b border-[var(--line)] p-3 sm:p-4">
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
                    : "border-[var(--line)] text-[var(--ink-2)] hover:border-white/15 hover:text-[var(--ink)]"
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
      )}

      <div className="border-b border-[var(--line)] p-4 sm:p-5">
        <p className="mb-3 text-sm text-[var(--ink-2)]">{activeBucket.blurb}</p>

        {showContextNudge && activeTab === "pending" && (
          <div className="mb-4 flex flex-col gap-3 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-[var(--ink-2)]">
              Add your research focus in settings so the AI can sort what matters automatically.
            </p>
            <div className="flex items-center gap-3">
              <Link
                href={`/projects/${projectId}/settings`}
                className="text-xs font-medium text-[var(--accent)] transition-colors hover:text-[var(--ink)]"
              >
                Open settings
              </Link>
              <button
                type="button"
                onClick={dismissContextNudge}
                className="text-xs font-medium text-[var(--ink-faint)] transition-colors hover:text-[var(--ink-2)]"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Search / filter row — toggle visible in both normal and theme-filter modes */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)]"
            placeholder={`Search ${activeBucket.label.toLowerCase()}`}
          />
          {internalSpeakerNames.length > 0 && (
            <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-xs font-medium text-[var(--ink-2)]">
              <input
                type="checkbox"
                checked={showInternal}
                onChange={() => setShowInternal((v) => !v)}
                className="h-4 w-4 cursor-pointer accent-[var(--accent)]"
              />
              Show internal
            </label>
          )}
          {visibleRecords.length > 0 && (
            <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-xs font-medium text-[var(--ink-2)]">
              <input
                type="checkbox"
                checked={selected.size === visibleRecords.length && visibleRecords.length > 0}
                onChange={toggleAll}
                className="h-4 w-4 cursor-pointer accent-[var(--accent)]"
              />
              Select all
            </label>
          )}
        </div>

        <div className="mt-3 text-xs text-[var(--ink-2)]">
          {isSearching || isLoadingTab
            ? "Loading..."
            : trimmedQuery
            ? `${visibleRecords.length} match${visibleRecords.length === 1 ? "" : "es"} in ${activeBucket.label.toLowerCase()}${hiddenInternalCount > 0 ? ` · ${hiddenInternalCount} internal hidden` : ""}`
            : `Showing ${visibleRecords.length} of ${counts[activeTab]}${hiddenInternalCount > 0 ? ` · ${hiddenInternalCount} internal hidden` : ""}`}
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="sticky top-14 z-10 flex flex-wrap items-center gap-3 border-b border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 sm:px-5">
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
            className="text-xs font-medium text-[var(--ink-faint)] transition-colors hover:text-[var(--ink-2)]"
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

      {visibleRecords.length === 0 ? (
        <div className="p-12 text-center">
          <div className="text-sm font-medium text-[var(--ink)]">
            {trimmedQuery
              ? "No matches in this bucket."
              : hiddenInternalCount > 0
              ? "All visible records are hidden"
              : activeTab === "pending"
              ? "Nothing left to review"
              : activeTab === "trusted"
              ? "No trusted evidence yet"
              : "Nothing excluded"}
          </div>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--ink-2)]">
            {trimmedQuery
              ? "Try a broader search or clear the search field."
              : hiddenInternalCount > 0
              ? `${hiddenInternalCount} internal-speaker record${hiddenInternalCount === 1 ? " is" : "s are"} hidden. Toggle "Show internal" to see them.`
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
            {visibleRecords.map((record) => (
              <EvidenceRow
                key={record.id}
                projectId={projectId}
                record={record}
                selected={selected.has(record.id)}
                onToggle={() => toggleOne(record.id)}
                onQuickMove={(target) => moveRecords([record.id], target)}
                busy={isMutating}
                isInternal={isInternal(record)}
              />
            ))}
          </div>
          {!trimmedQuery && hasMore && (
            <div
              ref={sentinelRef}
              className="border-t border-[var(--line)] p-5 text-center text-sm text-[var(--ink-2)]"
            >
              {isLoadingMore ? "Loading more…" : (
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  className="rounded-lg border border-[var(--line)] px-4 py-2 text-sm font-medium text-[var(--ink)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                >
                  Load more
                </button>
              )}
            </div>
          )}
        </>
      )}
        </>
      ) : (
        <>
          <div className="border-b border-[var(--line)] p-4 sm:p-5">
            <p className="text-sm leading-6 text-[var(--ink-2)]">{activeLensConfig.blurb}</p>
          </div>
          {activeLens === "topics" && <TopicLens projectId={projectId} items={lensData.topics} />}
          {activeLens === "themes" && <ThemeLens projectId={projectId} items={lensData.themes} />}
          {activeLens === "problems" && (
            <ProblemLens projectId={projectId} items={lensData.problems} />
          )}
          {activeLens === "sources" && <SourceLens projectId={projectId} items={lensData.sources} />}
        </>
      )}
    </div>
  );
}
