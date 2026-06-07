"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateProblemStatusAction } from "./actions";

export type ProblemStatus = "surfaced" | "acknowledged" | "active" | "resolved" | "dismissed";
export type ProblemSeverity = "high" | "medium" | "low";

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

interface ProblemsListProps {
  problems: ProblemRow[];
  projectId: string;
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

function SeverityPill({ severity }: { severity: ProblemSeverity }) {
  const classes =
    severity === "high"
      ? "border-neg/20 bg-neg-bg text-neg"
      : severity === "medium"
      ? "border-warn/20 bg-warn-bg text-warn"
      : "border-[var(--border)] bg-[var(--surface-2)] text-[var(--ink-muted)]";

  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${classes}`}>
      {severityLabels[severity]}
    </span>
  );
}

function StatusPill({ status }: { status: ProblemStatus }) {
  return (
    <span className="rounded-full border border-[var(--border)] bg-[var(--surface-0)] px-2 py-0.5 text-xs font-medium text-[var(--ink-muted)]">
      {statusLabels[status]}
    </span>
  );
}

function ProblemCard({ problem, projectId }: { problem: ProblemRow; projectId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const availableTransitions = transitions[problem.status];

  function updateStatus(nextStatus: ProblemStatus) {
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
    <article className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5">
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
        <p className="text-sm leading-6 text-[var(--ink-muted)]">{problem.description}</p>
      )}

      <div className="mt-4 flex flex-wrap gap-2 text-xs text-[var(--ink-muted)]">
        <span>{problem.source_theme_ids.length} themes</span>
        <span className="text-[var(--ink-faint)]">·</span>
        <span>{problem.source_evidence_ids.length} evidence records</span>
      </div>

      {availableTransitions.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {availableTransitions.map((transition) => (
            <button
              key={transition.status}
              type="button"
              disabled={isPending}
              onClick={() => updateStatus(transition.status)}
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--ink)] transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {transition.label}
            </button>
          ))}
        </div>
      )}
    </article>
  );
}

function ProblemGroup({
  title,
  problems,
  projectId,
}: {
  title: string;
  problems: ProblemRow[];
  projectId: string;
}) {
  if (problems.length === 0) return null;

  return (
    <section className="grid gap-3">
      <div className="text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
        {title} · {problems.length}
      </div>
      {sortProblems(problems).map((problem) => (
        <ProblemCard key={problem.id} problem={problem} projectId={projectId} />
      ))}
    </section>
  );
}

export function ProblemsList({ problems, projectId }: ProblemsListProps) {
  const [showClosed, setShowClosed] = useState(false);

  const surfaced = problems.filter((problem) => problem.status === "surfaced");
  const acknowledged = problems.filter((problem) => problem.status === "acknowledged");
  const active = problems.filter((problem) => problem.status === "active");
  const closed = problems.filter(
    (problem) => problem.status === "resolved" || problem.status === "dismissed"
  );

  if (problems.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-12 text-center text-sm text-[var(--ink-muted)]">
        No problems have been surfaced yet.
      </div>
    );
  }

  return (
    <div className="grid gap-8">
      <ProblemGroup title="Surfaced" problems={surfaced} projectId={projectId} />
      <ProblemGroup title="Acknowledged" problems={acknowledged} projectId={projectId} />
      <ProblemGroup title="Active" problems={active} projectId={projectId} />

      {closed.length > 0 && (
        <section className="grid gap-3">
          <button
            type="button"
            onClick={() => setShowClosed((value) => !value)}
            className="w-fit rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--ink-muted)] transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)]"
          >
            {showClosed ? "Hide" : "Show"} resolved / dismissed ({closed.length})
          </button>

          {showClosed && (
            <ProblemGroup title="Resolved / dismissed" problems={closed} projectId={projectId} />
          )}
        </section>
      )}
    </div>
  );
}
