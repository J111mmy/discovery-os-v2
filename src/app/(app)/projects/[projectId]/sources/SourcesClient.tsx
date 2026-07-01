"use client";

import { useState } from "react";
import Link from "next/link";
import { AddSourceButton } from "./add-source-button";
import { SourceActions } from "./source-actions";

export type DisplayStatus = "done" | "failed" | "processing" | "pending" | "not_started";

export interface SourceItem {
  id: string;
  title: string;
  typeLabel: string;
  trustLabel: string;
  trustScope: string;
  dateLabel: string;
  displayStatus: DisplayStatus;
  evidenceCount: number;
  hasFailed: boolean;
  isAnalyzing: boolean;
  isQueued: boolean;
  message: string;
}

interface SourcesClientProps {
  projectId: string;
  sources: SourceItem[];
}

function statusStyle(status: DisplayStatus): React.CSSProperties {
  if (status === "done")
    return { borderColor: "var(--pos)", background: "var(--pos-bg)", color: "var(--pos)" };
  if (status === "failed")
    return { borderColor: "var(--neg)", background: "var(--neg-bg)", color: "var(--neg)" };
  if (status === "processing")
    return { borderColor: "var(--warn)", background: "var(--warn-bg)", color: "var(--warn)" };
  return { borderColor: "var(--line)", background: "var(--surface-2)", color: "var(--ink-2)" };
}

function statusLabel(status: DisplayStatus) {
  if (status === "done") return "ready";
  if (status === "failed") return "check needed";
  if (status === "processing") return "analyzing";
  if (status === "pending") return "queued";
  return "not started";
}

function trustPillStyle(scope: string): React.CSSProperties {
  if (scope === "trusted")
    return { borderColor: "var(--pos)", background: "var(--pos-bg)", color: "var(--pos)" };
  if (scope === "excluded")
    return { borderColor: "var(--neg)", background: "var(--neg-bg)", color: "var(--neg)" };
  return { borderColor: "var(--line)", background: "var(--surface-2)", color: "var(--ink-2)" };
}

function StatusPill({ status }: { status: DisplayStatus }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        borderRadius: 999,
        border: "1px solid",
        padding: "2px 8px",
        fontSize: 11,
        fontWeight: 500,
        ...statusStyle(status),
      }}
    >
      {statusLabel(status)}
    </span>
  );
}

function SourceDrawer({
  source,
  projectId,
  onClose,
}: {
  source: SourceItem;
  projectId: string;
  onClose: () => void;
}) {
  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,.32)",
          zIndex: 40,
        }}
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={source.title}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(480px, 95vw)",
          background: "var(--surface)",
          borderLeft: "1px solid var(--line)",
          boxShadow: "var(--shadow-lg)",
          zIndex: 41,
          display: "flex",
          flexDirection: "column",
          animation: "slideL .24s var(--ease)",
          overflowY: "auto",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            padding: "20px 20px 16px",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 8,
                marginBottom: 8,
              }}
            >
              <StatusPill status={source.displayStatus} />
              <span style={{ fontSize: 12, color: "var(--ink-2)" }}>{source.typeLabel}</span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  borderRadius: 999,
                  border: "1px solid",
                  padding: "2px 8px",
                  fontSize: 11,
                  fontWeight: 500,
                  ...trustPillStyle(source.trustScope),
                }}
              >
                {source.trustLabel}
              </span>
            </div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: "var(--ink)",
                lineHeight: 1.4,
                marginBottom: 4,
              }}
            >
              {source.title}
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-faint)" }}>{source.dateLabel}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              flexShrink: 0,
              width: 30,
              height: 30,
              borderRadius: "var(--r-sm)",
              border: "1px solid var(--line)",
              background: "transparent",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--ink-2)",
              fontSize: 18,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* Stats strip */}
        <div
          style={{
            display: "flex",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <div
            style={{
              flex: 1,
              padding: "14px 20px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: "var(--ink)",
                letterSpacing: "-0.02em",
                fontFeatureSettings: '"tnum"',
              }}
            >
              {source.evidenceCount}
            </div>
            <div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 2 }}>
              evidence records
            </div>
          </div>
          <div style={{ width: 1, background: "var(--line)", margin: "10px 0" }} />
          <div
            style={{
              flex: 1,
              padding: "14px 20px",
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                borderRadius: 999,
                border: "1px solid",
                padding: "3px 10px",
                fontSize: 12,
                fontWeight: 500,
                ...trustPillStyle(source.trustScope),
              }}
            >
              {source.trustLabel}
            </span>
            <div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 4 }}>
              trust scope
            </div>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, padding: "20px" }}>
          <p
            style={{
              fontSize: 13,
              color: "var(--ink-2)",
              lineHeight: 1.6,
              margin: "0 0 24px",
            }}
          >
            {source.message}
          </p>

          <SourceActions
            projectId={projectId}
            sourceId={source.id}
            showRetry={source.hasFailed}
          />
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "16px 20px",
            borderTop: "1px solid var(--line)",
          }}
        >
          <Link
            href={`/projects/${projectId}/sources/${source.id}`}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: 13,
              fontWeight: 500,
              color: "var(--ink)",
              textDecoration: "none",
              padding: "10px 14px",
              borderRadius: "var(--r-sm)",
              border: "1px solid var(--line)",
              transition: "border-color .15s, background .15s",
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLElement;
              el.style.borderColor = "var(--line-strong)";
              el.style.background = "var(--sel)";
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLElement;
              el.style.borderColor = "var(--line)";
              el.style.background = "transparent";
            }}
          >
            <span>View full source</span>
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 12l4-4-4-4" />
            </svg>
          </Link>
        </div>
      </div>
    </>
  );
}

