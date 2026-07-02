"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ARTIFACT_TYPE_ORDER, artifactTypeLabel } from "@/lib/labels";
import type { ArtifactType, ArtifactVerificationStatus } from "@/types/database";

export type ArtifactCardData = {
  id: string;
  type: ArtifactType;
  title: string;
  prompt: string;
  verification_status: ArtifactVerificationStatus;
  updated_at: string;
  citationCount: number;
  sourceCount: number;
  staleSourceCount: number;
};

type SortMode = "date" | "type" | "trust";

const SORT_MODES: { key: SortMode; label: string }[] = [
  { key: "date", label: "Date" },
  { key: "type", label: "Type" },
  { key: "trust", label: "Trust" },
];

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function TrustSignal({ artifact }: { artifact: ArtifactCardData }) {
  if (artifact.verification_status === "verified" || artifact.verification_status === "partial") {
    const verified = artifact.verification_status === "verified";
    return (
      <span
        className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
          verified ? "border-pos/20 bg-pos-bg text-pos" : "border-warn/20 bg-warn-bg text-warn"
        }`}
      >
        {verified ? "Verified" : "Partially verified"}
      </span>
    );
  }

  if (artifact.citationCount > 0) {
    return (
      <span className="rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-2 py-0.5 text-xs font-medium text-[var(--ink-2)]">
        Grounded · {artifact.citationCount} citation{artifact.citationCount !== 1 ? "s" : ""} ·{" "}
        {artifact.sourceCount} source{artifact.sourceCount !== 1 ? "s" : ""}
      </span>
    );
  }

  return null;
}

function FreshnessSignal({ artifact }: { artifact: ArtifactCardData }) {
  if (artifact.staleSourceCount <= 0) return null;

  return (
    <span className="rounded-full border border-warn/20 bg-warn-bg px-2 py-0.5 text-xs font-medium text-warn">
      Out of date · {artifact.staleSourceCount} new source
      {artifact.staleSourceCount !== 1 ? "s" : ""}
    </span>
  );
}

function ArtifactCard({ artifact, projectId }: { artifact: ArtifactCardData; projectId: string }) {
  return (
    <Link href={`/projects/${projectId}/documents/${artifact.id}`} className="group block">
      <article className="flex h-full flex-col rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 transition-all duration-150 group-hover:border-[var(--line-strong)] group-hover:bg-[var(--surface-hover)] group-hover:shadow-md">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
            {artifactTypeLabel(artifact.type)}
          </span>
          <span className="text-xs text-[var(--ink-faint)]">{dateLabel(artifact.updated_at)}</span>
        </div>

        <h3 className="mb-1.5 line-clamp-2 text-sm font-semibold leading-5 text-[var(--ink)] transition-colors group-hover:text-[var(--accent)]">
          {artifact.title}
        </h3>

        {artifact.prompt.trim().length > 0 && (
          <p className="mb-3 line-clamp-2 flex-1 text-xs leading-5 text-[var(--ink-2)]">{artifact.prompt}</p>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
          <TrustSignal artifact={artifact} />
          <FreshnessSignal artifact={artifact} />
        </div>
      </article>
    </Link>
  );
}

export function ArtifactLibraryList({
  projectId,
  artifacts,
}: {
  projectId: string;
  artifacts: ArtifactCardData[];
}) {
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("date");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return artifacts;
    return artifacts.filter((a) => a.title.toLowerCase().includes(q));
  }, [artifacts, query]);

  function toggleGroup(type: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  if (sortMode === "trust") {
    const flat = [...filtered].sort((a, b) => {
      if (b.citationCount !== a.citationCount) return b.citationCount - a.citationCount;
      if (b.sourceCount !== a.sourceCount) return b.sourceCount - a.sourceCount;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });

    return (
      <div className="space-y-6">
        <ControlsRow query={query} setQuery={setQuery} sortMode={sortMode} setSortMode={setSortMode} />
        {flat.length === 0 ? (
          <EmptyFilterState />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {flat.map((artifact) => (
              <ArtifactCard key={artifact.id} artifact={artifact} projectId={projectId} />
            ))}
          </div>
        )}
      </div>
    );
  }

  const groups = new Map<string, ArtifactCardData[]>();
  filtered.forEach((artifact) => {
    if (!groups.has(artifact.type)) groups.set(artifact.type, []);
    groups.get(artifact.type)!.push(artifact);
  });
  groups.forEach((group) => group.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()));

  const groupKeys = Array.from(groups.keys());
  const orderedKeys =
    sortMode === "type"
      ? ARTIFACT_TYPE_ORDER.filter((type) => groups.has(type))
      : [...groupKeys].sort((a, b) => {
          if (a === "other") return 1;
          if (b === "other") return -1;
          const aLatest = groups.get(a)![0].updated_at;
          const bLatest = groups.get(b)![0].updated_at;
          return new Date(bLatest).getTime() - new Date(aLatest).getTime();
        });

  return (
    <div className="space-y-6">
      <ControlsRow query={query} setQuery={setQuery} sortMode={sortMode} setSortMode={setSortMode} />
      {orderedKeys.length === 0 ? (
        <EmptyFilterState />
      ) : (
        <div className="space-y-8">
          {orderedKeys.map((type) => {
            const group = groups.get(type)!;
            const collapsed = collapsedGroups.has(type);
            return (
              <section key={type}>
                <button
                  onClick={() => toggleGroup(type)}
                  aria-expanded={!collapsed}
                  className="mb-3 flex w-full items-center gap-2 text-left"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="var(--ink-faint)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform .15s" }}
                    aria-hidden
                  >
                    <path d="M4 6l4 4 4-4" />
                  </svg>
                  <span className="text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
                    {artifactTypeLabel(type)}
                  </span>
                  <span className="text-xs text-[var(--ink-faint)]">· {group.length}</span>
                </button>
                {!collapsed && (
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {group.map((artifact) => (
                      <ArtifactCard key={artifact.id} artifact={artifact} projectId={projectId} />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ControlsRow({
  query,
  setQuery,
  sortMode,
  setSortMode,
}: {
  query: string;
  setQuery: (value: string) => void;
  sortMode: SortMode;
  setSortMode: (mode: SortMode) => void;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)] sm:max-w-xs"
        placeholder="Search by title"
      />
      <div className="flex items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--bg)] p-1">
        {SORT_MODES.map((mode) => (
          <button
            key={mode.key}
            onClick={() => setSortMode(mode.key)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              sortMode === mode.key
                ? "bg-[var(--accent)] text-white"
                : "text-[var(--ink-2)] hover:text-[var(--ink)]"
            }`}
          >
            {mode.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function EmptyFilterState() {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-12 text-center">
      <p className="text-sm text-[var(--ink-2)]">No documents match that search.</p>
    </div>
  );
}
