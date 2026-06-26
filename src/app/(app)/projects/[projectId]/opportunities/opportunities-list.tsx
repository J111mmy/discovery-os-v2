"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { runProjectOpportunitiesAction } from "../actions";
import { isConfidentAnchor, ReviewStateBadge, type ReviewState } from "../shared-evidence";
import {
  SeverityPill,
  StatusPill as ProblemStatusPill,
  type ProblemSeverity,
  type ProblemStatus,
} from "../problems/problems-list";

type OpportunityStatus = "suggested" | "accepted" | "active" | "dismissed" | "archived";
type OpportunityConfidence = "low" | "medium" | "high";
type LinkRelationship = "source" | "supporting" | "created_from" | "cites" | "addresses";

const problemSeverities = new Set<ProblemSeverity>(["high", "medium", "low"]);
const problemStatuses = new Set<ProblemStatus>(["surfaced", "acknowledged", "active", "resolved", "dismissed"]);

function isProblemSeverity(value: string | null): value is ProblemSeverity {
  return value !== null && problemSeverities.has(value as ProblemSeverity);
}

function isProblemStatus(value: string | null): value is ProblemStatus {
  return value !== null && problemStatuses.has(value as ProblemStatus);
}

type LinkedProblem = {
  id: string;
  title: string;
  status: string | null;
  severity: string | null;
};

type ProblemLink = {
  problem_id: string;
  relationship: LinkRelationship;
  rationale: string | null;
  problem: LinkedProblem | null;
};

type LinkedEvidence = {
  id: string;
  source_id: string;
  segment_id: string | null;
  content: string;
  summary: string | null;
  source_title: string | null;
  source_type: string | null;
  segment_speaker: string | null;
  anchor_method: string | null;
};

type EvidenceLink = {
  evidence_id: string;
  relationship: LinkRelationship;
  rationale: string | null;
  evidence: LinkedEvidence | null;
};

type LinkedTheme = {
  id: string;
  label: string;
  central_concept: string | null;
  description: string | null;
};

type ThemeLink = {
  theme_id: string;
  relationship: LinkRelationship;
  rationale: string | null;
  theme: LinkedTheme | null;
};

type OpportunityRow = {
  id: string;
  title: string;
  description: string | null;
  how_might_we: string | null;
  status: OpportunityStatus;
  confidence: OpportunityConfidence;
  review_state: ReviewState;
  link_counts: { problems: number; evidence: number; themes: number };
  problem_links: ProblemLink[];
  evidence_links: EvidenceLink[];
  theme_links: ThemeLink[];
};

interface OpportunitiesListProps {
  projectId: string;
}

const statusLabels: Record<OpportunityStatus, string> = {
  suggested: "Suggested",
  accepted: "Accepted",
  active: "Active",
  dismissed: "Dismissed",
  archived: "Archived",
};

const statusClasses: Record<OpportunityStatus, string> = {
  suggested: "border-warn/20 bg-warn-bg text-warn",
  accepted: "border-info/25 bg-info-bg text-info",
  active: "border-pos/25 bg-pos-bg text-pos",
  dismissed: "border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink-faint)]",
  archived: "border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink-faint)]",
};

const confidenceLabels: Record<OpportunityConfidence, string> = {
  low: "Low confidence",
  medium: "Medium confidence",
  high: "High confidence",
};

const confidenceClasses: Record<OpportunityConfidence, string> = {
  low: "border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink-2)]",
  medium: "border-warn/20 bg-warn-bg text-warn",
  high: "border-pos/25 bg-pos-bg text-pos",
};

const relationshipLabels: Record<LinkRelationship, string> = {
  source: "Source",
  supporting: "Supports",
  created_from: "Created from",
  cites: "Cites",
  addresses: "Addresses",
};

function StatusPill({ status }: { status: OpportunityStatus }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusClasses[status]}`}>
      {statusLabels[status]}
    </span>
  );
}

function ConfidencePill({ confidence }: { confidence: OpportunityConfidence }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${confidenceClasses[confidence]}`}>
      {confidenceLabels[confidence]}
    </span>
  );
}

function RelationshipChip({ relationship }: { relationship: LinkRelationship }) {
  return (
    <span className="rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-[var(--ink-faint)]">
      {relationshipLabels[relationship]}
    </span>
  );
}

function EvidenceSourceLink({ projectId, evidence }: { projectId: string; evidence: LinkedEvidence }) {
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
    >
      {confident ? "Open in source" : "Approximate location in source"}
    </Link>
  );
}

function ProblemLinkRow({ projectId, link }: { projectId: string; link: ProblemLink }) {
  if (!link.problem) return null;

  return (
    <Link
      href={`/projects/${projectId}/problems?problem=${link.problem.id}`}
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--line)] bg-[var(--bg)] p-3 transition-colors hover:border-[var(--accent)]/40"
    >
      <div className="min-w-0">
        <RelationshipChip relationship={link.relationship} />
        <div className="mt-1 text-sm font-medium text-[var(--ink)]">{link.problem.title}</div>
        {link.rationale && (
          <p className="mt-1 text-xs italic leading-5 text-[var(--ink-2)]">Why linked: {link.rationale}</p>
        )}
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">
        {isProblemStatus(link.problem.status) && <ProblemStatusPill status={link.problem.status} />}
        {isProblemSeverity(link.problem.severity) && <SeverityPill severity={link.problem.severity} />}
      </div>
    </Link>
  );
}

