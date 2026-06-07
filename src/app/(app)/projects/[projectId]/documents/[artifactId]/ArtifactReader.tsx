"use client";

/**
 * ArtifactReader — premium HTML artifact reader.
 *
 * Renders sanitized content_html with:
 *   • Sticky toolbar (back nav, title, type badge, word count)
 *   • Reading progress bar keyed to .app-content scroll
 *   • Sticky TOC extracted from h2[data-section] headings
 *   • cite[data-n] chips styled by doc_kit.css (popover wired by #14)
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
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArtifactViewer } from "./ArtifactViewer";

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
}

type TocItem = { id: string; label: string };

// ── Helpers ────────────────────────────────────────────────────
function dateLabel(iso: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
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
          <ArtifactViewer artifactId={artifactId} projectId={projectId} contentMd={contentMd} />
        </article>
      </div>
    );
  }

  // Full HTML reader — split into inner component to avoid conditional hook calls
  return (
    <HtmlReader
      contentHtml={contentHtml}
      title={title}
      type={type}
      createdAt={createdAt}
      wordCount={wordCount}
      backHref={backHref}
      backLabel={backLabel}
    />
  );
}

// ── HtmlReader ─────────────────────────────────────────────────
type HtmlReaderProps = Omit<
  ArtifactReaderProps,
  "artifactId" | "projectId" | "contentMd" | "contentHtml"
> & { contentHtml: string };

function HtmlReader({
  contentHtml,
  title,
  type,
  createdAt,
  wordCount,
  backHref,
  backLabel,
}: HtmlReaderProps) {
  const [progress, setProgress] = useState(0);
  const [tocItems, setTocItems] = useState<TocItem[]>([]);
  const [activeSec, setActiveSec] = useState<string | null>(null);
  const articleRef = useRef<HTMLDivElement>(null);

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
        </div>
      </div>

      {/* Reading progress bar */}
      <div className="doc-progress" aria-hidden>
        <i style={{ width: `${progress}%` }} />
      </div>

      {/* Reader body */}
      <div className="doc-scroll">
        <div className="reader">

          {/* Sticky TOC */}
          {tocItems.length > 0 && (
            <nav className="reader-toc" aria-label="Contents">
              <div className="toc-label">Contents</div>
              {tocItems.map((t) => (
                <button
                  key={t.id}
                  className={`toc-item${activeSec === t.id ? " on" : ""}`}
                  onClick={() => scrollToSection(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </nav>
          )}

          {/* Paper */}
          <main className="reader-main">
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
          </main>

        </div>
      </div>
    </div>
  );
}
