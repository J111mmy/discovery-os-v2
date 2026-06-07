"use client";

/**
 * DirectoryList — unified list + right-panel drawer for People / Companies / Competitors.
 *
 * All data is fetched server-side and passed as props; no client data fetching.
 * Clicking a row opens a slide-in drawer with entity preview + "View full profile →"
 * link to the existing detail page (which preserves affiliation/digest/synthesis wiring).
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface DirectoryItem {
  id: string;
  name: string;
  /** e.g. "role · company" for person, domain for company, website for competitor */
  subtitle: string | null;
  /** short right-side meta: "3 projects", "2 mentions" etc */
  meta: string | null;
  badge?: {
    label: string;
    tone: "pos" | "warn" | "neg" | "info" | "neutral";
  };
  projectLinks: Array<{ id: string; name: string }>;
  detailHref: string;
  /** Additional text shown in drawer (positioning blurb, affiliation note, etc.) */
  detail?: string | null;
  evidenceCount?: number;
  kind: "person" | "company" | "competitor";
}

export interface DirectoryListProps {
  title: string;
  lead: string;
  searchPlaceholder: string;
  items: DirectoryItem[];
  emptyMessage: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");
}

const TINTS = [
  "#5b63f0",
  "#2fb574",
  "#d8a13a",
  "#e0594f",
  "#4a9fe0",
  "#c084fc",
  "#f06292",
  "#26c6da",
];

function getTint(name: string): string {
  let h = 0;
  for (const c of name) h = ((h * 31 + c.charCodeAt(0)) | 0);
  return TINTS[Math.abs(h) % TINTS.length];
}

const BADGE_STYLES: Record<
  string,
  { border: string; background: string; color: string }
> = {
  pos:     { border: "1px solid rgba(47,181,116,.2)",  background: "var(--pos-bg)",  color: "var(--pos)" },
  warn:    { border: "1px solid rgba(212,163,42,.2)",  background: "var(--warn-bg)", color: "var(--warn)" },
  neg:     { border: "1px solid rgba(224,89,79,.2)",   background: "var(--neg-bg)",  color: "var(--neg)" },
  info:    { border: "1px solid rgba(74,159,224,.2)",  background: "var(--info-bg)", color: "var(--info)" },
  neutral: { border: "1px solid var(--line)", background: "var(--surface-2)", color: "var(--ink-2)" },
};

// ─────────────────────────────────────────────────────────────────────────────
// Avatar (circular — people)
// ─────────────────────────────────────────────────────────────────────────────

function Avatar({
  name,
  size,
}: {
  name: string;
  size: number;
}) {
  const initials = getInitials(name);
  const tint = getTint(name);
  return (
    <div
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: `${tint}22`,
        color: tint,
        display: "grid",
        placeItems: "center",
        fontWeight: 700,
        fontSize: size * 0.38,
        flexShrink: 0,
        userSelect: "none",
        letterSpacing: "-0.01em",
      }}
    >
      {initials}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Logo (rounded square — companies / competitors)
// ─────────────────────────────────────────────────────────────────────────────

function Logo({
  name,
  size,
}: {
  name: string;
  size: number;
}) {
  const initials = getInitials(name).slice(0, 1);
  const tint = getTint(name);
  return (
    <div
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.27,
        background: `${tint}1f`,
        color: tint,
        display: "grid",
        placeItems: "center",
        fontWeight: 700,
        fontSize: size * 0.4,
        flexShrink: 0,
        userSelect: "none",
      }}
    >
      {initials}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EntityDrawer
// ─────────────────────────────────────────────────────────────────────────────

