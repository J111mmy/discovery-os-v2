"use client";

/**
 * WorkspaceView — client shell for the project workspace page.
 *
 * Handles all animated / interactive elements:
 *   ConfRing           — 44px SVG donut that animates on mount
 *   EvidenceChart      — IntersectionObserver bar chart (theme evidence counts)
 *   TeaserCard         — lift-on-hover link card (Problems / Gaps / Opportunities)
 *   ProjectContextCard — collapsible research context
 *
 * Server actions (runProjectSynthesisAction, etc.) are passed as props so they
 * remain server-side without this file needing to import from "use server" modules.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type {
  ProjectOpportunityConfidence,
  ProjectOpportunityStatus,
} from "@/types/database";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type GapSignal = {
  area: string;
  description: string;
  severity: string;
  suggested_action: string;
};

type OpportunityPreview = {
  id: string;
  title: string;
  description: string | null;
  suggested_frame: string | null;
  confidence: ProjectOpportunityConfidence;
  status: ProjectOpportunityStatus;
  supporting_evidence_count: number;
  source_project_count: number;
};

export interface WorkspaceViewProps {
  project: {
    id: string;
    name: string;
    description: string | null;
    frame: string | null;
    synthesis_stale: boolean;
    last_synthesised_at: string | null;
  };
  confidenceScore: number;
  weakestHint: string;
  pulse: { tone: "attention" | "running" | "quiet"; text: string } | null;
  evidenceCount: number;
  trustedTotal: number;
  pendingCount: number;
  artifactCount: number;
  themeRows: Array<{ id: string; label: string; evidence_count: number }>;
  hiddenThemeCount: number;
  problemCount: number;
  problemPreviews: Array<{ id: string; title: string }>;
  gapSignals: GapSignal[] | null;
  opportunityRows: OpportunityPreview[];
  synthesisRunning: boolean;
  // Server actions passed in so this file stays "use client"
  onSynthesize: (formData: FormData) => Promise<void>;
  onOpportunityStatus: (formData: FormData) => Promise<void>;
  onCreateFromOpportunity: (formData: FormData) => Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// ConfRing — animated SVG donut
// ─────────────────────────────────────────────────────────────────────────────

function ConfRing({ pct, size = 44 }: { pct: number; size?: number }) {
  const [drawn, setDrawn] = useState(0);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const t = setTimeout(() => setDrawn(pct), mq.matches ? 0 : 120);
    return () => clearTimeout(t);
  }, [pct]);

  const r = (size - 7) / 2;
  const circ = 2 * Math.PI * r;
  const color = pct >= 85 ? "var(--pos)" : pct >= 55 ? "var(--warn)" : "var(--neg)";
  const levelLabel = pct >= 85 ? "Strong" : pct >= 55 ? "Building" : "Early";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <svg
        width={size}
        height={size}
        aria-hidden
        style={{ transform: "rotate(-90deg)", flex: `0 0 ${size}px` }}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--surface-3)"
          strokeWidth={6}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={`${(drawn / 100) * circ} ${circ}`}
          style={{
            transition: reduced ? "none" : "stroke-dasharray 1.1s var(--ease)",
          }}
        />
      </svg>
      <div>
        <div
          style={{
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: "-0.03em",
            lineHeight: 1,
            color: "var(--ink)",
          }}
        >
          {pct}%
        </div>
        <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 3 }}>
          Confidence · {levelLabel}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EvidenceChart — IntersectionObserver animated bar chart
// ─────────────────────────────────────────────────────────────────────────────

function EvidenceChart({
  items,
}: {
  items: Array<{ label: string; count: number; href?: string }>;
}) {
  const [grown, setGrown] = useState(false);
  const [reduced, setReduced] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    if (mq.matches) {
      setGrown(true);
      return;
    }
    const ob = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setGrown(true);
          ob.disconnect();
        }
      },
      { threshold: 0.2 }
    );
    if (ref.current) ob.observe(ref.current);
    return () => ob.disconnect();
  }, []);

  const max = Math.max(...items.map((it) => it.count), 1);

  const rowStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "1fr 44px",
    alignItems: "center",
    gap: 10,
    borderRadius: 8,
    padding: "4px 6px",
    margin: "0 -6px",
    textDecoration: "none",
    transition: "background .12s",
  };

  return (
    <div ref={ref} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {items.map((it, i) => {
        const inner = (
          <>
            <div>
              <div
                style={{
                  fontSize: 12.5,
                  color: "var(--ink-2)",
                  fontWeight: 500,
                  marginBottom: 4,
                  lineHeight: 1.3,
                }}
              >
                {it.label}
              </div>
              <div
                style={{
                  height: 6,
                  borderRadius: 999,
                  background: "var(--surface-3)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    borderRadius: 999,
                    background: "linear-gradient(90deg, var(--accent), #8a8ff5)",
                    width: grown ? `${(it.count / max) * 100}%` : "0%",
                    transition: reduced
                      ? "none"
                      : `width 0.9s var(--ease) ${i * 80}ms`,
                  }}
                />
              </div>
            </div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "var(--ink-3)",
                textAlign: "right",
                fontFeatureSettings: '"tnum"',
              }}
            >
              {it.count}
            </div>
          </>
        );

        return it.href ? (
          <Link
            key={it.label}
            href={it.href}
            style={rowStyle}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "var(--sel)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
            }}
          >
            {inner}
          </Link>
        ) : (
          <div key={it.label} style={{ ...rowStyle, cursor: "default" }}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TeaserCard — lift-on-hover link card
// ─────────────────────────────────────────────────────────────────────────────

function TeaserCard({
  label,
  count,
  color,
  items,
  href,
}: {
  label: string;
  count: number;
  color: string;
  items: Array<string | { label: string; href?: string }>;
  href: string;
}) {
  const [hovered, setHovered] = useState(false);

  const normalizedItems = items.map((item) =>
    typeof item === "string" ? { label: item, href: undefined as string | undefined } : item
  );

  // Items can carry their own deep-link (e.g. a specific problem). When they do, we
  // can't wrap the whole card in a single <Link> (no nested <a>s), so the header and
  // "View all" row become their own links to `href`, and per-item rows link to
  // `item.href` when present.
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        height: "100%",
        transform: hovered ? "translateY(-2px)" : "none",
        transition: "transform .12s",
      }}
    >
      <div
        style={{
          background: "var(--surface)",
          border: `1px solid ${hovered ? "var(--line-strong)" : "var(--line)"}`,
          borderRadius: "var(--r-lg)",
          overflow: "hidden",
          transition: "border-color .15s",
          height: "100%",
        }}
      >
      {/* Header */}
      <Link
        href={href}
        style={{
          padding: "14px 16px 10px",
          borderBottom: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          textDecoration: "none",
        }}
      >
        <span
          style={{
            fontWeight: 620,
            fontSize: 13.5,
            color: "var(--ink)",
            flex: 1,
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color,
          }}
        >
          {count}
        </span>
      </Link>

      {/* Item list */}
      <div
        style={{
          padding: "10px 16px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {normalizedItems.length > 0 ? (
          normalizedItems.slice(0, 3).map((item, i) => {
            const rowContent = (
              <>
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: color,
                    flexShrink: 0,
                    marginTop: 5,
                    opacity: 0.7,
                  }}
                />
                <span
                  style={{
                    flex: "1 1 auto",
                    minWidth: 0,
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                  }}
                >
                  {item.label}
                </span>
              </>
            );

            const rowStyle: React.CSSProperties = {
              display: "flex",
              alignItems: "flex-start",
              gap: 7,
              fontSize: 12.5,
              color: "var(--ink-3)",
              lineHeight: 1.4,
              textDecoration: "none",
              minWidth: 0,
            };

            return item.href ? (
              <Link key={i} href={item.href} style={rowStyle}>
                {rowContent}
              </Link>
            ) : (
              <div key={i} style={rowStyle}>
                {rowContent}
              </div>
            );
          })
        ) : (
          <div style={{ fontSize: 12.5, color: "var(--ink-faint)" }}>
            Nothing here yet.
          </div>
        )}

        {/* View all row */}
        <Link
          href={href}
          style={{
            marginTop: 4,
            display: "flex",
            alignItems: "center",
            gap: 5,
            fontSize: 12,
            color,
            fontWeight: 580,
            textDecoration: "none",
          }}
        >
          <span>View all</span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M6 12l4-4-4-4" />
          </svg>
        </Link>
      </div>
    </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ProjectContextCard — collapsible research context
