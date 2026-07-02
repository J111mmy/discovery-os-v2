"use client";

/**
 * ArtifactReader — premium HTML artifact reader.
 *
 * Renders sanitized content_html with:
 *   • Sticky toolbar (back nav, title, type badge, word count)
 *   • Reading progress bar keyed to .app-content scroll
 *   • Sticky TOC extracted from h2[data-section] headings, annotated with a
 *     per-section citation-density dot (#78)
 *   • cite[data-n] chips wired to a click-to-reveal CitationDetailPortal,
 *     attributed to their enclosing section by walking the rendered DOM
 *     (no markdown/text-position parsing — see #78 channel notes)
 *   • A trust summary above the doc body when citation markup is present;
 *     a neutral "unavailable" notice when it isn't (older artifacts)
 *
 * Sanitisation contract: contentHtml is produced by toSafeContentHtml()
 * in page.tsx (server component) which runs sanitize-html before this
 * component ever receives the string. This component renders the output
 * as-is — it is NOT responsible for sanitisation.
 *
 * Falls back to the existing ArtifactViewer (markdown) when contentHtml
 * is null (pre-migration or sanitiser validation failure).
 */

import "../doc.css";
import "../doc_kit.css";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArtifactViewer } from "./ArtifactViewer";
import { AiDisclaimer } from "../../../../components/AiDisclaimer";
import { CitationDetailPortal, type CitationRecord } from "./CitationDetailPortal";

// ── Types ──────────────────────────────────────────────────────
export interface ArtifactReaderProps {
  artifactId: string;
  projectId: string;
  /** Sanitized HTML from toSafeContentHtml(). Null → markdown fallback. */
  contentHtml: string | null;
  /** Markdown fallback — used when contentHtml is null */
  contentMd: string;
  title: string;
  type: string;
  createdAt: string;
  wordCount: number | null;
  backHref: string;
  backLabel: string;
  versions: ArtifactVersionSummary[];
}

type TocItem = { id: string; label: string };

export type ArtifactVersionSummary = {
  id: string;
  version: number;
  saved_at: string;
};

type SectionConfidence = {
  id: string;
  citationCount: number;
  sourceCount: number;
  speakerCount: number;
  density: "well" | "light" | "none";
};

type CitationsState = "loading" | "available" | "unavailable";
type VerificationActionState = "idle" | "starting" | "queued" | "error";
type TraceState = "loading" | "available" | "unavailable";

type ArtifactTraceLink = {
  relationship: string;
  review_state: string;
  rationale: string | null;
};

type ArtifactTraceProblem = {
  id: string;
  title: string;
  statement: string | null;
  status: string | null;
  severity: string | null;
  review_state: string | null;
  link: ArtifactTraceLink;
};

type ArtifactTraceTheme = {
  id: string;
  label: string;
  central_concept: string | null;
  status: string | null;
  review_state: string | null;
  link: ArtifactTraceLink;
};

type ArtifactTraceOpportunity = {
  id: string;
  title: string;
  how_might_we: string | null;
  status: string | null;
  confidence: number | null;
  review_state: string | null;
  link: ArtifactTraceLink;
};

type ArtifactTraceResponse = {
  artifact_id: string;
  counts: {
    opportunities: number;
    problems: number;
    themes: number;
    evidence: number;
  };
  opportunities: ArtifactTraceOpportunity[];
  problems: ArtifactTraceProblem[];
  themes: ArtifactTraceTheme[];
};

// ── Helpers ────────────────────────────────────────────────────
function dateLabel(iso: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

function dateTimeLabel(iso: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function truncateText(value: string | null | undefined, max = 150) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max - 3)}...` : trimmed;
}

function plural(count: number, singular: string, pluralValue = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralValue}`;
}

