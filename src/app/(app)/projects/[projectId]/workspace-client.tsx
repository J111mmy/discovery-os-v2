"use client";

/**
 * WorkspaceView — client shell for the project workspace page.
 *
 * Handles all animated / interactive elements:
 *   ConfRing           — 44px SVG donut that animates on mount
 *   EvidenceChart      — IntersectionObserver bar chart (theme evidence counts)
 *   TeaserCard         — lift-on-hover link card (Problems / Gaps / Suggested workspaces)
 *   ProjectContextCard — collapsible research context
 *
 * Server actions (runProjectSynthesisAction, etc.) are passed as props so they
 * remain server-side without this file needing to import from "use server" modules.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { FrameDraftBanner, type FrameDraft } from "./settings/frame-draft-banner";
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

type SuggestedWorkspacePreview = {
  id: string;
  title: string;
  description: string | null;
  suggested_frame: string | null;
  confidence: ProjectOpportunityConfidence;
  status: ProjectOpportunityStatus;
  supporting_evidence_count: number;
  source_project_count: number;
};

type OutcomeAssessment = {
  outcome_status: "met" | "on_track" | "blocked";
  rationale: string;
  gaps_to_outcome: Array<{ gap: string; why_it_matters: string; severity: "high" | "medium" | "low" }>;
  next_actions: Array<{ action: string; priority: "high" | "medium" | "low"; rationale: string }>;
  generatable_artifacts: Array<{
    artifact_type: string;
    purpose: string;
    readiness: "ready" | "needs_more_evidence" | "not_ready";
  }>;
};

export interface WorkspaceViewProps {
  project: {
    id: string;
    name: string;
    description: string | null;
    frame: string | null;
    frame_draft: FrameDraft | null;
    frame_draft_generated_at: string | null;
    research_outcome: string | null;
    synthesis_stale: boolean;
    last_synthesised_at: string | null;
  };
  outcomeAssessment: OutcomeAssessment | null;
  outcomeAssessedAt: string | null;
  assessingOutcome: boolean;
  onAssessOutcome: (formData: FormData) => Promise<void>;
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
  problemPreviews: Array<{ id: string; title: string; evidence_link_count: number }>;
  gapSignals: GapSignal[] | null;
  suggestedWorkspaceRows: SuggestedWorkspacePreview[];
  synthesisRunning: boolean;
  // Server actions passed in so this file stays "use client"
  onSynthesize: (formData: FormData) => Promise<void>;
  onOpportunityStatus: (formData: FormData) => Promise<void>;
  onCreateFromOpportunity: (formData: FormData) => Promise<void>;
}

function SynthesisSubmitButton({ isStale }: { isStale: boolean }) {
  const { pending } = useFormStatus();
  const label = pending
    ? "Starting synthesis..."
    : isStale
      ? "New evidence: run synthesis ->"
      : "Run synthesis";

  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      style={{
        padding: "7px 14px",
        borderRadius: "var(--r-sm)",
        border: "1px solid var(--accent)",
        background: pending ? "var(--accent-soft)" : "transparent",
        color: "var(--accent)",
        fontSize: 12.5,
        fontWeight: 560,
        cursor: pending ? "wait" : "pointer",
        fontFamily: "inherit",
        opacity: pending ? 0.78 : 1,
        transition: ".14s",
      }}
      onMouseEnter={(e) => {
        if (pending) return;
        const el = e.currentTarget as HTMLElement;
        el.style.background = "var(--accent)";
        el.style.color = "#fff";
      }}
      onMouseLeave={(e) => {
        if (pending) return;
        const el = e.currentTarget as HTMLElement;
        el.style.background = "transparent";
        el.style.color = "var(--accent)";
      }}
    >
      {label}
    </button>
  );
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
// ResearchGapsCard — collapsible inline gap signal detail
// ─────────────────────────────────────────────────────────────────────────────

function ResearchGapsCard({ gapSignals }: { gapSignals: GapSignal[] }) {
  const [open, setOpen] = useState(false);

  const severityColor = (s: string) =>
    s === "high" ? "var(--neg)" : s === "medium" ? "var(--warn)" : "var(--ink-2)";

  return (
    <div
      id="research-gaps"
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
        <span style={{ flex: 1, fontWeight: 600, fontSize: 13.5 }}>
          Research gaps
          <span
            style={{
              marginLeft: 8,
              fontSize: 12,
              fontWeight: 500,
              color: "var(--ink-2)",
            }}
          >
            {gapSignals.length}
          </span>
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="var(--ink-faint)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            flexShrink: 0,
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform .18s",
          }}
          aria-hidden
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div style={{ borderTop: "1px solid var(--line)" }}>
          {gapSignals.map((gap, i) => (
            <div
              key={i}
              style={{
                padding: "14px 18px",
                borderBottom: i < gapSignals.length - 1 ? "1px solid var(--line)" : "none",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 6,
                }}
              >
                <span
                  style={{
                    fontWeight: 600,
                    fontSize: 13,
                    color: "var(--ink)",
                    flex: 1,
                  }}
                >
                  {gap.area}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    color: severityColor(gap.severity),
                  }}
                >
                  {gap.severity}
                </span>
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: 12.5,
                  lineHeight: 1.6,
                  color: "var(--ink-2)",
                  marginBottom: gap.suggested_action ? 6 : 0,
                }}
              >
                {gap.description}
              </p>
              {gap.suggested_action && (
                <p
                  style={{
                    margin: 0,
                    fontSize: 12,
                    lineHeight: 1.5,
                    color: "var(--ink-faint)",
                    fontStyle: "italic",
                  }}
                >
                  {gap.suggested_action}
                </p>
              )}
            </div>
          ))}
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

function timeAgoLabel(value: string | null) {
  if (!value) return null;
  const diffMs = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(diffMs / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function confidenceBadgeStyle(confidence: ProjectOpportunityConfidence) {
  if (confidence === "high")
    return { border: "1px solid rgba(47,181,116,.2)", background: "var(--pos-bg)", color: "var(--pos)" };
  if (confidence === "medium")
    return { border: "1px solid rgba(212,163,42,.2)", background: "var(--warn-bg)", color: "var(--warn)" };
  return { border: "1px solid var(--line)", background: "var(--surface-2)", color: "var(--ink-2)" };
}

// ─────────────────────────────────────────────────────────────────────────────
// OutcomeEngine — the workspace centerpiece: outcome, assessment, gap, actions
// ─────────────────────────────────────────────────────────────────────────────

const OUTCOME_STATUS_META: Record<
  OutcomeAssessment["outcome_status"],
  { label: string; color: string; bg: string; border: string }
> = {
  met: { label: "Outcome met", color: "var(--pos)", bg: "var(--pos-bg)", border: "rgba(47,181,116,.25)" },
  on_track: { label: "On track", color: "var(--warn)", bg: "var(--warn-bg)", border: "rgba(212,163,42,.25)" },
  blocked: { label: "Blocked", color: "var(--neg)", bg: "var(--neg-bg)", border: "rgba(224,89,79,.25)" },
};

function outcomeSeverityColor(severity: "high" | "medium" | "low") {
  return severity === "high" ? "var(--neg)" : severity === "medium" ? "var(--warn)" : "var(--ink-2)";
}

function readinessMeta(readiness: "ready" | "needs_more_evidence" | "not_ready") {
  if (readiness === "ready") return { label: "Ready", color: "var(--pos)" };
  if (readiness === "needs_more_evidence") return { label: "Needs more evidence", color: "var(--warn)" };
  return { label: "Not ready", color: "var(--ink-faint)" };
}

function pickTopGap(gaps: OutcomeAssessment["gaps_to_outcome"]) {
  if (gaps.length === 0) return null;
  const rank = { high: 0, medium: 1, low: 2 };
  return [...gaps].sort((a, b) => rank[a.severity] - rank[b.severity])[0];
}

const OUTCOME_ASSESS_POLL_MS = 4000;
// Single LLM call with a ~50s server timeout; poll well past that before giving up.
const OUTCOME_ASSESS_MAX_POLLS = 25;

function AssessButton({
  projectId,
  assessing,
  hasAssessment,
  onAssessOutcome,
  onSubmitStart,
}: {
  projectId: string;
  assessing: boolean;
  hasAssessment: boolean;
  onAssessOutcome: (formData: FormData) => Promise<void>;
  onSubmitStart: () => void;
}) {
  return (
    <form action={onAssessOutcome} onSubmit={onSubmitStart}>
      <input type="hidden" name="project_id" value={projectId} />
      <button
        type="submit"
        disabled={assessing}
        style={{
          borderRadius: 8,
          border: "1px solid var(--accent)",
          background: assessing ? "var(--surface-2)" : "var(--accent)",
          color: assessing ? "var(--ink-faint)" : "white",
          fontSize: 12.5,
          fontWeight: 600,
          padding: "7px 14px",
          cursor: assessing ? "default" : "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {assessing ? "Assessing…" : hasAssessment ? "Re-assess" : "Assess outcome"}
      </button>
    </form>
  );
}

function OutcomeEngine({
  projectId,
  frame,
  frameDraft,
  frameDraftGeneratedAt,
  researchOutcome,
  assessment,
  assessedAt,
  initiallyAssessing,
  onAssessOutcome,
}: {
  projectId: string;
  frame: string | null;
  frameDraft: FrameDraft | null;
  frameDraftGeneratedAt: string | null;
  researchOutcome: string | null;
  assessment: OutcomeAssessment | null;
  assessedAt: string | null;
  initiallyAssessing: boolean;
  onAssessOutcome: (formData: FormData) => Promise<void>;
}) {
  const router = useRouter();
  const [assessing, setAssessing] = useState(initiallyAssessing);
  const [open, setOpen] = useState(false);
  const baselineAssessedAtRef = useRef(assessedAt);
  const pollCountRef = useRef(0);

  // Server gave us a fresher outcome_assessed_at than our baseline: the run finished.
  useEffect(() => {
    if (assessing && assessedAt !== baselineAssessedAtRef.current) {
      setAssessing(false);
    }
  }, [assessing, assessedAt]);

  useEffect(() => {
    if (!assessing) return;
    const timer = setInterval(() => {
      pollCountRef.current += 1;
      if (pollCountRef.current >= OUTCOME_ASSESS_MAX_POLLS) {
        setAssessing(false);
        return;
      }
      router.refresh();
    }, OUTCOME_ASSESS_POLL_MS);
    return () => clearInterval(timer);
  }, [assessing, router]);

  function handleSubmitStart() {
    baselineAssessedAtRef.current = assessedAt;
    pollCountRef.current = 0;
    setAssessing(true);
  }

  const hasOutcome = Boolean(frame?.trim()) || Boolean(researchOutcome?.trim());
  const outcomeText = researchOutcome?.trim() || firstFrameLine(frame) || null;

  const cardStyle: React.CSSProperties = {
    background: "var(--surface)",
    border: "1px solid var(--line)",
    borderRadius: "var(--r-lg)",
    overflow: "hidden",
  };

  if (!hasOutcome) {
    if (frameDraft) {
      return (
        <FrameDraftBanner
          projectId={projectId}
          draft={frameDraft}
          generatedAt={frameDraftGeneratedAt}
          onAccepted={() => {}}
          onDiscarded={() => {}}
        />
      );
    }

    return (
      <Link
        href={`/projects/${projectId}/settings`}
        style={{
          display: "block",
          padding: "20px 22px",
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
        <div style={{ fontSize: 15, fontWeight: 640, letterSpacing: "-0.01em" }}>
          Define what this project is trying to achieve →
        </div>
        <div
          style={{
            marginTop: 6,
            fontSize: 13,
            color: "var(--ink-3)",
            lineHeight: 1.55,
            maxWidth: 480,
          }}
        >
          Set the project frame and desired outcome — once it&apos;s set, the system can assess
          whether your evidence shows you&apos;re on track to reach it.
        </div>
      </Link>
    );
  }

  const status = assessment ? OUTCOME_STATUS_META[assessment.outcome_status] : null;
  const assessedLabel = timeAgoLabel(assessedAt);
  const topGap = assessment ? pickTopGap(assessment.gaps_to_outcome) : null;

  return (
      <div style={cardStyle}>
        <div style={{ padding: "14px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: ".1em",
                  textTransform: "uppercase",
                  color: "var(--ink-faint)",
                  marginBottom: 4,
                }}
              >
                Outcome
              </div>
              <div
                title={outcomeText ?? undefined}
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: "var(--ink)",
                  lineHeight: 1.4,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {outcomeText}
              </div>
            </div>
            <div style={{ flexShrink: 0, textAlign: "right" }}>
              <AssessButton
                projectId={projectId}
                assessing={assessing}
                hasAssessment={Boolean(assessment)}
                onAssessOutcome={onAssessOutcome}
                onSubmitStart={handleSubmitStart}
              />
              {assessedLabel && (
                <div style={{ marginTop: 6, fontSize: 11, color: "var(--ink-faint)" }}>
                  Last assessed {assessedLabel}
                </div>
              )}
            </div>
          </div>

          {!assessment ? (
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
              {assessing
                ? "Assessing whether your evidence supports this outcome…"
                : "Not yet assessed."}
            </p>
          ) : (
            <button
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                padding: 0,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                fontFamily: "inherit",
                textAlign: "left",
              }}
            >
              <span
                style={{
                  flexShrink: 0,
                  borderRadius: 999,
                  border: `1px solid ${status!.border}`,
                  background: status!.bg,
                  color: status!.color,
                  fontSize: 11.5,
                  fontWeight: 700,
                  padding: "3px 10px",
                }}
              >
                {status!.label}
              </span>
              {topGap ? (
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 12.5,
                    color: "var(--ink-2)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  <span
                    style={{
                      flexShrink: 0,
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: outcomeSeverityColor(topGap.severity),
                    }}
                    aria-hidden
                  />
                  {topGap.gap}
                </span>
              ) : (
                <span style={{ flex: 1, fontSize: 12.5, color: "var(--ink-faint)" }}>
                  No outstanding gaps
                </span>
              )}
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="var(--ink-faint)"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  flexShrink: 0,
                  transform: open ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform .18s",
                }}
                aria-hidden
              >
                <path d="M4 6l4 4 4-4" />
              </svg>
            </button>
          )}
        </div>

        {open && assessment && (
          <div style={{ borderTop: "1px solid var(--line)", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
            <p style={{ margin: 0, fontSize: 13, color: "var(--ink-2)", lineHeight: 1.6 }}>
              {assessment.rationale}
            </p>

            {assessment.gaps_to_outcome.length > 0 && (
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: ".08em",
                    textTransform: "uppercase",
                    color: "var(--ink-faint)",
                    marginBottom: 8,
                  }}
                >
                  Gap to close
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {assessment.gaps_to_outcome.map((gap, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                      <span
                        style={{
                          flexShrink: 0,
                          marginTop: 6,
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: outcomeSeverityColor(gap.severity),
                        }}
                        aria-hidden
                      />
                      <div>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}>{gap.gap}</div>
                        <div style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.5, marginTop: 2 }}>
                          {gap.why_it_matters}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {assessment.next_actions.length > 0 && (
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: ".08em",
                    textTransform: "uppercase",
                    color: "var(--ink-faint)",
                    marginBottom: 8,
                  }}
                >
                  Next actions
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {assessment.next_actions.map((action, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                      <span
                        style={{
                          flexShrink: 0,
                          marginTop: 6,
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: outcomeSeverityColor(action.priority),
                        }}
                        aria-hidden
                      />
                      <div>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}>{action.action}</div>
                        <div style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.5, marginTop: 2 }}>
                          {action.rationale}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {assessment.generatable_artifacts.length > 0 && (
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: ".08em",
                    textTransform: "uppercase",
                    color: "var(--ink-faint)",
                    marginBottom: 8,
                  }}
                >
                  Generatable artifacts
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {assessment.generatable_artifacts.map((artifact, i) => {
                    const readiness = readinessMeta(artifact.readiness);
                    return (
                      <Link
                        key={i}
                        href={`/projects/${projectId}/compose`}
                        title={artifact.purpose}
                        style={{
                          display: "block",
                          borderRadius: 8,
                          border: "1px solid var(--line)",
                          background: "var(--bg)",
                          padding: "8px 12px",
                          textDecoration: "none",
                          maxWidth: 260,
                        }}
                      >
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}>
                          {artifact.artifact_type}
                        </div>
                        <div style={{ fontSize: 11, color: readiness.color, marginTop: 2 }}>
                          {readiness.label}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SuggestedWorkspacesCard — collapsible aside for project opportunities
// ─────────────────────────────────────────────────────────────────────────────

function SuggestedWorkspacesCard({
  projectId,
  workspaces,
  onCreateFromOpportunity,
  onOpportunityStatus,
}: {
  projectId: string;
  workspaces: SuggestedWorkspacePreview[];
  onCreateFromOpportunity: (formData: FormData) => Promise<void>;
  onOpportunityStatus: (formData: FormData) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  if (workspaces.length === 0) return null;

  return (
    <div
      id="suggested-workspaces"
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
        <span style={{ flex: 1, fontWeight: 600, fontSize: 13.5 }}>
          Suggested workspaces
          <span
            style={{
              marginLeft: 8,
              fontSize: 12,
              fontWeight: 500,
              color: "var(--ink-2)",
            }}
          >
            {workspaces.length}
          </span>
        </span>
        <Link
          href={`/projects/${projectId}/opportunities`}
          onClick={(e) => e.stopPropagation()}
          style={{
            fontSize: 12,
            fontWeight: 560,
            color: "var(--accent)",
            textDecoration: "none",
            flexShrink: 0,
          }}
        >
          Product opportunities →
        </Link>
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="var(--ink-faint)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            flexShrink: 0,
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform .18s",
          }}
          aria-hidden
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div style={{ borderTop: "1px solid var(--line)" }}>
          {workspaces.map((workspace, idx) => {
            const frameLine = firstFrameLine(workspace.suggested_frame);
            return (
              <div
                key={workspace.id}
                style={{
                  padding: "16px 18px",
                  borderBottom:
                    idx < workspaces.length - 1 ? "1px solid var(--line)" : "none",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
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
                    {workspace.status === "watching" ? "Watching" : "Suggested workspace"}
                  </span>
                  <span
                    style={{
                      padding: "2px 8px",
                      borderRadius: 999,
                      fontSize: 11.5,
                      fontWeight: 500,
                      ...confidenceBadgeStyle(workspace.confidence),
                    }}
                  >
                    {workspace.confidence} confidence
                  </span>
                </div>
                <div style={{ fontWeight: 600, fontSize: 14, color: "var(--ink)" }}>
                  {workspace.title}
                </div>
                {workspace.description && (
                  <p style={{ fontSize: 13, color: "var(--ink-3)", lineHeight: 1.55, margin: 0 }}>
                    {workspace.description}
                  </p>
                )}
                {frameLine && (
                  <p style={{ fontSize: 12, color: "var(--ink-faint)", margin: 0 }}>
                    Suggested frame: {frameLine}
                  </p>
                )}
                <div style={{ fontSize: 12, color: "var(--ink-faint)", display: "flex", gap: 8 }}>
                  <span>
                    {workspace.supporting_evidence_count} evidence record
                    {workspace.supporting_evidence_count !== 1 ? "s" : ""}
                  </span>
                  <span>·</span>
                  <span>
                    {workspace.source_project_count} source project
                    {workspace.source_project_count !== 1 ? "s" : ""}
                  </span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <form action={onCreateFromOpportunity}>
                    <input type="hidden" name="project_id" value={projectId} />
                    <input type="hidden" name="opportunity_id" value={workspace.id} />
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
                  {workspace.status !== "watching" && (
                    <form action={onOpportunityStatus}>
                      <input type="hidden" name="project_id" value={projectId} />
                      <input type="hidden" name="opportunity_id" value={workspace.id} />
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
                    <input type="hidden" name="project_id" value={projectId} />
                    <input type="hidden" name="opportunity_id" value={workspace.id} />
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
      )}
    </div>
  );
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
  outcomeAssessment,
  outcomeAssessedAt,
  assessingOutcome,
  onAssessOutcome,
  suggestedWorkspaceRows,
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

      {/* ── Outcome engine — the workspace centerpiece ── */}
      <div style={{ marginBottom: 16 }}>
        <OutcomeEngine
          projectId={project.id}
          frame={project.frame}
          frameDraft={project.frame_draft}
          frameDraftGeneratedAt={project.frame_draft_generated_at}
          researchOutcome={project.research_outcome}
          assessment={outcomeAssessment}
          assessedAt={outcomeAssessedAt}
          initiallyAssessing={assessingOutcome}
          onAssessOutcome={onAssessOutcome}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

        {/* ── Needs your attention band ── */}
        {(pendingCount > 0 || project.synthesis_stale) && (
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: "var(--r-lg)",
              padding: "12px 18px",
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "8px 20px",
            }}
          >
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: ".08em",
                textTransform: "uppercase",
                color: "var(--ink-faint)",
                flexShrink: 0,
              }}
            >
              Needs attention
            </span>
            {pendingCount > 0 && (
              <Link
                href={`/projects/${project.id}/evidence`}
                style={{
                  fontSize: 13,
                  color: "var(--warn)",
                  fontWeight: 560,
                  textDecoration: "none",
                }}
              >
                {pendingCount} evidence item{pendingCount !== 1 ? "s" : ""} need review
              </Link>
            )}
            {project.synthesis_stale && (
              <form action={onSynthesize} style={{ display: "contents" }}>
                <input type="hidden" name="project_id" value={project.id} />
                <button
                  type="submit"
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    fontSize: 13,
                    color: "var(--accent)",
                    fontWeight: 560,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  New evidence available, run synthesis
                </button>
              </form>
            )}
          </div>
        )}

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
                  <SynthesisSubmitButton isStale={project.synthesis_stale} />
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

        {/* ── 2-col teaser grid ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            alignItems: "start",
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
            href="#research-gaps"
          />
        </div>

        {/* ── Research gaps inline detail ── */}
        {gapSignals && gapSignals.length > 0 && (
          <ResearchGapsCard gapSignals={gapSignals} />
        )}

        {/* ── Problems by evidence band ── */}
        {problemPreviews.length > 0 && (
          <div style={cardStyle}>
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
              <div style={{ fontWeight: 620, fontSize: 14, color: "var(--ink)" }}>
                Problems by evidence
              </div>
              <Link
                href={`/projects/${project.id}/problems`}
                style={{ fontSize: 12, fontWeight: 560, color: "var(--accent)", textDecoration: "none" }}
              >
                View all →
              </Link>
            </div>
            <div>
              {[...problemPreviews]
                .sort((a, b) => b.evidence_link_count - a.evidence_link_count)
                .map((p, i, arr) => (
                  <Link
                    key={p.id}
                    href={`/projects/${project.id}/problems?problem=${p.id}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "12px 20px",
                      borderBottom: i < arr.length - 1 ? "1px solid var(--line)" : "none",
                      textDecoration: "none",
                      transition: "background .12s",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background = "var(--sel)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background = "transparent";
                    }}
                  >
                    <span
                      style={{ flex: 1, fontSize: 13, color: "var(--ink)", fontWeight: 500 }}
                    >
                      {p.title}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        color: p.evidence_link_count > 0 ? "var(--ink-2)" : "var(--ink-faint)",
                        fontFeatureSettings: '"tnum"',
                        flexShrink: 0,
                      }}
                    >
                      {p.evidence_link_count > 0
                        ? `${p.evidence_link_count} evidence`
                        : "no evidence yet"}
                    </span>
                  </Link>
                ))}
            </div>
          </div>
        )}

        {/* ── Suggested workspaces collapsible aside ── */}
        <SuggestedWorkspacesCard
          projectId={project.id}
          workspaces={suggestedWorkspaceRows}
          onCreateFromOpportunity={onCreateFromOpportunity}
          onOpportunityStatus={onOpportunityStatus}
        />


        {/* ── Project context collapsible ── */}
        <ProjectContextCard project={project} />
      </div>
    </div>
  );
}