// ─────────────────────────────────────────────────────────────────────────────

function ProjectContextCard({
  project,
}: {
  project: {
    id: string;
    name: string;
    description: string | null;
    frame: string | null;
  };
}) {
  const [open, setOpen] = useState(false);
  const fields = [project.description, project.frame].filter(Boolean);
  const configured = fields.length > 0;

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: "var(--r-lg)",
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          width: "100%",
          padding: "14px 18px",
          textAlign: "left",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          fontFamily: "inherit",
          color: "var(--ink)",
          transition: ".14s",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.background = "var(--sel)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = "transparent";
        }}
      >
        {/* Settings icon */}
        <svg
          width="15"
          height="15"
          viewBox="0 0 20 20"
          fill="none"
          stroke="var(--ink-faint)"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          style={{ flexShrink: 0 }}
        >
          <circle cx="10" cy="10" r="2.5" />
          <path d="M10 1v2.5M10 16.5V19M4.22 4.22l1.77 1.77M14.01 14.01l1.77 1.77M1 10h2.5M16.5 10H19M4.22 15.78l1.77-1.77M14.01 5.99l1.77-1.77" />
        </svg>

        <span style={{ fontWeight: 560, fontSize: 13.5 }}>Project context</span>

        {configured && (
          <span style={{ fontSize: 12, color: "var(--ink-faint)", marginLeft: 4 }}>
            · {fields.length} field{fields.length !== 1 ? "s" : ""} configured
          </span>
        )}

        {/* Caret */}
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="var(--ink-faint)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          style={{
            marginLeft: "auto",
            transform: open ? "rotate(0deg)" : "rotate(-90deg)",
            transition: "transform .2s",
            flexShrink: 0,
          }}
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div
          style={{ padding: "0 18px 18px", borderTop: "1px solid var(--line)" }}
        >
          <p
            style={{
              fontSize: 12.5,
              color: "var(--ink-3)",
              lineHeight: 1.55,
              margin: "12px 0",
            }}
          >
            Set once, shapes how documents are composed and evidence is
            synthesised.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {project.description && (
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--ink-faint)",
                    textTransform: "uppercase",
                    letterSpacing: ".08em",
                    marginBottom: 5,
                  }}
                >
                  Description
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: "var(--ink-2)",
                    lineHeight: 1.55,
                    background: "var(--surface-2)",
                    borderRadius: 9,
                    padding: "9px 11px",
                    border: "1px solid var(--line)",
                  }}
                >
                  {project.description}
                </div>
              </div>
            )}

            {project.frame && (
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--ink-faint)",
                    textTransform: "uppercase",
                    letterSpacing: ".08em",
                    marginBottom: 5,
                  }}
                >
                  Research frame
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: "var(--ink-2)",
                    lineHeight: 1.55,
                    background: "var(--surface-2)",
                    borderRadius: 9,
                    padding: "9px 11px",
                    border: "1px solid var(--line)",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {project.frame}
                </div>
              </div>
            )}

            {!configured && (
              <p style={{ fontSize: 13, color: "var(--ink-faint)" }}>
                No context set yet.
              </p>
            )}
          </div>

          <Link
            href={`/projects/${project.id}/settings`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              marginTop: 14,
              fontSize: 12.5,
              color: "var(--accent)",
              fontWeight: 560,
              textDecoration: "none",
            }}
          >
            Edit in settings →
          </Link>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function synthesisTimeLabel(value: string | null) {
  if (!value) return "not synthesised yet";
  const diffMs = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(diffMs / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function firstFrameLine(frame: string | null) {
  if (!frame) return null;
  return frame
    .split("\n")
    .map((l) => l.trim())
    .find(
      (l) =>
        l &&
        !["Problem", "Hypothesis", "Research Areas", "Success Metrics"].includes(l)
    );
}

function confidenceBadgeStyle(confidence: ProjectOpportunityConfidence) {
  if (confidence === "high")
    return { border: "1px solid rgba(47,181,116,.2)", background: "var(--pos-bg)", color: "var(--pos)" };
  if (confidence === "medium")
    return { border: "1px solid rgba(212,163,42,.2)", background: "var(--warn-bg)", color: "var(--warn)" };
  return { border: "1px solid var(--line)", background: "var(--surface-2)", color: "var(--ink-2)" };
}

// ─────────────────────────────────────────────────────────────────────────────
// WorkspaceView — main export
// ─────────────────────────────────────────────────────────────────────────────

export function WorkspaceView({
  project,
  confidenceScore,
  weakestHint,
  pulse,
  evidenceCount,
  trustedTotal,
  pendingCount,
  artifactCount,
  themeRows,
  hiddenThemeCount,
  problemCount,
  problemPreviews,
  gapSignals,
  opportunityRows,
  synthesisRunning,
  onSynthesize,
  onOpportunityStatus,
  onCreateFromOpportunity,
}: WorkspaceViewProps) {
  const cardStyle: React.CSSProperties = {
    background: "var(--surface)",
    border: "1px solid var(--line)",
    borderRadius: "var(--r-lg)",
    overflow: "hidden",
  };

  const showThemes = themeRows.length > 0 || trustedTotal > 0;

  return (
    <div style={{ maxWidth: "72rem", margin: "0 auto" }}>

      {/* ── Page header ── */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 24,
          marginBottom: 24,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: ".12em",
              textTransform: "uppercase",
              color: "var(--ink-faint)",
              marginBottom: 6,
            }}
          >
            Workspace
          </div>
          <h1
            style={{
              fontSize: 24,
              fontWeight: 640,
              color: "var(--ink)",
              letterSpacing: "-0.02em",
              margin: 0,
              lineHeight: 1.2,
            }}
          >
            {project.name}
          </h1>
          {project.description && (
            <p
              style={{
                marginTop: 8,
                fontSize: 13.5,
                color: "var(--ink-3)",
                lineHeight: 1.6,
                maxWidth: 560,
              }}
            >
              {project.description}
            </p>
          )}

          {/* Stat row */}
          {evidenceCount > 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "4px 12px",
                marginTop: 10,
                fontSize: 12.5,
              }}
            >
              <span style={{ color: "var(--ink-2)" }}>
                <strong style={{ color: "var(--ink)" }}>{evidenceCount}</strong>{" "}
                evidence
              </span>
              <span style={{ color: "var(--ink-faint)" }}>·</span>
              <span style={{ color: "var(--pos)" }}>
                <strong>{trustedTotal}</strong> trusted
              </span>
              <span style={{ color: "var(--ink-faint)" }}>·</span>
              <Link
                href={`/projects/${project.id}/evidence`}
                style={{
                  color: pendingCount > 0 ? "var(--warn)" : "var(--ink-2)",
                  textDecoration: "none",
                }}
              >
                <strong>{pendingCount}</strong> needs review
              </Link>
              <span style={{ color: "var(--ink-faint)" }}>·</span>
              <Link
                href={`/projects/${project.id}/documents`}
                style={{ color: "var(--ink-2)", textDecoration: "none" }}
              >
                <strong>{artifactCount}</strong> documents
              </Link>
            </div>
          )}
        </div>

        {/* Confidence ring */}
        <div style={{ flexShrink: 0, paddingTop: 4 }}>
          <ConfRing pct={confidenceScore} size={44} />
          {confidenceScore < 100 && (
            <p
              style={{
                fontSize: 11.5,
                color: "var(--ink-faint)",
                marginTop: 8,
                maxWidth: 150,
                lineHeight: 1.5,
              }}
            >
              {weakestHint}
            </p>
          )}
        </div>
      </div>

      {/* ── Activity pulse ── */}
      {pulse && (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            borderRadius: 999,
            border:
              pulse.tone === "attention"
                ? "1px solid rgba(224,89,79,.2)"
                : pulse.tone === "running"
                ? "1px solid var(--accent)"
                : "1px solid var(--line)",
            background:
              pulse.tone === "attention"
                ? "var(--neg-bg)"
                : pulse.tone === "running"
                ? "var(--accent-soft)"
                : "var(--surface-2)",
            color:
              pulse.tone === "attention"
                ? "var(--neg)"
                : "var(--ink)",
            padding: "6px 14px",
            fontSize: 12,
            fontWeight: 500,
            marginBottom: 20,
          }}
        >
          {pulse.tone === "running" && (
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "var(--accent)",
                flexShrink: 0,
                animation: "pulse 1.4s ease-in-out infinite",
              }}
            />
          )}
          {pulse.text}
        </div>
      )}

      {/* ── Setup prompt (no frame yet) ── */}
      {!project.frame?.trim() && (
        <Link
          href={`/projects/${project.id}/settings`}
          style={{
            display: "block",
            marginBottom: 16,
            padding: "16px 20px",
            borderRadius: "var(--r-lg)",
            border: "1px solid var(--accent)",
            background: "var(--surface)",
            textDecoration: "none",
            color: "var(--ink)",
            transition: "background .14s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--surface-2)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--surface)";
          }}
        >
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>
            Set up your project context →
          </div>
          <div
            style={{
              marginTop: 6,
              fontSize: 13,
              color: "var(--ink-3)",
              lineHeight: 1.55,
            }}
          >
            Tell the system what you&apos;re researching and who you&apos;re
            talking to — the AI gets smarter with each field you fill in.
          </div>
        </Link>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

        {/* ── Evidence by theme card ── */}
        {showThemes && (
          <div style={cardStyle}>
            <div
              style={{
                padding: "16px 20px",
                borderBottom: "1px solid var(--line)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{ fontWeight: 620, fontSize: 14, color: "var(--ink)" }}
                >
                  Evidence by theme
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--ink-3)",
                    marginTop: 2,
                  }}
                >
                  Top themes · {trustedTotal} trusted records · last synthesised{" "}
                  {synthesisTimeLabel(project.last_synthesised_at)}
                </div>
              </div>
              {themeRows.length > 0 && (
                <Link
                  href={`/projects/${project.id}/themes`}
                  style={{
                    flexShrink: 0,
                    fontSize: 12,
                    fontWeight: 560,
                    color: "var(--ink-2)",
                    textDecoration: "none",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    transition: "color .12s",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--ink)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--ink-2)"; }}
                >
                  View all
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M6 12l4-4-4-4" />
                  </svg>
                </Link>
              )}

              {/* Synthesis controls */}
              {synthesisRunning ? (
                <div
                  style={{
                    padding: "6px 12px",
                    borderRadius: "var(--r-sm)",
                    border: "1px solid rgba(212,163,42,.2)",
                    background: "var(--warn-bg)",
                    color: "var(--warn)",
                    fontSize: 12,
                    fontWeight: 500,
                    flexShrink: 0,
                  }}
                >
                  Synthesis running…
                </div>
              ) : project.synthesis_stale ||
                (themeRows.length === 0 && trustedTotal > 0) ? (
                <form action={onSynthesize} style={{ flexShrink: 0 }}>
                  <input type="hidden" name="project_id" value={project.id} />
                  <button
                    type="submit"
                    style={{
                      padding: "7px 14px",
                      borderRadius: "var(--r-sm)",
                      border: "1px solid var(--accent)",
                      background: "transparent",
                      color: "var(--accent)",
                      fontSize: 12.5,
                      fontWeight: 560,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      transition: ".14s",
                    }}
                    onMouseEnter={(e) => {
                      const el = e.currentTarget as HTMLElement;
                      el.style.background = "var(--accent)";
                      el.style.color = "#fff";
                    }}
                    onMouseLeave={(e) => {
                      const el = e.currentTarget as HTMLElement;
                      el.style.background = "transparent";
                      el.style.color = "var(--accent)";
                    }}
                  >
                    {project.synthesis_stale
                      ? "New evidence — run synthesis →"
                      : "Run synthesis"}
                  </button>
                </form>
              ) : null}
            </div>

            <div style={{ padding: "18px 20px" }}>
              {themeRows.length > 0 ? (
                <>
                  <EvidenceChart
                    items={themeRows.map((t) => ({
                      label: t.label,
                      count: t.evidence_count,
                      href: `/projects/${project.id}/evidence?theme_id=${encodeURIComponent(t.id)}`,
                    }))}
                  />

                  {/* Theme chips */}
                  {hiddenThemeCount > 0 && (
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 6,
                        marginTop: 14,
                        paddingTop: 14,
                        borderTop: "1px solid var(--line)",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 12,
                          color: "var(--ink-3)",
                          padding: "4px 10px",
                          borderRadius: 999,
                          border: "1px solid var(--line)",
                        }}
                      >
                        +{hiddenThemeCount} more themes
                      </span>
                      <Link
                        href={`/projects/${project.id}/themes`}
                        style={{
                          fontSize: 12,
                          color: "var(--accent)",
                          padding: "4px 10px",
                          borderRadius: 999,
                          border: "1px solid color-mix(in srgb, var(--accent) 40%, transparent)",
                          textDecoration: "none",
                        }}
                      >
                        View all themes →
                      </Link>
                    </div>
                  )}
                </>
              ) : (
                <p style={{ fontSize: 13.5, color: "var(--ink-faint)", margin: 0 }}>
                  Trust evidence and run synthesis to discover themes.
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── 3-col teaser grid ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
          }}
        >
          <TeaserCard
            label="Problems"
            count={problemCount}
            color="var(--neg)"
            items={problemPreviews.map((p) => ({
              label: p.title,
              href: `/projects/${project.id}/problems?problem=${p.id}`,
            }))}
            href={`/projects/${project.id}/problems`}
          />
          <TeaserCard
            label="Research gaps"
            count={gapSignals?.length ?? 0}
            color="var(--warn)"
            items={(gapSignals ?? []).map((g) => g.area)}
            href={`/projects/${project.id}/sources`}
          />
          <TeaserCard
            label="Suggested workspaces"
            count={opportunityRows.length}
            color="var(--info)"
            items={opportunityRows.map((o) => o.title)}
            href="#opportunities"
          />
        </div>

        {/* ── Opportunity detail rows (actions: create / watch / dismiss) ── */}
        {opportunityRows.length > 0 && (
          <div id="opportunities" style={cardStyle}>
            <div
              style={{
                padding: "14px 20px",
                borderBottom: "1px solid var(--line)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontWeight: 620, fontSize: 14, color: "var(--ink)" }}>
                  Suggested workspaces
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>
                  Evidence pointing at adjacent discovery areas
                </div>
              </div>
              <span
                style={{
                  padding: "3px 10px",
                  borderRadius: 999,
                  border: "1px solid var(--line)",
                  fontSize: 12,
                  color: "var(--ink-faint)",
                }}
              >
                {opportunityRows.length} active
              </span>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 0,
              }}
            >
              {opportunityRows.map((opp, idx) => {
                const frameLine = firstFrameLine(opp.suggested_frame);
                return (
                  <div
                    key={opp.id}
                    style={{
                      padding: "16px 20px",
                      borderBottom:
                        idx < opportunityRows.length - 1
                          ? "1px solid var(--line)"
                          : "none",
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <span
                        style={{
                          padding: "2px 8px",
                          borderRadius: 999,
                          fontSize: 11.5,
                          fontWeight: 500,
                          border: "1px solid var(--line)",
                          background: "var(--surface-2)",
                          color: "var(--ink-2)",
                        }}
                      >
                        {opp.status === "watching" ? "Watching" : "Suggested"}
                      </span>
                      <span
                        style={{
                          padding: "2px 8px",
                          borderRadius: 999,
                          fontSize: 11.5,
                          fontWeight: 500,
                          ...confidenceBadgeStyle(opp.confidence),
                        }}
                      >
                        {opp.confidence} confidence
                      </span>
                    </div>

                    <div style={{ fontWeight: 600, fontSize: 14, color: "var(--ink)" }}>
                      {opp.title}
                    </div>
                    {opp.description && (
                      <p
                        style={{
                          fontSize: 13,
                          color: "var(--ink-3)",
                          lineHeight: 1.55,
                          margin: 0,
                        }}
                      >
                        {opp.description}
                      </p>
                    )}
                    {frameLine && (
                      <p
                        style={{
                          fontSize: 12,
                          color: "var(--ink-faint)",
                          margin: 0,
                        }}
                      >
                        Suggested frame: {frameLine}
                      </p>
                    )}
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--ink-faint)",
                        display: "flex",
                        gap: 8,
                      }}
                    >
                      <span>
                        {opp.supporting_evidence_count} evidence record
                        {opp.supporting_evidence_count !== 1 ? "s" : ""}
                      </span>
                      <span>·</span>
                      <span>
                        {opp.source_project_count} source project
                        {opp.source_project_count !== 1 ? "s" : ""}
                      </span>
                    </div>

                    {/* Action forms */}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      <form action={onCreateFromOpportunity}>
                        <input
                          type="hidden"
                          name="project_id"
                          value={project.id}
                        />
                        <input
                          type="hidden"
                          name="opportunity_id"
                          value={opp.id}
                        />
                        <button
                          type="submit"
                          style={{
                            padding: "6px 14px",
                            borderRadius: "var(--r-sm)",
                            background: "var(--accent)",
                            color: "#fff",
                            border: "none",
                            fontSize: 12.5,
                            fontWeight: 560,
                            cursor: "pointer",
                            fontFamily: "inherit",
                          }}
                        >
                          Create project
                        </button>
                      </form>

                      {opp.status !== "watching" && (
                        <form action={onOpportunityStatus}>
                          <input
                            type="hidden"
                            name="project_id"
                            value={project.id}
                          />
                          <input
                            type="hidden"
                            name="opportunity_id"
                            value={opp.id}
                          />
                          <input type="hidden" name="status" value="watching" />
                          <button
                            type="submit"
                            style={{
                              padding: "6px 14px",
                              borderRadius: "var(--r-sm)",
                              border: "1px solid var(--line)",
                              background: "transparent",
                              color: "var(--ink-2)",
                              fontSize: 12.5,
                              fontWeight: 560,
                              cursor: "pointer",
                              fontFamily: "inherit",
                            }}
                          >
                            Keep watching
                          </button>
                        </form>
                      )}

                      <form action={onOpportunityStatus}>
                        <input
                          type="hidden"
                          name="project_id"
                          value={project.id}
                        />
                        <input
                          type="hidden"
                          name="opportunity_id"
                          value={opp.id}
                        />
                        <input type="hidden" name="status" value="dismissed" />
                        <button
                          type="submit"
                          style={{
                            padding: "6px 14px",
                            borderRadius: "var(--r-sm)",
                            border: "1px solid rgba(224,89,79,.2)",
                            background: "transparent",
                            color: "var(--neg)",
                            fontSize: 12.5,
                            fontWeight: 560,
                            cursor: "pointer",
                            fontFamily: "inherit",
                          }}
                        >
                          Dismiss
                        </button>
                      </form>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Project context collapsible ── */}
        <ProjectContextCard project={project} />
      </div>
    </div>
  );
}
