"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export type EvidenceRelationship = "supporting" | "contradicting" | "example" | "edge_case" | "provenance";
export type ThemeRelationship = "primary" | "contributing" | "provenance";
export type ReviewState = "suggested" | "accepted" | "edited" | "rejected" | "archived";
export type AnalysisSource = "ai" | "human" | "imported" | "system";
export type ProvenanceState = "empty" | "assessed" | "legacy_only" | "mixed";
export type AnchorMethod = "exact" | "normalised" | "fuzzy" | "speaker" | "fallback_first_segment";

export type EvidenceItem = {
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
  relationship: EvidenceRelationship;
  rationale: string | null;
  review_state: ReviewState;
  confidence: number | null;
  source: AnalysisSource;
  agent_run_id: string | null;
  created_at: string;
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

export function sourceTypeLabel(type: string | null) {
  if (!type) return null;
  return sourceTypeLabels[type] ?? type.replace(/_/g, " ");
}

export function isConfidentAnchor(anchorMethod: string | null) {
  return anchorMethod === "exact" || anchorMethod === "normalised";
}

export function trustLabel(scope: string) {
  if (scope === "trusted") return "Trusted";
  if (scope === "excluded") return "Excluded";
  if (scope === "disputed") return "Disputed";
  return "Pending";
}

export function uniqueLabels(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

export function evidenceCountSummary(evidence: EvidenceItem[]) {
  const counts = evidence.reduce<Record<EvidenceRelationship, number>>(
    (acc, row) => {
      acc[row.relationship] += 1;
      return acc;
    },
    { supporting: 0, contradicting: 0, example: 0, edge_case: 0, provenance: 0 }
  );

  const parts = [
    counts.supporting > 0 ? `${counts.supporting} supporting` : null,
    counts.contradicting > 0 ? `${counts.contradicting} contradicting` : null,
    counts.example > 0 ? `${counts.example} examples` : null,
    counts.edge_case > 0 ? `${counts.edge_case} edge cases` : null,
    counts.provenance > 0 ? `${counts.provenance} unassessed` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" · ") : "0 evidence";
}

export const evidenceRelationshipBadge: Record<EvidenceRelationship, { label: string; className: string }> = {
  supporting: { label: "Supports", className: "border-pos/25 bg-pos-bg text-pos" },
  contradicting: { label: "Contradicts", className: "border-info/25 bg-info-bg text-info" },
  example: { label: "Example", className: "border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink-2)]" },
  edge_case: { label: "Edge case", className: "border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink-2)]" },
  provenance: {
    label: "Unassessed",
    className: "border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink-faint)]",
  },
};

export const themeRelationshipLabel: Record<ThemeRelationship, string> = {
  primary: "Primary theme",
  contributing: "Contributing theme",
  provenance: "Linked theme (unassessed)",
};

export const legacyProvenanceExplainer =
  "This problem was identified before evidence-grounded review. The links below come from the original theme analysis and haven't been individually checked against this specific problem.";

export function RelationshipBadge({ relationship }: { relationship: EvidenceRelationship }) {
  const config = evidenceRelationshipBadge[relationship];
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${config.className}`}>
      {config.label}
    </span>
  );
}

export function ReviewStateBadge({ reviewState }: { reviewState: ReviewState }) {
  if (reviewState === "suggested") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-warn">
        <span className="h-1.5 w-1.5 rounded-full bg-warn" aria-hidden />
        Needs review
      </span>
    );
  }
  if (reviewState === "edited") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-info">
        <span className="h-1.5 w-1.5 rounded-full bg-info" aria-hidden />
        Edited by reviewer
      </span>
    );
  }
  return null;
}

export function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-2 py-0.5 text-xs font-medium text-[var(--ink-2)]">
      {children}
    </span>
  );
}

export function EvidenceLink({ projectId, evidence }: { projectId: string; evidence: EvidenceItem }) {
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

export type ReviewLinkType = "evidence" | "theme";

export interface ReviewContext {
  projectId: string;
  problemId: string;
}

export function ReviewLinkButtons({
  context,
  linkType,
  targetId,
  relationship,
  reviewState,
}: {
  context: ReviewContext;
  linkType: ReviewLinkType;
  targetId: string;
  relationship: EvidenceRelationship | ThemeRelationship;
  reviewState: ReviewState;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<"accept" | "reject" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (reviewState !== "suggested" && reviewState !== "edited") return null;

  async function review(action: "accept" | "reject") {
    setPending(action);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/projects/${context.projectId}/problems/${context.problemId}/links/review`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            link_type: linkType,
            target_id: targetId,
            relationship,
            current_review_state: reviewState,
            action,
          }),
        }
      );

      if (response.status === 409) {
        setMessage("Someone already reviewed this. Refreshing…");
        router.refresh();
        return;
      }
      if (!response.ok) {
        setMessage("Couldn't update this link. Try again.");
        setPending(null);
        return;
      }
      router.refresh();
    } catch {
      setMessage("Couldn't update this link. Try again.");
      setPending(null);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={pending !== null}
        onClick={() => review("accept")}
        className="rounded-full border border-pos/25 bg-pos-bg px-2 py-0.5 text-xs font-medium text-pos transition-opacity hover:opacity-80 disabled:opacity-50"
      >
        {pending === "accept" ? "Accepting…" : "Accept"}
      </button>
      <button
        type="button"
        disabled={pending !== null}
        onClick={() => review("reject")}
        className="rounded-full border border-neg/25 bg-neg-bg px-2 py-0.5 text-xs font-medium text-neg transition-opacity hover:opacity-80 disabled:opacity-50"
      >
        {pending === "reject" ? "Rejecting…" : "Reject"}
      </button>
      {message && <span className="text-xs text-[var(--ink-2)]">{message}</span>}
    </div>
  );
}

