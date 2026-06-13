"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

export type ThemeStatus = "draft" | "reviewed" | "accepted" | "archived";

export type ThemeRow = {
  id: string;
  label: string;
  central_concept: string | null;
  description: string | null;
  status: ThemeStatus;
  evidence_count: number;
  updated_at: string;
  problem_count: number;
};

interface ThemesListProps {
  themes: ThemeRow[];
  projectId: string;
}

const themeStatusLabels: Record<ThemeStatus, string> = {
  draft: "Draft",
  reviewed: "Reviewed",
  accepted: "Accepted",
  archived: "Archived",
};

const themeStatusClasses: Record<ThemeStatus, string> = {
  draft: "border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink-2)]",
  reviewed: "border-info/25 bg-info-bg text-info",
  accepted: "border-pos/25 bg-pos-bg text-pos",
  archived: "border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink-faint)]",
};

function ThemeStatusPill({ status }: { status: ThemeStatus }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${themeStatusClasses[status]}`}>
      {themeStatusLabels[status]}
    </span>
  );
}

type SortOption = "evidence" | "alphabetical" | "updated";

const sortOptions: Array<{ value: SortOption; label: string }> = [
  { value: "evidence", label: "Most evidence" },
  { value: "alphabetical", label: "Alphabetical" },
  { value: "updated", label: "Recently updated" },
];

function sortThemes(themes: ThemeRow[], sort: SortOption) {
  const sorted = [...themes];
  if (sort === "alphabetical") {
    sorted.sort((a, b) => a.label.localeCompare(b.label));
  } else if (sort === "updated") {
    sorted.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  } else {
    sorted.sort((a, b) => b.evidence_count - a.evidence_count);
  }
  return sorted;
}

const PAGE_SIZE = 50;

function ThemeCard({ theme, projectId }: { theme: ThemeRow; projectId: string }) {
  const preview = theme.central_concept || theme.description || "No summary yet.";

  return (
    <Link
      href={`/projects/${projectId}/themes/${theme.id}`}
      className="block rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 transition-colors hover:border-[var(--accent)]/40"
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold leading-6 text-[var(--ink)]">{theme.label}</h2>
        <ThemeStatusPill status={theme.status} />
      </div>
      <p className="line-clamp-2 text-sm leading-6 text-[var(--ink-2)]">{preview}</p>
      <div className="mt-4 flex flex-wrap gap-2 text-xs text-[var(--ink-2)]">
        <span>{theme.evidence_count} evidence</span>
        <span className="text-[var(--ink-faint)]">·</span>
        <span>{theme.problem_count} {theme.problem_count === 1 ? "problem" : "problems"}</span>
      </div>
    </Link>
  );
}

export function ThemesList({ themes, projectId }: ThemesListProps) {
  const [sort, setSort] = useState<SortOption>("evidence");
  const [showArchived, setShowArchived] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const archivedCount = useMemo(() => themes.filter((theme) => theme.status === "archived").length, [themes]);

  const filtered = useMemo(
    () => (showArchived ? themes : themes.filter((theme) => theme.status !== "archived")),
    [themes, showArchived]
  );

  const sorted = useMemo(() => sortThemes(filtered, sort), [filtered, sort]);
  const visible = sorted.slice(0, visibleCount);

  if (themes.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-12 text-center text-sm text-[var(--ink-2)]">
        No themes yet. Trust evidence and run synthesis to discover themes.
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">Sort</span>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as SortOption)}
            className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--ink)]"
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {archivedCount > 0 && (
          <button
            type="button"
            onClick={() => setShowArchived((value) => !value)}
            className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm font-medium text-[var(--ink-2)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            {showArchived ? "Hide" : "Show"} archived ({archivedCount})
          </button>
        )}
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-12 text-center text-sm text-[var(--ink-2)]">
          No themes to show.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {visible.map((theme) => (
            <ThemeCard key={theme.id} theme={theme} projectId={projectId} />
          ))}
        </div>
      )}

      {visibleCount < sorted.length && (
        <button
          type="button"
          onClick={() => setVisibleCount((value) => value + PAGE_SIZE)}
          className="w-fit rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-medium text-[var(--ink-2)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
        >
          Show more ({sorted.length - visibleCount} remaining)
        </button>
      )}
    </div>
  );
}
