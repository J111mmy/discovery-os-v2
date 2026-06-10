"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { updateProblemStatusAction } from "./actions";

export type ProblemStatus = "surfaced" | "acknowledged" | "active" | "resolved" | "dismissed";
export type ProblemSeverity = "high" | "medium" | "low";
export type AnchorMethod = "exact" | "normalised" | "fuzzy" | "speaker" | "fallback_first_segment";

export type ProblemRow = {
  id: string;
  title: string;
  description: string | null;
  severity: ProblemSeverity;
  status: ProblemStatus;
  source_theme_ids: string[];
  source_evidence_ids: string[];
  created_at: string;
};

export type ProblemDetail = {
  problem: ProblemRow;
  themes: Array<{
    id: string;
    label: string;
    description: string | null;
    evidence_count: number;
  }>;
  evidence: Array<{
    id: string;
    source_id: string;
    segment_id: string | null;
    content: string;
    summary: string | null;
    trust_scope: string;
    classification: string | null;
    sentiment: string | null;
    topics: string[];
    source_title: string | null;
    source_type: string | null;
    segment_speaker: string | null;
    segment_index: number | null;
    anchor_method: string | null;
    created_at: string;
  }>;
  entities: Array<{
    evidence_id: string;
    entity_type: string;
    label: string;
    relationship: string | null;
  }>;
  unavailable_evidence_count: number;
  related_evidence_label: string;
};

interface ProblemsListProps {
  problems: ProblemRow[];
  projectId: string;
  selectedProblemId?: string | null;
  selectedProblemDetail?: ProblemDetail | null;
  selectedProblemError?: string | null;
}

const statusLabels: Record<ProblemStatus, string> = {
  surfaced: "Surfaced",
  acknowledged: "Acknowledged",
  active: "Active",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

const severityLabels: Record<ProblemSeverity, string> = {
  high: "High priority",
  medium: "Medium priority",
  low: "Low priority",
};

const sourceTypeLabels: Record<string, string> = {
  transcript: "Transcript",
  document: "Document",
  note: "Note",
  survey: "Survey",
  support_ticket: "Support ticket",
  customer_interview: "Customer interview",
  sales_call: "Sales call",
  usability_study: "Usability study",
  internal_meeting: "Internal meeting",
  other: "Other",
};

const transitions: Record<ProblemStatus, Array<{ status: ProblemStatus; label: string }>> = {
  surfaced: [
    { status: "acknowledged", label: "Acknowledge" },
    { status: "dismissed", label: "Dismiss" },
  ],
  acknowledged: [
    { status: "active", label: "Mark active" },
    { status: "dismissed", label: "Dismiss" },
  ],
  active: [{ status: "resolved", label: "Resolve" }],
  resolved: [],
  dismissed: [],
};

function severityRank(severity: ProblemSeverity) {
  return severity === "high" ? 0 : severity === "medium" ? 1 : 2;
}

function sortProblems(problems: ProblemRow[]) {
  return [...problems].sort((a, b) => {
    const severityDelta = severityRank(a.severity) - severityRank(b.severity);
    if (severityDelta !== 0) return severityDelta;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

function formatRelativeDate(value: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Recently";
  const diffMs = Date.now() - timestamp;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 60) return minutes <= 1 ? "just now" : `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function sourceTypeLabel(type: string | null) {
  if (!type) return null;
  return sourceTypeLabels[type] ?? type.replace(/_/g, " ");
}

function uniqueLabels(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function isConfidentAnchor(anchorMethod: string | null) {
  return anchorMethod === "exact" || anchorMethod === "normalised";
}

function trustLabel(scope: string) {
  if (scope === "trusted") return "Trusted";
  if (scope === "excluded") return "Excluded";
  if (scope === "disputed") return "Disputed";
  return "Pending";
}

function SeverityPill({ severity }: { severity: ProblemSeverity }) {
  const classes =
    severity === "high"
      ? "border-neg/20 bg-neg-bg text-neg"
      : severity === "medium"
      ? "border-warn/20 bg-warn-bg text-warn"
      : "border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink-2)]";

  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${classes}`}>
      {severityLabels[severity]}
    </span>
  );
}

function StatusPill({ status }: { status: ProblemStatus }) {
  return (
    <span className="rounded-full border border-[var(--line)] bg-[var(--bg)] px-2 py-0.5 text-xs font-medium text-[var(--ink-2)]">
      {statusLabels[status]}
    </span>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-2 py-0.5 text-xs font-medium text-[var(--ink-2)]">
      {children}
    </span>
  );
}

function SkeletonBlock({ className = "" }: { className?: string }) {
  return (
    <div
      className={`motion-safe:animate-pulse rounded-md bg-[var(--surface-2)] ${className}`}
      aria-hidden
    />
  );
}

function DrawerHeaderSkeleton() {
  return (
    <div className="grid gap-3" aria-hidden>
      <SkeletonBlock className="h-5 w-3/4" />
      <SkeletonBlock className="h-3 w-1/3" />
    </div>
  );
}

function DrawerBodySkeleton() {
  return (
    <div className="grid gap-6 p-5" aria-hidden>
      <p className="text-sm text-[var(--ink-2)]">Loading problem details…</p>
      {[0, 1, 2, 3].map((section) => (
        <div key={section} className="grid gap-2">
          <SkeletonBlock className="h-3 w-32" />
          <SkeletonBlock className="h-16 w-full" />
        </div>
      ))}
    </div>
  );
}

function PlaceholderRow({ label }: { label: string }) {
  return (
    <div className="grid gap-1 border-t border-[var(--line)] py-3 first:border-t-0">
      <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--ink-faint)]">
        {label}
      </div>
      <div className="text-sm italic text-[var(--ink-2)]">
        Structured breakdown not yet available - see description above.
      </div>
    </div>
  );
}