function EvidenceLinkRow({ projectId, link }: { projectId: string; link: EvidenceLink }) {
  if (!link.evidence) return null;
  const evidence = link.evidence;

  return (
    <article className="rounded-lg border border-[var(--line)] bg-[var(--bg)] p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <RelationshipChip relationship={link.relationship} />
      </div>
      {link.rationale && (
        <p className="mb-2 text-xs italic leading-5 text-[var(--ink-2)]">Why linked: {link.rationale}</p>
      )}
      {evidence.summary && (
        <div className="mb-1 text-sm font-medium text-[var(--ink)]">{evidence.summary}</div>
      )}
      <p className="line-clamp-3 text-sm leading-6 text-[var(--ink)]">{evidence.content}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--ink-2)]">
        {evidence.source_type && <span>{evidence.source_type.replace(/_/g, " ")}</span>}
        {evidence.segment_speaker && (
          <>
            <span className="text-[var(--ink-faint)]">/</span>
            <span>{evidence.segment_speaker}</span>
          </>
        )}
        <span className="flex-1" />
        <EvidenceSourceLink projectId={projectId} evidence={evidence} />
      </div>
    </article>
  );
}

function ThemeLinkRow({ projectId, link }: { projectId: string; link: ThemeLink }) {
  if (!link.theme) return null;
  const preview = link.theme.central_concept || link.theme.description;

  return (
    <Link
      href={`/projects/${projectId}/themes/${link.theme.id}`}
      className="flex flex-col gap-1 rounded-lg border border-[var(--line)] bg-[var(--bg)] p-3 transition-colors hover:border-[var(--accent)]/40"
    >
      <RelationshipChip relationship={link.relationship} />
      <div className="text-sm font-medium text-[var(--ink)]">{link.theme.label}</div>
      {preview && <p className="line-clamp-2 text-xs leading-5 text-[var(--ink-2)]">{preview}</p>}
    </Link>
  );
}