function VersionHistoryPanel({ versions }: { versions: ArtifactVersionSummary[] }) {
  if (versions.length <= 1) return null;

  return (
    <details className="mb-5 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2.5 text-xs text-[var(--ink-2)]">
      <summary className="cursor-pointer font-medium text-[var(--ink)]">
        Version history · {versions.length} saved versions
      </summary>
      <ol className="mt-3 space-y-2">
        {versions.map((version, index) => (
          <li key={version.id} className="flex items-center justify-between gap-3">
            <span className="font-medium text-[var(--ink)]">
              v{version.version}
              {index === 0 ? " · current" : ""}
            </span>
            <span className="text-[var(--ink-faint)]">{dateTimeLabel(version.saved_at)}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

// ── Component ──────────────────────────────────────────────────
export function ArtifactReader({
  artifactId,
  projectId,
  contentHtml,
  contentMd,
  title,
  type,
  createdAt,
  wordCount,
  backHref,
  backLabel,
  versions,
}: ArtifactReaderProps) {
  // Fallback: render markdown until content_html migration lands
  if (!contentHtml) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="mb-8">
          <Link
            href={backHref}
            className="mb-4 inline-flex text-sm font-medium text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]"
          >
            {backLabel}
          </Link>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-xs font-medium capitalize text-[var(--ink-muted)]">
              {type}
            </span>
            <span className="text-xs text-[var(--ink-faint)]">{dateLabel(createdAt)}</span>
            {wordCount !== null && (
              <span className="text-xs text-[var(--ink-faint)]">{wordCount} words</span>
            )}
          </div>
          <h1 className="text-2xl font-semibold text-[var(--ink)]">{title}</h1>
        </div>
        <article className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-6">
          <VersionHistoryPanel versions={versions} />
          <ArtifactViewer artifactId={artifactId} projectId={projectId} contentMd={contentMd} />
        </article>
        <AiDisclaimer />
      </div>
    );
  }

  // Full HTML reader — split into inner component to avoid conditional hook calls
  return (
    <HtmlReader
      artifactId={artifactId}
      projectId={projectId}
      contentHtml={contentHtml}
      title={title}
      type={type}
      createdAt={createdAt}
      wordCount={wordCount}
      backHref={backHref}
      backLabel={backLabel}
      versions={versions}
    />
  );
}

// ── HtmlReader ─────────────────────────────────────────────────
type HtmlReaderProps = Omit<ArtifactReaderProps, "contentMd" | "contentHtml"> & {
  contentHtml: string;
};

function HtmlReader({
  artifactId,
  projectId,
  contentHtml,
  title,
  type,
  createdAt,
  wordCount,
  backHref,
  backLabel,
  versions,
}: HtmlReaderProps) {
  const [progress, setProgress] = useState(0);
  const [tocItems, setTocItems] = useState<TocItem[]>([]);
  const [activeSec, setActiveSec] = useState<string | null>(null);
  const articleRef = useRef<HTMLDivElement>(null);

  // ── #78: citation trust layer ─────────────────────────────────
  const [citations, setCitations] = useState<CitationRecord[]>([]);
  const [citationsState, setCitationsState] = useState<CitationsState>("loading");
  const [sectionConfidence, setSectionConfidence] = useState<SectionConfidence[]>([]);
  const [openCitation, setOpenCitation] = useState<{ n: number; rect: DOMRect } | null>(null);
  const [trace, setTrace] = useState<ArtifactTraceResponse | null>(null);
  const [traceState, setTraceState] = useState<TraceState>("loading");
  const [verificationActionState, setVerificationActionState] =
    useState<VerificationActionState>("idle");
  const [verificationActionMessage, setVerificationActionMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadCitations() {
      try {
        const response = await fetch(`/api/artifacts/${artifactId}/citations`, {
          cache: "no-store",
        });
        if (!response.ok) {
          if (active) setCitationsState("unavailable");
          return;
        }

        const payload = (await response.json()) as { citations?: CitationRecord[] };
        const list = payload.citations ?? [];
        if (!active) return;

        if (list.length === 0) {
          setCitationsState("unavailable");
          return;
        }

        setCitations(list);
      } catch {
        if (active) setCitationsState("unavailable");
      }
    }

    void loadCitations();

    return () => {
      active = false;
    };
  }, [artifactId]);

  useEffect(() => {
    let active = true;

    async function loadTrace() {
      try {
        const response = await fetch(`/api/artifacts/${artifactId}/trace`, {
          cache: "no-store",
        });
        if (!response.ok) {
          if (active) setTraceState("unavailable");
          return;
        }

        const payload = (await response.json()) as ArtifactTraceResponse;
        if (!active) return;
        setTrace(payload);
        setTraceState("available");
      } catch {
        if (active) setTraceState("unavailable");
      }
    }

    void loadTrace();

    return () => {
      active = false;
    };
  }, [artifactId]);

  const citationsByNumber = useMemo(
    () => new Map(citations.map((citation) => [citation.n, citation])),
    [citations]
  );

  // Attribute each <cite data-n> / <span class="ev" data-n> chip to its
  // enclosing <section class="sec" id> marker by walking sibling blocks in
  // document order (the markup artifact-markdown.ts actually emits — see
  // #78 channel notes). Falls back to "unavailable" if the citation map has
  // entries but none of them are actually present in the rendered HTML
  // (older artifacts authored before this markup convention existed).
  useEffect(() => {
    if (citations.length === 0) return;
    const el = articleRef.current;
    if (!el) return;

    let currentSection: { id: string; ns: Set<number> } | null = null;
    const sections: SectionConfidence[] = [];
    let totalCitesInDom = 0;

    function flush() {
      if (!currentSection) return;
      const ns = Array.from(currentSection.ns);
      const sourceCount = new Set(
        ns.map((n) => citationsByNumber.get(n)?.source_id ?? citationsByNumber.get(n)?.source_title)
      ).size;
      const speakerCount = new Set(
        ns.map((n) => citationsByNumber.get(n)?.segment_speaker).filter(Boolean)
      ).size;
      const citationCount = ns.length;
      const density: SectionConfidence["density"] =
        citationCount === 0 ? "none" : citationCount >= 2 && sourceCount >= 2 ? "well" : "light";
      sections.push({ id: currentSection.id, citationCount, sourceCount, speakerCount, density });
    }

    Array.from(el.children).forEach((child) => {
      if (!(child instanceof HTMLElement)) return;

      if (child.matches("section.sec[id]")) {
        flush();
        currentSection = { id: child.id, ns: new Set() };
        return;
      }

      child.querySelectorAll("cite[data-n], span.ev[data-n]").forEach((node) => {
        const n = Number(node.getAttribute("data-n"));
        if (!Number.isFinite(n)) return;
        totalCitesInDom += 1;
        currentSection?.ns.add(n);
      });
    });
    flush();

    if (totalCitesInDom === 0) {
      setCitationsState("unavailable");
      return;
    }

    setSectionConfidence(sections);
    setCitationsState("available");
  }, [citations, citationsByNumber, contentHtml]);

  // Toggle a citation popover on click via event delegation — the chips
  // live inside dangerouslySetInnerHTML output, not React-rendered nodes.
  useEffect(() => {
    const el = articleRef.current;
    if (!el || citationsState !== "available") return;

    function onClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      const cite = target?.closest("cite[data-n], span.ev[data-n]") as HTMLElement | null;
      if (!cite) return;
      const n = Number(cite.getAttribute("data-n"));
      if (!Number.isFinite(n) || !citationsByNumber.has(n)) return;
      const rect = cite.getBoundingClientRect();
      setOpenCitation((prev) => (prev?.n === n ? null : { n, rect }));
    }

    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [citationsState, citationsByNumber]);

  // Reflect open state onto the chip DOM nodes — doc_kit.css already styles
  // cite[data-n][aria-expanded="true"].
  useEffect(() => {
    const el = articleRef.current;
    if (!el) return;
    el.querySelectorAll("cite[data-n], span.ev[data-n]").forEach((node) => {
      const n = Number(node.getAttribute("data-n"));
      node.setAttribute("aria-expanded", String(openCitation?.n === n));
    });
  }, [openCitation]);

  // Close on Escape, outside click, or scroll (doc body scrolls — a stale
  // anchored popover is worse than a closed one).
  useEffect(() => {
    if (!openCitation) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenCitation(null);
    }

    function onPointerDown(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (
        !target?.closest("[data-citation-detail-portal]") &&
        !target?.closest("cite[data-n], span.ev[data-n]")
      ) {
        setOpenCitation(null);
      }
    }

    function onScrollOrResize() {
      setOpenCitation(null);
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    const scrollEl = document.querySelector(".app-content");
    scrollEl?.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
      scrollEl?.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [openCitation]);

  const sectionConfidenceById = useMemo(
    () => new Map(sectionConfidence.map((section) => [section.id, section])),
    [sectionConfidence]
  );
  const openCitationRecord = openCitation ? citationsByNumber.get(openCitation.n) ?? null : null;

  // Extract TOC from rendered HTML after mount
  useEffect(() => {
    const el = articleRef.current;
    if (!el) return;
    const headings = Array.from(
      el.querySelectorAll<HTMLElement>("h2[data-section]")
    );
    setTocItems(
      headings
        .map((h) => ({
          id: h.closest("section")?.id ?? "",
          label: h.getAttribute("data-section") ?? "",
        }))
        .filter((t) => t.id && t.label)
    );
  }, [contentHtml]);

  // Scroll: progress bar + active TOC section
  useEffect(() => {
    const scrollEl =
      typeof document !== "undefined"
        ? document.querySelector(".app-content")
        : null;
    if (!scrollEl) return;

    function onScroll() {
      const { scrollTop, scrollHeight, clientHeight } =
        scrollEl as HTMLElement;
      const max = scrollHeight - clientHeight;
      setProgress(max > 0 ? Math.min(100, (scrollTop / max) * 100) : 0);

      const el = articleRef.current;
      if (!el) return;
      const sections = Array.from(
        el.querySelectorAll<HTMLElement>("section.sec[id]")
      );
      let active: string | null = null;
      for (const sec of sections) {
        if (sec.getBoundingClientRect().top <= 110) active = sec.id;
      }
      setActiveSec(active);
    }

    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    return () => scrollEl.removeEventListener("scroll", onScroll);
  }, []);

  // TOC click: smooth-scroll inside .app-content
  function scrollToSection(id: string) {
    const target = document.getElementById(id);
    if (!target) return;
    const scrollEl = document.querySelector(".app-content");
    if (!scrollEl) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const offset =
      target.getBoundingClientRect().top +
      (scrollEl as HTMLElement).scrollTop -
      80;
    scrollEl.scrollTo({ top: offset, behavior: "smooth" });
  }

  async function startVerification() {
    setVerificationActionState("starting");
    setVerificationActionMessage(null);

    const response = await fetch(`/api/artifacts/${artifactId}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: projectId }),
    });
    const payload = await response.json();

    if (!response.ok) {
      setVerificationActionState("error");
      setVerificationActionMessage(payload.error ?? "Could not start claim verification.");
      return;
    }

    setVerificationActionState("queued");
    setVerificationActionMessage("Claim verification started.");
  }

  return (
    <div className="docview">

      {/* Sticky toolbar */}
      <div className="doc-toolbar">
        <Link href={backHref} className="doc-toolbar-back">
          ← {backLabel}
        </Link>
        <div className="doc-toolbar-sep" />
        <span className="doc-toolbar-title">{title}</span>
        <div className="doc-toolbar-meta">
          <span className="doc-type-badge">{type}</span>
          <span>{dateLabel(createdAt)}</span>
          {wordCount !== null && <span>{wordCount} words</span>}
          <button
            type="button"
            onClick={() => window.print()}
            className="doc-toolbar-back"
            aria-label="Print"
          >
            Print
          </button>
          <button
            type="button"
            onClick={startVerification}
            disabled={verificationActionState === "starting"}
            className="doc-toolbar-back disabled:cursor-not-allowed disabled:opacity-60"
          >
            {verificationActionState === "starting" ? "Starting..." : "Verify claims"}
          </button>
        </div>
      </div>

      {/* Reading progress bar */}
      <div className="doc-progress" aria-hidden>
        <i style={{ width: `${progress}%` }} />
      </div>

      {verificationActionMessage && (
        <div
          className={`mx-auto mt-3 max-w-5xl rounded-lg border px-3 py-2 text-sm ${
            verificationActionState === "error"
              ? "border-neg/20 bg-neg-bg text-neg"
              : "border-pos/20 bg-pos-bg text-pos"
          }`}
        >
          {verificationActionMessage}
        </div>
      )}

      {/* Reader body */}
      <div className="doc-scroll">
        <div className="reader">

          {/* Sticky TOC */}
          {tocItems.length > 0 && (
            <nav className="reader-toc" aria-label="Contents">
              <div className="toc-label">Contents</div>
              {tocItems.map((t) => {
                const confidence =
                  citationsState === "available" ? sectionConfidenceById.get(t.id) : undefined;
                return (
                  <button
                    key={t.id}
                    className={`toc-item${activeSec === t.id ? " on" : ""}`}
                    onClick={() => scrollToSection(t.id)}
                  >
                    <span className="flex items-center gap-1.5">
                      {confidence && <DensityDot density={confidence.density} />}
                      {t.label}
                    </span>
                  </button>
                );
              })}
            </nav>
          )}

          {/* Paper */}
          <main className="reader-main">
            {/*
             * Show a prominent title block when the content doesn't already
             * open with a .dp-hero section (i.e. no # H1 in the source markdown).
             * Avoids duplication for well-structured docs that have their own hero.
             */}
            {!contentHtml.includes('class="dp-hero"') && (
              <div className="mb-5 px-1">
                <h1 className="text-xl font-semibold leading-snug text-[var(--ink)]">
                  {title}
                </h1>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <span className="doc-type-badge">{type}</span>
                  <span className="text-xs text-[var(--ink-faint)]">{dateLabel(createdAt)}</span>
                  {wordCount !== null && (
                    <span className="text-xs text-[var(--ink-faint)]">{wordCount} words</span>
                  )}
                </div>
              </div>
            )}

            {citationsState === "unavailable" && (
              <div className="mb-5 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3.5 py-2.5 text-xs text-[var(--ink-faint)]">
                Citations unavailable for this document.
              </div>
            )}
            <VersionHistoryPanel versions={versions} />
            {citationsState === "available" && (
              <TrustSummary sections={sectionConfidence} citations={citations} />
            )}
            {traceState === "available" && trace && (
              <TraceChainSummary trace={trace} projectId={projectId} />
            )}

            {/*
             * contentHtml is the output of toSafeContentHtml() (server, page.tsx).
             * sanitize-html has already enforced the v1 contract allowlist.
             * This component receives clean HTML — rendering it is safe.
             */}
            <div
              ref={articleRef}
              className="docpaper dp-art"
              dangerouslySetInnerHTML={{ __html: contentHtml }}
            />
            <AiDisclaimer />
          </main>

        </div>
      </div>

      {openCitation && openCitationRecord && (
        <CitationDetailPortal
          citation={openCitationRecord}
          projectId={projectId}
          anchorRect={openCitation.rect}
          onClose={() => setOpenCitation(null)}
        />
      )}
    </div>
  );
}

function TraceBadge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--ink-faint)]">
      {children}
    </span>
  );
}

function TraceSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  if (count === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-faint)]">
          {title}
        </h3>
        <span className="text-xs text-[var(--ink-faint)]">{count}</span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function TraceItem({
  href,
  title,
  body,
  status,
  link,
}: {
  href: string;
  title: string;
  body: string | null;
  status: string | null;
  link: ArtifactTraceLink;
}) {
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Link href={href} className="text-sm font-medium text-[var(--ink)] hover:text-[var(--brand)]">
          {title}
        </Link>
        <div className="flex flex-wrap items-center gap-1.5">
          {status && <TraceBadge>{status}</TraceBadge>}
          <TraceBadge>{link.review_state}</TraceBadge>
        </div>
      </div>
      {body && <p className="mt-1 text-xs leading-5 text-[var(--ink-2)]">{body}</p>}
      {link.rationale && (
        <p className="mt-1 text-xs leading-5 text-[var(--ink-faint)]">
          {truncateText(link.rationale, 180)}
        </p>
      )}
    </div>
  );
}

function TraceChainSummary({
  trace,
  projectId,
}: {
  trace: ArtifactTraceResponse;
  projectId: string;
}) {
  const total =
    trace.counts.opportunities + trace.counts.problems + trace.counts.themes + trace.counts.evidence;

  return (
    <div className="mb-5 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3.5 py-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-[var(--ink)]">Trace chain</h2>
          <p className="mt-0.5 text-xs text-[var(--ink-faint)]">
            Artifact links stamped by structure-driven compose.
          </p>
        </div>
        <span className="text-xs text-[var(--ink-faint)]">
          {plural(trace.counts.evidence, "evidence", "evidence")} ·{" "}
          {plural(trace.counts.problems, "problem")} · {plural(trace.counts.themes, "theme")} ·{" "}
          {plural(trace.counts.opportunities, "opportunity", "opportunities")}
        </span>
      </div>

      {total === 0 ? (
        <p className="rounded-lg border border-dashed border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--ink-faint)]">
          No structure links were recorded for this artifact.
        </p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-3">
          <TraceSection title="Opportunities" count={trace.opportunities.length}>
            {trace.opportunities.map((opportunity) => (
              <TraceItem
                key={opportunity.id}
                href={`/projects/${projectId}/opportunities`}
                title={opportunity.title}
                body={truncateText(opportunity.how_might_we)}
                status={opportunity.status}
                link={opportunity.link}
              />
            ))}
          </TraceSection>

          <TraceSection title="Problems" count={trace.problems.length}>
            {trace.problems.map((problem) => (
              <TraceItem
                key={problem.id}
                href={`/projects/${projectId}/problems?problem=${problem.id}`}
                title={problem.title}
                body={truncateText(problem.statement)}
                status={problem.status ?? problem.severity}
                link={problem.link}
              />
            ))}
          </TraceSection>

          <TraceSection title="Themes" count={trace.themes.length}>
            {trace.themes.map((theme) => (
              <TraceItem
                key={theme.id}
                href={`/projects/${projectId}/themes/${theme.id}`}
                title={theme.label}
                body={truncateText(theme.central_concept)}
                status={theme.status}
                link={theme.link}
              />
            ))}
          </TraceSection>
        </div>
      )}
    </div>
  );
}

function DensityDot({ density }: { density: SectionConfidence["density"] }) {
  const color =
    density === "well" ? "bg-pos" : density === "light" ? "bg-warn" : "bg-[var(--ink-faint)]";
  return <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${color}`} aria-hidden />;
}

function TrustSummary({
  sections,
  citations,
}: {
  sections: SectionConfidence[];
  citations: CitationRecord[];
}) {
  const well = sections.filter((section) => section.density === "well").length;
  const light = sections.filter((section) => section.density === "light").length;
  const none = sections.filter((section) => section.density === "none").length;
  const sourceCount = new Set(
    citations.map((citation) => citation.source_id ?? citation.source_title ?? citation.evidence_id)
  ).size;

  return (
    <div className="mb-5 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
        <span className="flex items-center gap-1.5 text-[var(--ink)]">
          <DensityDot density="well" />
          {well} well-grounded
        </span>
        <span className="flex items-center gap-1.5 text-[var(--ink)]">
          <DensityDot density="light" />
          {light} lightly grounded
        </span>
        {none > 0 && (
          <span className="flex items-center gap-1.5 text-[var(--ink-2)]">
            <DensityDot density="none" />
            {none} with no citations
          </span>
        )}
        <span className="ml-auto text-[var(--ink-faint)]">
          {citations.length} citation{citations.length === 1 ? "" : "s"} · {sourceCount} source
          {sourceCount === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}
