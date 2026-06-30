// Human-readable labels for all DB enum values.
// Use these everywhere in the UI — never display raw DB strings to users.

import type { ArtifactType, SourceType, TrustScope } from "@/types/database";

// ─── Source type ──────────────────────────────────────────────────────────────

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  customer_interview: "Customer interview",
  sales_call: "Sales call",
  usability_study: "Usability study",
  internal_meeting: "Internal meeting",
  transcript: "Transcript",
  document: "Document",
  note: "Note",
  survey: "Survey",
  support_ticket: "Support ticket",
  web: "Web page",
  slack: "Slack export",
  usability: "Usability test",
  monitoring: "Monitoring",
  other: "Other",
};

export function sourceTypeLabel(type: string): string {
  return SOURCE_TYPE_LABELS[type as SourceType] ?? type.replace(/_/g, " ");
}

// ─── Artifact type ────────────────────────────────────────────────────────────

export const ARTIFACT_TYPE_LABELS: Record<ArtifactType, string> = {
  prd: "PRD",
  brief: "Brief",
  gtm: "GTM",
  persona: "Persona",
  interview_guide: "Interview guide",
  report: "Report",
  opportunity: "Opportunity",
  other: "Other",
};

// Fixed display order for artifact-type groups — "other" always sorts last
// so it never reads as a dominant catch-all at the top of a grouped list.
export const ARTIFACT_TYPE_ORDER: ArtifactType[] = [
  "prd",
  "brief",
  "gtm",
  "persona",
  "interview_guide",
  "report",
  "opportunity",
  "other",
];

export function artifactTypeLabel(type: string): string {
  return ARTIFACT_TYPE_LABELS[type as ArtifactType] ?? type.replace(/_/g, " ");
}

// ─── Trust scope ──────────────────────────────────────────────────────────────

const TRUST_SCOPE_LABELS: Record<TrustScope, string> = {
  trusted: "Trusted",
  pending: "Needs review",
  disputed: "Disputed",
  excluded: "Excluded",
};

export function trustScopeLabel(scope: string): string {
  return TRUST_SCOPE_LABELS[scope as TrustScope] ?? scope;
}

export function trustScopeClasses(scope: string): string {
  switch (scope) {
    case "trusted":
      return "bg-green-900/30 text-green-400";
    case "pending":
      return "bg-yellow-900/30 text-yellow-400";
    case "excluded":
    case "disputed":
      return "bg-red-900/30 text-red-400";
    default:
      return "bg-[var(--surface-2)] text-[var(--ink-2)]";
  }
}

// ─── Priority signal ──────────────────────────────────────────────────────────

export function priorityLabel(signal: string): string {
  switch (signal) {
    case "critical":
      return "Critical";
    case "important":
      return "Important";
    case "nice_to_have":
      return "Nice to have";
    default:
      return signal.replace(/_/g, " ");
  }
}

export function priorityClasses(signal: string): string {
  switch (signal) {
    case "critical":
      return "border-red-400/40 bg-red-500/10 text-red-300";
    case "important":
      return "border-amber-400/40 bg-amber-500/10 text-amber-300";
    default:
      return "border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink-2)]";
  }
}

// ─── AI trust grade ───────────────────────────────────────────────────────────

export function aiGradeLabel(grade: string | null): string | null {
  switch (grade) {
    case "uncertain":
      return "Needs a look";
    case "weak":
      return "Low signal";
    case "trusted":
      return null; // no badge for trusted — it's the default
    default:
      return null;
  }
}

export function aiGradeClasses(grade: string | null): string {
  switch (grade) {
    case "uncertain":
      return "border-amber-500/30 bg-amber-500/10 text-amber-300";
    case "weak":
      return "border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink-2)]";
    default:
      return "";
  }
}