function OutputSlot({ label, copy }: { label: string; copy: string }) {
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3">
      <button
        type="button"
        aria-disabled="true"
        onClick={(event) => event.preventDefault()}
        className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm font-medium text-[var(--ink-faint)]"
      >
        + {label}
      </button>
      <p className="mt-2 text-xs leading-5 text-[var(--ink-2)]">{copy}</p>
    </div>
  );
}

function EvidenceLink({
  projectId,
  evidence,
}: {
  projectId: string;
  evidence: ProblemDetail["evidence"][number];
}) {
  if (!evidence.segment_id) {
    return <span className="text-xs text-[var(--ink-faint)]">Source location unavailable</span>;
  }

  const confident = isConfidentAnchor(evidence.anchor_method);
  return (
    <Link
      href={`/projects/${projectId}/sources/${evidence.source_id}#segment-${evidence.segment_id}`}
      className={`text-xs font-medium transition-colors hover:text-[var(--accent)] ${
        confident ? "text-[var(--accent)]" : "text-[var(--ink-2)]"
      }`}
      title={
        confident
          ? "This evidence was matched to a precise source segment."
          : "We're not fully certain where this was said - showing the closest match."
      }
    >
      {confident ? "Open in source" : "Approximate location in source"}
    </Link>
  );
}

function ProblemEvidenceList({ detail, projectId }: { detail: ProblemDetail; projectId: string }) {
  const [showAll, setShowAll] = useState(false);
  const rows = showAll ? detail.evidence : detail.evidence.slice(0, 5);

  if (detail.evidence.length === 0) {
    return (
      <p className="text-sm text-[var(--ink-2)]">
        {detail.unavailable_evidence_count > 0
          ? "This problem has evidence links, but some records are unavailable."
          : "No related evidence yet."}
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {detail.unavailable_evidence_count > 0 && (
        <p className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--ink-2)]">
          This problem has evidence links, but some records are unavailable.
        </p>
      )}
      {rows.map((evidence) => (
        <article key={evidence.id} className="rounded-lg border border-[var(--line)] bg-[var(--bg)] p-3">
          {evidence.summary && (
            <div className="mb-1 text-sm font-medium text-[var(--ink)]">{evidence.summary}</div>
          )}
          <p className="line-clamp-3 text-sm leading-6 text-[var(--ink)]">{evidence.content}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {evidence.topics.slice(0, 3).map((topic) => (
              <Chip key={topic}>{topic}</Chip>
            ))}
            <span className="rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-2 py-0.5 text-xs font-medium text-[var(--ink-2)]">
              {trustLabel(evidence.trust_scope)}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--ink-2)]">
            {evidence.source_type && <span>{sourceTypeLabel(evidence.source_type)}</span>}
            {evidence.segment_speaker && (
              <>
                <span className="text-[var(--ink-faint)]">/</span>
                <span>{evidence.segment_speaker}</span>
              </>
            )}
            <span className="flex-1" />
            <EvidenceLink projectId={projectId} evidence={evidence} />
          </div>
        </article>
      ))}
      {detail.evidence.length > 5 && (
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          className="w-fit rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-medium text-[var(--ink-2)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
        >
          {showAll ? "Show fewer" : `Show all ${detail.evidence.length} related evidence`}
        </button>
      )}
    </div>
  );
}

