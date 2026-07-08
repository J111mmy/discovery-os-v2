"use client";

// Front of house: the audience-facing artifact front for a project.
//
// Everything behind this page (evidence, topics, themes, problems,
// opportunities) is back of house. This surface is organized by WHO the
// document serves: Executive, Go-to-market, Sales, Product, Research.
// Pure display layer: zero LLM cost to render, browse, or present.

import { useMemo, useState } from "react";
import Link from "next/link";
import { AUDIENCE_LANES, audienceForType, type AudienceKey } from "@/lib/artifacts/audience";
import { ArtifactCard, trustLine, type ArtifactCardData } from "./artifact-library-list";

type Lens = "all" | AudienceKey;

function spineScore(a: ArtifactCardData): number {
  const verified = a.verification_status === "verified" ? 2 : a.verification_status === "partial" ? 1 : 0;
  return verified * 1000 + a.citationCount * 10 + a.sourceCount;
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(value));
}

function SpineCard({ artifact, projectId }: { artifact: ArtifactCardData; projectId: string }) {
  return (
    <div className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 transition-all duration-150 hover:border-[var(--accent)]/40 hover:shadow-lg">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-[var(--accent)] via-[var(--accent)]/40 to-transparent" />
      <div className="mb-2 flex items-center justify-between gap-2 text-xs text-[var(--ink-faint)]">
        <span className="font-medium uppercase tracking-wide">{AUDIENCE_LANES.find((l) => l.key === audienceForType(artifact.type))?.label}</span>
        <span>{dateLabel(artifact.updated_at)}</span>
      </div>
      <Link href={`/projects/${projectId}/documents/${artifact.id}`} className="block">
        <h3 className="mb-2 line-clamp-2 text-base font-semibold leading-6 text-[var(--ink)] transition-colors group-hover:text-[var(--accent)]">
          {artifact.title}
        </h3>
      </Link>
      <p className="text-xs text-[var(--ink-2)]">{trustLine(artifact)}</p>
      <div className="mt-auto flex items-center gap-3 pt-4 text-xs font-medium">
        <Link
          href={`/projects/${projectId}/documents/${artifact.id}`}
          className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-[var(--ink)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
        >
          Open
        </Link>
        <Link
          href={`/projects/${projectId}/documents/${artifact.id}?present=1`}
          className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-white transition-opacity hover:opacity-90"
        >
          Present
        </Link>
      </div>
    </div>
  );
}

function KitGhostCard({ label, hint, projectId }: { label: string; hint: string; projectId: string }) {
  return (
    <Link
      href={`/projects/${projectId}/compose`}
      className="flex h-full flex-col justify-between rounded-2xl border border-dashed border-[var(--line)] p-4 transition-colors hover:border-[var(--accent)]/50"
    >
      <div>
        <div className="mb-1 text-sm font-medium text-[var(--ink-2)]">{label}</div>
        <p className="text-xs leading-5 text-[var(--ink-faint)]">{hint}</p>
      </div>
      <span className="mt-3 text-xs font-medium text-[var(--accent)]">+ Compose from evidence</span>
    </Link>
  );
}

export function FrontOfHouse({ projectId, artifacts }: { projectId: string; artifacts: ArtifactCardData[] }) {
  const [lens, setLens] = useState<Lens>("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return artifacts;
    return artifacts.filter((a) => a.title.toLowerCase().includes(q));
  }, [artifacts, query]);

  const byLane = useMemo(() => {
    const map = new Map<AudienceKey, ArtifactCardData[]>();
    AUDIENCE_LANES.forEach((lane) => map.set(lane.key, []));
    filtered.forEach((a) => map.get(audienceForType(a.type))!.push(a));
    map.forEach((list) => list.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()));
    return map;
  }, [filtered]);

  const spine = useMemo(
    () => [...filtered].sort((a, b) => spineScore(b) - spineScore(a) || new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, 3),
    [filtered]
  );

  const lanes = lens === "all" ? AUDIENCE_LANES : AUDIENCE_LANES.filter((l) => l.key === lens);

  return (
    <div className="space-y-10">
      {/* Lens + search */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          {(["all", ...AUDIENCE_LANES.map((l) => l.key)] as Lens[]).map((key) => {
            const lane = AUDIENCE_LANES.find((l) => l.key === key);
            const count = key === "all" ? filtered.length : byLane.get(key as AudienceKey)?.length ?? 0;
            const active = lens === key;
            return (
              <button
                key={key}
                onClick={() => setLens(key)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? "border-[var(--accent)]/50 bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "border-[var(--line)] text-[var(--ink-2)] hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
                }`}
              >
                {key === "all" ? "Everything" : lane?.label}
                {count > 0 && <span className="ml-1.5 opacity-60">{count}</span>}
              </button>
            );
          })}
        </div>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="min-w-0 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)] lg:w-64"
          placeholder="Search documents"
        />
      </div>

      {/* The spine: the documents that carry the project right now */}
      {lens === "all" && spine.length > 0 && query.trim() === "" && (
        <section>
          <div className="mb-3 flex items-baseline gap-2">
            <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">The spine</h2>
            <span className="text-xs text-[var(--ink-faint)]">best-grounded documents in this project</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {spine.map((artifact) => (
              <SpineCard key={artifact.id} artifact={artifact} projectId={projectId} />
            ))}
          </div>
        </section>
      )}

      {/* Audience lanes */}
      {lanes.map((lane) => {
        const items = byLane.get(lane.key) ?? [];
        if (lane.key === "library" && items.length === 0) return null;
        const showKit = items.length === 0 && lane.kit.length > 0 && query.trim() === "";
        if (items.length === 0 && !showKit) return null;
        return (
          <section key={lane.key}>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <h2 className="text-sm font-semibold text-[var(--ink)]">{lane.label}</h2>
                <span className="text-xs text-[var(--ink-faint)]">{lane.blurb}</span>
              </div>
              {items.length > 0 && (
                <span className="text-xs text-[var(--ink-faint)]">
                  {items.length} document{items.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((artifact) => (
                <ArtifactCard key={artifact.id} artifact={artifact} projectId={projectId} />
              ))}
              {showKit &&
                lane.kit.map((suggestion) => (
                  <KitGhostCard key={suggestion.label} label={suggestion.label} hint={suggestion.hint} projectId={projectId} />
                ))}
            </div>
          </section>
        );
      })}

      {filtered.length === 0 && query.trim() !== "" && (
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-12 text-center">
          <p className="text-sm text-[var(--ink-2)]">No documents match that search.</p>
        </div>
      )}
    </div>
  );
}