export function EvidenceCard({
  projectId,
  evidence,
  reviewContext,
}: {
  projectId: string;
  evidence: EvidenceItem;
  reviewContext?: ReviewContext;
}) {
  return (
    <article className="rounded-lg border border-[var(--line)] bg-[var(--bg)] p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <RelationshipBadge relationship={evidence.relationship} />
        <ReviewStateBadge reviewState={evidence.review_state} />
        {reviewContext && (
          <ReviewLinkButtons
            context={reviewContext}
            linkType="evidence"
            targetId={evidence.id}
            relationship={evidence.relationship}
            reviewState={evidence.review_state}
          />
        )}
      </div>
      {evidence.rationale && (
        <p className="mb-2 text-xs italic leading-5 text-[var(--ink-2)]">Why linked: {evidence.rationale}</p>
      )}
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
  );
}

const evidenceGroupDefs: Array<{ relationships: EvidenceRelationship[]; title: string }> = [
  { relationships: ["supporting"], title: "Supporting evidence" },
  { relationships: ["contradicting"], title: "Contradicting evidence" },
  { relationships: ["example", "edge_case"], title: "Examples and edge cases" },
  { relationships: ["provenance"], title: "Linked, not yet individually assessed" },
];

export function RelationshipEvidenceList({
  evidence,
  evidenceProvenanceState,
  projectId,
  emptyLabel = "No evidence linked yet.",
  contradictingCopy = "The agent also found evidence that complicates or pushes back on this problem, shown here for your review, not hidden.",
  reviewContext,
}: {
  evidence: EvidenceItem[];
  evidenceProvenanceState: ProvenanceState;
  projectId: string;
  emptyLabel?: string;
  contradictingCopy?: string;
  reviewContext?: ReviewContext;
}) {
  if (evidence.length === 0) {
    return <p className="text-sm text-[var(--ink-2)]">{emptyLabel}</p>;
  }

  return (
    <div className="grid gap-5">
      {evidenceGroupDefs.map((group) => {
        const rows = evidence.filter((row) => group.relationships.includes(row.relationship));
        if (rows.length === 0) return null;

        const isProvenanceGroup = group.relationships[0] === "provenance";
        const isContradictingGroup = group.relationships[0] === "contradicting";

        return (
          <div key={group.title} className="grid gap-2">
            <h4 className="text-[11px] font-medium uppercase tracking-wide text-[var(--ink-faint)]">
              {group.title}
            </h4>
            {isProvenanceGroup && evidenceProvenanceState === "legacy_only" && (
              <p className="text-xs leading-5 text-[var(--ink-2)]">{legacyProvenanceExplainer}</p>
            )}
            {isContradictingGroup && (
              <p className="text-xs leading-5 text-[var(--ink-2)]">{contradictingCopy}</p>
            )}
            <div className="grid gap-3">
              {rows.map((evidence) => (
                <EvidenceCard
                  key={`${evidence.id}:${evidence.relationship}`}
                  projectId={projectId}
                  evidence={evidence}
                  reviewContext={reviewContext}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