function EntityDrawer({
  item,
  onClose,
}: {
  item: DirectoryItem;
  onClose: () => void;
}) {
  // Escape to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isPerson = item.kind === "person";

  return (
    <div
      role="dialog"
      aria-modal
      aria-label={item.name}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        background: "rgba(5,8,18,0.45)",
        backdropFilter: "blur(3px)",
        animation: "fadeIn .18s",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(600px, 92vw)",
          background: "var(--surface)",
          borderLeft: "1px solid var(--line-strong)",
          boxShadow: "var(--shadow-lg)",
          display: "flex",
          flexDirection: "column",
          animation: "slideL .24s var(--ease)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "20px 24px",
            borderBottom: "1px solid var(--line)",
            flexShrink: 0,
          }}
        >
          {isPerson ? (
            <Avatar name={item.name} size={52} />
          ) : (
            <Logo name={item.name} size={52} />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontWeight: 660,
                fontSize: 19,
                letterSpacing: "-0.015em",
                color: "var(--ink)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {item.name}
            </div>
            {item.subtitle && (
              <div
                style={{
                  fontSize: 13,
                  color: "var(--ink-3)",
                  marginTop: 3,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {item.subtitle}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 32,
              height: 32,
              display: "grid",
              placeItems: "center",
              borderRadius: "var(--r-sm)",
              border: "none",
              background: "transparent",
              color: "var(--ink-3)",
              cursor: "pointer",
              fontSize: 20,
              lineHeight: 1,
              flexShrink: 0,
              transition: ".13s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "var(--sel)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
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
            flexShrink: 0,
          }}
        >
          {[
            item.projectLinks.length > 0
              ? {
                  label: "Projects",
                  value: String(item.projectLinks.length),
                }
              : null,
            item.evidenceCount !== undefined
              ? {
                  label: item.kind === "competitor" ? "Mentions" : "Evidence",
                  value: String(item.evidenceCount),
                }
              : null,
            item.badge
              ? { label: "Status", value: item.badge.label }
              : null,
          ]
            .filter(Boolean)
            .slice(0, 3)
            .map((stat, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  padding: "13px 16px",
                  borderLeft: i ? "1px solid var(--line)" : "none",
                }}
              >
                <div
                  style={{
                    fontSize: 10.5,
                    letterSpacing: ".1em",
                    textTransform: "uppercase",
                    color: "var(--ink-faint)",
                    fontWeight: 700,
                    marginBottom: 4,
                  }}
                >
                  {stat!.label}
                </div>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    color: "var(--ink)",
                  }}
                >
                  {stat!.value}
                </div>
              </div>
            ))}
        </div>

        {/* Body */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "22px 24px",
            display: "flex",
            flexDirection: "column",
            gap: 20,
          }}
        >
          {/* Detail / positioning blurb */}
          {item.detail && (
            <div>
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: ".1em",
                  textTransform: "uppercase",
                  color: "var(--ink-faint)",
                  fontWeight: 700,
                  marginBottom: 10,
                }}
              >
                {item.kind === "competitor" ? "Positioning" : "Notes"}
              </div>
              <p
                style={{
                  fontSize: 13.5,
                  color: "var(--ink-2)",
                  lineHeight: 1.6,
                  margin: 0,
                  background: "var(--surface-2)",
                  border: "1px solid var(--line)",
                  borderRadius: "var(--r-md)",
                  padding: "12px 14px",
                }}
              >
                {item.detail}
              </p>
            </div>
          )}

          {/* Project links */}
          {item.projectLinks.length > 0 && (
            <div>
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: ".1em",
                  textTransform: "uppercase",
                  color: "var(--ink-faint)",
                  fontWeight: 700,
                  marginBottom: 10,
                }}
              >
                Projects ({item.projectLinks.length})
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {item.projectLinks.map((p) => (
                  <Link
                    key={p.id}
                    href={`/projects/${p.id}`}
                    onClick={onClose}
                    style={{
                      padding: "5px 12px",
                      borderRadius: 999,
                      border: "1px solid var(--line)",
                      background: "var(--surface-2)",
                      fontSize: 12.5,
                      fontWeight: 500,
                      color: "var(--ink-2)",
                      textDecoration: "none",
                      transition: ".13s",
                    }}
                    onMouseEnter={(e) => {
                      const el = e.currentTarget as HTMLElement;
                      el.style.borderColor =
                        "color-mix(in srgb, var(--accent) 50%, transparent)";
                      el.style.color = "var(--accent)";
                    }}
                    onMouseLeave={(e) => {
                      const el = e.currentTarget as HTMLElement;
                      el.style.borderColor = "var(--line)";
                      el.style.color = "var(--ink-2)";
                    }}
                  >
                    {p.name}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {item.projectLinks.length === 0 && !item.detail && (
            <p
              style={{
                fontSize: 13.5,
                color: "var(--ink-faint)",
                lineHeight: 1.6,
              }}
            >
              No project links or notes yet. Full details are on the profile
              page.
            </p>
          )}
        </div>

        {/* Footer — full profile link */}
        <div
          style={{
            padding: "14px 24px",
            borderTop: "1px solid var(--line)",
            flexShrink: 0,
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <Link
            href={item.detailHref}
            onClick={onClose}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "9px 18px",
              borderRadius: "var(--r-md)",
              background: "var(--accent)",
              color: "#fff",
              fontWeight: 580,
              fontSize: 13.5,
              textDecoration: "none",
              transition: "opacity .14s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.opacity = "0.85";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.opacity = "1";
            }}
          >
            View full profile →
          </Link>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EntityRow
// ─────────────────────────────────────────────────────────────────────────────

function EntityRow({
  item,
  onClick,
}: {
  item: DirectoryItem;
  onClick: () => void;
}) {
  const isPerson = item.kind === "person";

  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        width: "100%",
        textAlign: "left",
        padding: "14px 18px",
        border: "none",
        borderBottom: "1px solid var(--line)",
        background: "transparent",
        cursor: "pointer",
        transition: "background .12s",
        fontFamily: "inherit",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = "var(--sel)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = "transparent";
      }}
    >
      {/* Avatar or logo */}
      {isPerson ? (
        <Avatar name={item.name} size={40} />
      ) : (
        <Logo name={item.name} size={40} />
      )}

      {/* Name + subtitle */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontWeight: 580,
            fontSize: 14.5,
            color: "var(--ink)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {item.name}
        </div>
        {item.subtitle && (
          <div
            style={{
              fontSize: 12.5,
              color: "var(--ink-3)",
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {item.subtitle}
          </div>
        )}
      </div>

      {/* Badge + meta + chevron */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexShrink: 0,
        }}
      >
        {item.badge && (
          <span
            style={{
              padding: "2px 9px",
              borderRadius: 999,
              fontSize: 11.5,
              fontWeight: 500,
              ...BADGE_STYLES[item.badge.tone],
            }}
          >
            {item.badge.label}
          </span>
        )}
        {item.meta && (
          <span
            style={{
              fontSize: 12.5,
              color: "var(--ink-faint)",
              whiteSpace: "nowrap",
            }}
          >
            {item.meta}
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
          aria-hidden
        >
          <path d="M6 12l4-4-4-4" />
        </svg>
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DirectoryList — main export
// ─────────────────────────────────────────────────────────────────────────────

export function DirectoryList({
  title,
  lead,
  searchPlaceholder,
  items,
  emptyMessage,
}: DirectoryListProps) {
  const [q, setQ] = useState("");
  const [openItem, setOpenItem] = useState<DirectoryItem | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = q.trim()
    ? items.filter((it) =>
        it.name.toLowerCase().includes(q.toLowerCase()) ||
        it.subtitle?.toLowerCase().includes(q.toLowerCase())
      )
    : items;

  return (
    <>
      <div
        style={{
          maxWidth: 860,
          margin: "0 auto",
          padding: "32px 20px",
        }}
      >
        {/* Header row */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 20,
            marginBottom: 24,
            flexWrap: "wrap",
          }}
        >
          <div>
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
              Directory
            </div>
            <h1
              style={{
                fontSize: 24,
                fontWeight: 640,
                color: "var(--ink)",
                letterSpacing: "-0.02em",
                margin: 0,
              }}
            >
              {title}
            </h1>
            <p
              style={{
                marginTop: 6,
                fontSize: 13.5,
                color: "var(--ink-3)",
                lineHeight: 1.6,
              }}
            >
              {lead}
            </p>
          </div>

          {/* Search */}
          <div style={{ position: "relative", flexShrink: 0 }}>
            <svg
              width="15"
              height="15"
              viewBox="0 0 20 20"
              fill="none"
              stroke="var(--ink-faint)"
              strokeWidth="1.6"
              strokeLinecap="round"
              aria-hidden
              style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)" }}
            >
              <circle cx="8.5" cy="8.5" r="5.5" />
              <path d="m14.5 14.5 3 3" />
            </svg>
            <input
              ref={searchRef}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={searchPlaceholder}
              style={{
                width: 220,
                padding: "10px 12px 10px 34px",
                borderRadius: 10,
                background: "var(--surface-2)",
                border: "1px solid var(--line)",
                color: "var(--ink)",
                fontSize: 13.5,
                outline: "none",
                fontFamily: "inherit",
                transition: "border-color .14s",
              }}
              onFocus={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor =
                  "var(--line-strong)";
              }}
              onBlur={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor =
                  "var(--line)";
              }}
            />
          </div>
        </div>

        {/* List */}
        {items.length === 0 ? (
          <div
            style={{
              borderRadius: "var(--r-lg)",
              border: "1px solid var(--line)",
              background: "var(--surface)",
              padding: "48px 20px",
              textAlign: "center",
              fontSize: 13.5,
              color: "var(--ink-faint)",
              lineHeight: 1.6,
            }}
          >
            {emptyMessage}
          </div>
        ) : (
          <div
            style={{
              borderRadius: "var(--r-lg)",
              border: "1px solid var(--line)",
              background: "var(--surface)",
              overflow: "hidden",
            }}
          >
            {filtered.length === 0 ? (
              <div
                style={{
                  padding: "32px 20px",
                  textAlign: "center",
                  color: "var(--ink-3)",
                  fontSize: 14,
                }}
              >
                No results for &ldquo;{q}&rdquo;
              </div>
            ) : (
              filtered.map((item) => (
                <EntityRow
                  key={item.id}
                  item={item}
                  onClick={() => setOpenItem(item)}
                />
              ))
            )}
          </div>
        )}
      </div>

      {/* Drawer */}
      {openItem && (
        <EntityDrawer item={openItem} onClose={() => setOpenItem(null)} />
      )}
    </>
  );
}