function ProblemDetailDrawer({
  loading,
  detail,
  error,
  projectId,
  onClose,
}: {
  loading: boolean;
  detail: ProblemDetail | null;
  error: string | null;
  projectId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const problem = detail?.problem;
  const availableTransitions = problem ? transitions[problem.status] : [];
  const sourceTypes = uniqueLabels((detail?.evidence ?? []).map((row) => sourceTypeLabel(row.source_type)));
  const people = uniqueLabels(
    (detail?.entities ?? [])
      .filter((entity) => entity.entity_type === "person" || entity.entity_type === "people")
      .map((entity) => entity.label)
  );
  const companies = uniqueLabels(
    (detail?.entities ?? [])
      .filter((entity) => entity.entity_type === "company")
      .map((entity) => entity.label)
  );
  const competitors = uniqueLabels(
    (detail?.entities ?? [])
      .filter((entity) => entity.entity_type === "competitor")
      .map((entity) => entity.label)
  );
  const topics = uniqueLabels((detail?.evidence ?? []).flatMap((row) => row.topics));
  const latestEvidenceAt = detail?.evidence
    .map((row) => new Date(row.created_at).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];
  const caveats = useMemo(() => {
    if (!detail) return [];
    const items: string[] = [];
    if (detail.evidence.length < 3) items.push("This problem currently has limited related evidence.");
    const reviewed = detail.evidence.filter((row) => row.trust_scope === "trusted").length;
    if (detail.evidence.length > 0 && reviewed < detail.evidence.length / 2) {
      items.push("Most related evidence hasn't been reviewed yet.");
    }
    if (latestEvidenceAt && Date.now() - latestEvidenceAt > 30 * 24 * 60 * 60 * 1000) {
      items.push("Most related evidence is from over a month ago.");
    }
    return items;
  }, [detail, latestEvidenceAt]);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key !== "Tab" || !drawerRef.current) return;
      const focusable = Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function updateStatus(nextStatus: ProblemStatus) {
    if (!problem) return;
    const formData = new FormData();
    formData.set("project_id", projectId);
    formData.set("problem_id", problem.id);
    formData.set("status", nextStatus);

    startTransition(async () => {
      await updateProblemStatusAction(formData);
      router.refresh();
    });
  }

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden
        className="fixed inset-0 z-40 bg-black/30"
      />
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="problem-drawer-title"
        className="fixed bottom-0 right-0 top-0 z-50 flex w-full flex-col overflow-y-auto border-l border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-lg)] sm:w-[min(560px,95vw)]"
        style={{ animation: "slideL .24s var(--ease)" }}
      >
        <div className="border-b border-[var(--line)] p-5">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {problem && <StatusPill status={problem.status} />}
              {problem && <SeverityPill severity={problem.severity} />}
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              className="min-h-11 min-w-11 rounded-lg text-xl text-[var(--ink-2)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
              aria-label="Close problem detail"
            >
              x
            </button>
          </div>

          {loading ? (
            <DrawerHeaderSkeleton />
          ) : error || !detail || !problem ? (
            <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-4 text-sm text-[var(--ink-2)]">
              {error ?? "We could not load this problem. Try again."}
            </div>
          ) : (
            <>
              <h2 id="problem-drawer-title" className="text-lg font-semibold leading-7 text-[var(--ink)]">
                {problem.title}
              </h2>
              <p className="mt-2 text-xs text-[var(--ink-faint)]">
                Updated {formatRelativeDate(problem.created_at)} · {detail.related_evidence_label}
              </p>
              {availableTransitions.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {availableTransitions.map((transition) => (
                    <button
                      key={transition.status}
                      type="button"
                      disabled={isPending}
                      onClick={() => updateStatus(transition.status)}
                      className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--ink)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {transition.label}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {loading && <DrawerBodySkeleton />}

        {!loading && detail && problem && !error && (
          <div className="grid gap-6 p-5">
            <section>
              <h3 className="mb-3 text-sm font-semibold text-[var(--ink)]">Problem statement</h3>
              <p className="text-sm leading-6 text-[var(--ink-2)]">
                {problem.description || "This problem doesn't have a description yet."}
              </p>
              <div className="mt-4 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-4">
                <PlaceholderRow label="Who's affected" />
                <PlaceholderRow label="What's hard" />
                <PlaceholderRow label="Why it matters" />
              </div>
            </section>

            <section>
              <h3 className="mb-3 text-sm font-semibold text-[var(--ink)]">Affected context</h3>
              {sourceTypes.length === 0 &&
              people.length === 0 &&
              companies.length === 0 &&
              competitors.length === 0 ? (
                <p className="text-sm text-[var(--ink-2)]">No affected-context details available yet.</p>
              ) : (
                <div className="grid gap-3">
                  {sourceTypes.length > 0 && (
                    <div>
                      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--ink-faint)]">
                        Source types
                      </div>
                      <div className="flex flex-wrap gap-2">{sourceTypes.map((type) => <Chip key={type}>{type}</Chip>)}</div>
                    </div>
                  )}
                  {people.length > 0 && (
                    <div>
                      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--ink-faint)]">
                        People
                      </div>
                      <div className="flex flex-wrap gap-2">{people.map((person) => <Chip key={person}>{person}</Chip>)}</div>
                    </div>
                  )}
                  {companies.length > 0 && (
                    <div>
                      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--ink-faint)]">
                        Companies
                      </div>
                      <div className="flex flex-wrap gap-2">{companies.map((company) => <Chip key={company}>{company}</Chip>)}</div>
                    </div>
                  )}
                  {competitors.length > 0 && (
                    <div>
                      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--ink-faint)]">
                        Competitors mentioned
                      </div>
                      <div className="flex flex-wrap gap-2">{competitors.map((competitor) => <Chip key={competitor}>{competitor}</Chip>)}</div>
                    </div>
                  )}
                </div>
              )}
            </section>

            <section>
              <div className="mb-3 flex items-center gap-2">
                <h3 className="text-sm font-semibold text-[var(--ink)]">Related evidence (via themes)</h3>
                <span
                  className="rounded-full border border-[var(--line)] px-1.5 text-[11px] text-[var(--ink-2)]"
                  title="Evidence linked through this problem's themes. Not yet individually reviewed against this specific problem."
                >
                  i
                </span>
              </div>
              <ProblemEvidenceList detail={detail} projectId={projectId} />
            </section>

            <section>
              <h3 className="mb-3 text-sm font-semibold text-[var(--ink)]">Themes and topics</h3>
              {detail.themes.length === 0 ? (
                <p className="text-sm text-[var(--ink-2)]">No themes linked yet.</p>
              ) : (
                <div className="grid gap-2">
                  {detail.themes.map((theme, index) => (
                    <div key={theme.id} className="rounded-lg border border-[var(--line)] bg-[var(--bg)] p-3">
                      <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--ink-faint)]">
                        {index === 0 ? "Primary theme" : "Contributing theme"}
                      </div>
                      <div className="mt-1 text-sm font-medium text-[var(--ink)]">{theme.label}</div>
                      {theme.description && (
                        <p className="mt-1 text-xs leading-5 text-[var(--ink-2)]">{theme.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {topics.length > 0 && (
                <div className="mt-3">
                  <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--ink-faint)]">
                    Provenance topics
                  </div>
                  <div className="flex flex-wrap gap-2">{topics.map((topic) => <Chip key={topic}>{topic}</Chip>)}</div>
                </div>
              )}
            </section>

            <section>
              <h3 className="mb-3 text-sm font-semibold text-[var(--ink)]">Outputs</h3>
              <div className="grid gap-3 sm:grid-cols-3">
                <OutputSlot label="Opportunity" copy="Opportunity creation needs a backend update. Coming soon." />
                <OutputSlot label="Action" copy="Action creation needs a backend update. Coming soon." />
                <OutputSlot label="Artifact" copy="Drafting from this problem needs a backend update. Coming soon." />
              </div>
            </section>

            <section>
              <h3 className="mb-3 text-sm font-semibold text-[var(--ink)]">Gaps and caveats</h3>
              {caveats.length === 0 ? (
                <p className="text-sm text-[var(--ink-2)]">No gaps flagged.</p>
              ) : (
                <div className="grid gap-2">
                  {caveats.map((caveat) => (
                    <p key={caveat} className="rounded-lg border border-warn/20 bg-warn-bg px-3 py-2 text-xs leading-5 text-[var(--ink-2)]">
                      {caveat}
                    </p>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </>
  );
}

function ProblemCard({
  problem,
  isPending,
  onOpen,
}: {
  problem: ProblemRow;
  isPending: boolean;
  onOpen: (id: string) => void;
}) {
  function openProblem() {
    onOpen(problem.id);
  }

  return (
    <article
      role="button"
      tabIndex={0}
      aria-busy={isPending}
      onClick={openProblem}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openProblem();
        }
      }}
      className={`cursor-pointer rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 transition-colors hover:border-[var(--accent)]/40 ${
        isPending ? "opacity-60" : ""
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <StatusPill status={problem.status} />
          </div>
          <h2 className="text-base font-semibold leading-6 text-[var(--ink)]">{problem.title}</h2>
        </div>
        <SeverityPill severity={problem.severity} />
      </div>

      {problem.description && (
        <p className="text-sm leading-6 text-[var(--ink-2)]">{problem.description}</p>
      )}

      <div className="mt-4 flex flex-wrap gap-2 text-xs text-[var(--ink-2)]">
        <span>{problem.source_theme_ids.length} themes</span>
        <span className="text-[var(--ink-faint)]">·</span>
        <span>{problem.source_evidence_ids.length} evidence records</span>
      </div>
    </article>
  );
}

function ProblemGroup({
  title,
  problems,
  pendingId,
  onOpen,
}: {
  title: string;
  problems: ProblemRow[];
  pendingId: string | null;
  onOpen: (id: string) => void;
}) {
  if (problems.length === 0) return null;

  return (
    <section className="grid gap-3">
      <div className="text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
        {title} · {problems.length}
      </div>
      {sortProblems(problems).map((problem) => (
        <ProblemCard
          key={problem.id}
          problem={problem}
          isPending={pendingId === problem.id}
          onOpen={onOpen}
        />
      ))}
    </section>
  );
}

export function ProblemsList({
  problems,
  projectId,
  selectedProblemId,
  selectedProblemDetail,
  selectedProblemError,
}: ProblemsListProps) {
  const [showClosed, setShowClosed] = useState(false);
  const [pendingProblemId, setPendingProblemId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  // Clear the pending marker once the server-rendered drawer catches up to the
  // navigation we kicked off (or once it's no longer the open problem).
  useEffect(() => {
    if (pendingProblemId && pendingProblemId === selectedProblemId) {
      setPendingProblemId(null);
    }
  }, [pendingProblemId, selectedProblemId]);

  function openProblem(id: string) {
    setPendingProblemId(id);
    startTransition(() => {
      router.push(`/projects/${projectId}/problems?problem=${id}`, { scroll: false });
    });
  }

  function closeProblem() {
    setPendingProblemId(null);
    router.replace(`/projects/${projectId}/problems`, { scroll: false });
  }

  const surfaced = problems.filter((problem) => problem.status === "surfaced");
  const acknowledged = problems.filter((problem) => problem.status === "acknowledged");
  const active = problems.filter((problem) => problem.status === "active");
  const closed = problems.filter(
    (problem) => problem.status === "resolved" || problem.status === "dismissed"
  );

  if (problems.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-12 text-center text-sm text-[var(--ink-2)]">
        No problems have been surfaced yet.
      </div>
    );
  }

  // Show the drawer once a navigation is in flight (skeleton) or once the
  // server has resolved a selected problem (real content / error).
  const isLoadingSelection = Boolean(pendingProblemId) && pendingProblemId !== selectedProblemId;
  const showDrawer = Boolean(selectedProblemId) || Boolean(pendingProblemId);

  return (
    <div className="grid gap-8">
      <ProblemGroup title="Surfaced" problems={surfaced} pendingId={pendingProblemId} onOpen={openProblem} />
      <ProblemGroup title="Acknowledged" problems={acknowledged} pendingId={pendingProblemId} onOpen={openProblem} />
      <ProblemGroup title="Active" problems={active} pendingId={pendingProblemId} onOpen={openProblem} />

      {closed.length > 0 && (
        <section className="grid gap-3">
          <button
            type="button"
            onClick={() => setShowClosed((value) => !value)}
            className="w-fit rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-medium text-[var(--ink-2)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            {showClosed ? "Hide" : "Show"} resolved / dismissed ({closed.length})
          </button>

          {showClosed && (
            <ProblemGroup title="Resolved / dismissed" problems={closed} pendingId={pendingProblemId} onOpen={openProblem} />
          )}
        </section>
      )}

      {showDrawer && (
        <ProblemDetailDrawer
          loading={isLoadingSelection}
          detail={selectedProblemDetail ?? null}
          error={selectedProblemError ?? null}
          projectId={projectId}
          onClose={closeProblem}
        />
      )}
    </div>
  );
}