function OpportunityCard({ projectId, opportunity }: { projectId: string; opportunity: OpportunityRow }) {
  return (
    <article className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <StatusPill status={opportunity.status} />
        <ConfidencePill confidence={opportunity.confidence} />
        <ReviewStateBadge reviewState={opportunity.review_state} />
      </div>

      <h2 className="mb-1 text-base font-semibold leading-6 text-[var(--ink)]">
        {opportunity.how_might_we || opportunity.title}
      </h2>
      {opportunity.how_might_we && (
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
          {opportunity.title}
        </p>
      )}
      {opportunity.description && (
        <p className="mb-4 text-sm leading-6 text-[var(--ink-2)]">{opportunity.description}</p>
      )}

      <div className="grid gap-5">
        {opportunity.problem_links.length > 0 && (
          <div className="grid gap-2">
            <h3 className="text-[11px] font-medium uppercase tracking-wide text-[var(--ink-faint)]">
              Problems addressed ({opportunity.link_counts.problems})
            </h3>
            <div className="grid gap-2">
              {opportunity.problem_links.map((link) => (
                <ProblemLinkRow key={`${link.problem_id}:${link.relationship}`} projectId={projectId} link={link} />
              ))}
            </div>
          </div>
        )}

        {opportunity.evidence_links.length > 0 && (
          <div className="grid gap-2">
            <h3 className="text-[11px] font-medium uppercase tracking-wide text-[var(--ink-faint)]">
              Supporting evidence ({opportunity.link_counts.evidence})
            </h3>
            <div className="grid gap-3">
              {opportunity.evidence_links.map((link) => (
                <EvidenceLinkRow key={`${link.evidence_id}:${link.relationship}`} projectId={projectId} link={link} />
              ))}
            </div>
          </div>
        )}

        {opportunity.theme_links.length > 0 && (
          <div className="grid gap-2">
            <h3 className="text-[11px] font-medium uppercase tracking-wide text-[var(--ink-faint)]">
              Related themes ({opportunity.link_counts.themes})
            </h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {opportunity.theme_links.map((link) => (
                <ThemeLinkRow key={`${link.theme_id}:${link.relationship}`} projectId={projectId} link={link} />
              ))}
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

function GenerateConfirmDialog({
  projectId,
  onCancel,
  onSubmitStart,
}: {
  projectId: string;
  onCancel: () => void;
  onSubmitStart: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Generate product opportunities"
      onClick={onCancel}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 px-5 py-[8vh] backdrop-blur-sm"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-2xl shadow-black/40"
      >
        <h2 className="text-base font-semibold text-[var(--ink)]">Generate product opportunities?</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--ink-2)]">
          This runs an AI analysis over your current problems, themes, and evidence to surface new
          solution directions. It can take a minute or two and uses your project&apos;s AI usage
          budget. You can run it again later as more evidence comes in.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-[var(--line)] px-3.5 py-2 text-sm font-medium text-[var(--ink-2)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            Cancel
          </button>
          <form action={runProjectOpportunitiesAction} onSubmit={onSubmitStart}>
            <input type="hidden" name="project_id" value={projectId} />
            <button
              type="submit"
              className="rounded-lg bg-[var(--accent)] px-3.5 py-2 text-sm font-semibold text-white"
            >
              Generate
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function GenerateButton({
  variant,
  onClick,
}: {
  variant: "bar" | "empty-state";
  onClick: () => void;
}) {
  if (variant === "empty-state") {
    return (
      <button
        type="button"
        onClick={onClick}
        className="rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white"
      >
        Generate product opportunities
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-shrink-0 rounded-lg border border-[var(--accent)] px-3.5 py-2 text-xs font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-white"
    >
      Generate product opportunities
    </button>
  );
}

function GeneratingBadge() {
  return (
    <div className="flex-shrink-0 rounded-lg border border-warn/20 bg-warn-bg px-3 py-1.5 text-xs font-medium text-warn">
      Generating opportunities…
    </div>
  );
}

const GENERATE_POLL_INTERVAL_MS = 4000;
// Generation runs a premium-tier LLM call with its own ~4 minute internal
// timeout; give the poll a bit of headroom before giving up on watching it.
const GENERATE_MAX_POLLS = 60;

export function OpportunitiesList({ projectId }: OpportunitiesListProps) {
  const [opportunities, setOpportunities] = useState<OpportunityRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const baselineIdsRef = useRef<Set<string>>(new Set());
  const pollCountRef = useRef(0);

  const loadOpportunities = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/opportunities`);
      if (!response.ok) {
        setError("We could not load opportunities. Try again.");
        return null;
      }
      const data = await response.json();
      setError(null);
      const rows: OpportunityRow[] = data.opportunities ?? [];
      setOpportunities(rows);
      return rows;
    } catch {
      setError("We could not load opportunities. Try again.");
      return null;
    }
  }, [projectId]);

  useEffect(() => {
    void loadOpportunities();
  }, [loadOpportunities]);

  // There's no run-status field on the read endpoint yet, so completion is
  // detected by polling and watching for opportunity rows that weren't there
  // when generation was triggered. A run that turns up nothing new (e.g. not
  // enough evidence yet) still needs to clear the pending state eventually,
  // hence the poll cap.
  useEffect(() => {
    if (!generating) return;
    let cancelled = false;

    async function poll() {
      const rows = await loadOpportunities();
      if (cancelled) return;

      const hasNewRows = (rows ?? []).some((row) => !baselineIdsRef.current.has(row.id));
      if (hasNewRows) {
        setGenerating(false);
        return;
      }

      pollCountRef.current += 1;
      if (pollCountRef.current >= GENERATE_MAX_POLLS) {
        setGenerating(false);
        setTriggerError("This is taking longer than expected. Check back in a bit, or try again.");
        return;
      }

      timeoutId = setTimeout(poll, GENERATE_POLL_INTERVAL_MS);
    }

    let timeoutId = setTimeout(poll, GENERATE_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [generating, loadOpportunities]);

  function handleSubmitStart() {
    baselineIdsRef.current = new Set((opportunities ?? []).map((row) => row.id));
    pollCountRef.current = 0;
    setTriggerError(null);
    setConfirmOpen(false);
    setGenerating(true);
  }

  if (error) {
    return (
      <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-12 text-center text-sm text-[var(--ink-2)]">
        {error}
      </div>
    );
  }

  if (opportunities === null) {
    return (
      <div className="grid gap-3">
        {[0, 1].map((index) => (
          <div
            key={index}
            className="motion-safe:animate-pulse rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-5"
            style={{ height: 140 }}
            aria-hidden
          />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {triggerError && (
        <div className="rounded-lg border border-neg/20 bg-neg-bg px-3.5 py-2.5 text-sm text-neg">
          {triggerError}
        </div>
      )}

      {opportunities.length > 0 && (
        <div className="flex items-center justify-end gap-2">
          {generating ? (
            <GeneratingBadge />
          ) : (
            <GenerateButton variant="bar" onClick={() => setConfirmOpen(true)} />
          )}
        </div>
      )}

      {opportunities.length === 0 ? (
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-12 text-center">
          <p className="text-sm text-[var(--ink-2)]">
            No product opportunities yet. These are surfaced from evidence-backed problems, not from
            suggested workspaces.
          </p>
          <div className="mt-5 flex justify-center">
            {generating ? (
              <GeneratingBadge />
            ) : (
              <GenerateButton variant="empty-state" onClick={() => setConfirmOpen(true)} />
            )}
          </div>
        </div>
      ) : (
        opportunities.map((opportunity) => (
          <OpportunityCard key={opportunity.id} projectId={projectId} opportunity={opportunity} />
        ))
      )}

      {confirmOpen && (
        <GenerateConfirmDialog
          projectId={projectId}
          onCancel={() => setConfirmOpen(false)}
          onSubmitStart={handleSubmitStart}
        />
      )}
    </div>
  );
}