export function SourcesClient({ projectId, sources }: SourcesClientProps) {
  const [openSource, setOpenSource] = useState<SourceItem | null>(null);

  if (sources.length === 0) {
    return (
      <div
        style={{
          borderRadius: 14,
          border: "1px solid var(--line)",
          background: "var(--surface)",
          padding: "48px 24px",
          textAlign: "center",
        }}
      >
        <div
          style={{ fontSize: 14, fontWeight: 500, color: "var(--ink)", marginBottom: 8 }}
        >
          No sessions yet
        </div>
        <p
          style={{
            fontSize: 13,
            color: "var(--ink-2)",
            maxWidth: 400,
            margin: "0 auto 20px",
            lineHeight: 1.6,
          }}
        >
          Add a transcript, document, or note to start creating source-backed evidence.
        </p>
        <AddSourceButton
          projectId={projectId}
          style={{
            display: "inline-flex",
            padding: "8px 18px",
            borderRadius: "var(--r-sm)",
            background: "var(--accent)",
            color: "#fff",
            fontSize: 13,
            fontWeight: 500,
            textDecoration: "none",
            border: "0",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Add your first transcript →
        </AddSourceButton>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: "grid", gap: 10 }}>
        {sources.map((source) => (
          <button
            key={source.id}
            type="button"
            onClick={() => setOpenSource(source)}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: "16px 18px",
              borderRadius: 14,
              border: "1px solid var(--line)",
              background: "var(--surface)",
              cursor: "pointer",
              transition: "border-color .15s, background .15s",
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLElement;
              el.style.borderColor = "var(--line-strong)";
              el.style.background = "var(--sel)";
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLElement;
              el.style.borderColor = "var(--line)";
              el.style.background = "var(--surface)";
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  <StatusPill status={source.displayStatus} />
                  <span style={{ fontSize: 12, color: "var(--ink-2)" }}>{source.typeLabel}</span>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      borderRadius: 999,
                      border: "1px solid",
                      padding: "2px 8px",
                      fontSize: 11,
                      fontWeight: 500,
                      ...trustPillStyle(source.trustScope),
                    }}
                  >
                    {source.trustLabel}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>{source.dateLabel}</span>
                </div>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: "var(--ink)",
                    marginBottom: 5,
                  }}
                >
                  {source.title}
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-2)" }}>{source.message}</div>
              </div>
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ flexShrink: 0, color: "var(--ink-faint)", marginTop: 2 }}
              >
                <path d="M6 12l4-4-4-4" />
              </svg>
            </div>
          </button>
        ))}
      </div>

      {openSource && (
        <SourceDrawer
          source={openSource}
          projectId={projectId}
          onClose={() => setOpenSource(null)}
        />
      )}
    </>
  );
}
