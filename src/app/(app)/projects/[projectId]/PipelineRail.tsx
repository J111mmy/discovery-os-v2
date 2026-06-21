"use client";

/**
 * PipelineRail — horizontal stage navigation shared by Sources / Evidence / Problems.
 * Uses usePathname() to highlight the active stage.
 */

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export interface PipelineRailProps {
  projectId: string;
  sourcesCount: number;
  evidenceCount: number;
  problemCount: number;
}

const STEPS = [
  {
    id: "sources",
    label: "Sources",
    desc: "Raw artefacts & transcripts",
    href: (id: string) => `/projects/${id}/sources`,
    matches: (path: string, id: string) => path.startsWith(`/projects/${id}/sources`),
  },
  {
    id: "claims",
    label: "Evidence",
    desc: "Extracted, source-backed",
    href: (id: string) => `/projects/${id}/evidence`,
    matches: (path: string, id: string) => path.startsWith(`/projects/${id}/evidence`),
  },
  {
    id: "problems",
    label: "Problems",
    desc: "Synthesised & prioritised",
    href: (id: string) => `/projects/${id}/problems`,
    matches: (path: string, id: string) => path.startsWith(`/projects/${id}/problems`),
  },
] as const;

export function PipelineRail({
  projectId,
  sourcesCount,
  evidenceCount,
  problemCount,
}: PipelineRailProps) {
  const pathname = usePathname();
  const counts = [sourcesCount, evidenceCount, problemCount];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: 10,
        marginBottom: 26,
        flexWrap: "wrap",
      }}
    >
      {STEPS.map((step, i) => {
        const active = step.matches(pathname, projectId);
        const count = counts[i];

        return (
          <Fragment key={step.id}>
            <Link
              href={step.href(projectId)}
              style={{
                flex: "1 1 160px",
                textAlign: "left",
                padding: "14px 16px",
                borderRadius: 14,
                background: active ? "var(--surface)" : "transparent",
                border: `1px solid ${active ? "var(--line-strong)" : "var(--line)"}`,
                boxShadow: active ? "var(--shadow-sm)" : "none",
                transition: "background .15s, border-color .15s, box-shadow .15s",
                textDecoration: "none",
                display: "block",
              }}
              onMouseEnter={(e) => {
                if (!active) {
                  const el = e.currentTarget as HTMLElement;
                  el.style.background = "var(--sel)";
                  el.style.borderColor = "var(--line-strong)";
                }
              }}
              onMouseLeave={(e) => {
                if (!active) {
                  const el = e.currentTarget as HTMLElement;
                  el.style.background = "transparent";
                  el.style.borderColor = "var(--line)";
                }
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  marginBottom: 7,
                }}
              >
                <span
                  style={{
                    fontWeight: 600,
                    fontSize: 14,
                    color: active ? "var(--ink)" : "var(--ink-2)",
                    flex: 1,
                  }}
                >
                  {step.label}
                </span>
                <span
                  style={{
                    fontSize: 17,
                    fontWeight: 700,
                    letterSpacing: "-0.02em",
                    color: active ? "var(--ink)" : "var(--ink-3)",
                    fontFeatureSettings: '"tnum"',
                  }}
                >
                  {count}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-faint)" }}>
                {step.desc}
              </div>
            </Link>

            {/* Arrow between steps */}
            {i < STEPS.length - 1 && (
              <div
                aria-hidden
                style={{
                  display: "flex",
                  alignItems: "center",
                  color: "var(--ink-faint)",
                  flexShrink: 0,
                }}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M6 12l4-4-4-4" />
                </svg>
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
