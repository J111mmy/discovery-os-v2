"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

// ── Types ──────────────────────────────────────────────────────────
export interface RailProject {
  id: string;
  name: string;
}

export interface RailProps {
  userEmail: string;
  superAdmin?: boolean;
  projects: RailProject[];
  dirCounts: { people: number; companies: number; competitors: number };
}

type Theme = "dark" | "light";

// ── Project dot colours (cycle when DB has no colour) ─────────────
const DOT_COLORS = [
  "#5b63f0", // indigo
  "#2fb574", // green
  "#d8a13a", // amber
  "#e0594f", // red
  "#4a9fe0", // blue
  "#c084fc", // violet
];

// ── Sub-nav for an active project ─────────────────────────────────
// Routes that exist today and are wired.
const PROJECT_NAV = [
  { id: "workspace", label: "Workspace", href: "" },
  { id: "evidence",  label: "Evidence",  href: "evidence" },
  { id: "ask",       label: "Ask",        href: "ask" },
  { id: "problems",  label: "Problems",   href: "problems" },
  { id: "sources",   label: "Sources",    href: "sources" },
  { id: "compose",   label: "Compose",    href: "compose" },
  { id: "documents", label: "Documents",  href: "documents" },
  { id: "settings",  label: "Settings",   href: "settings" },
];

// ── Directory items ────────────────────────────────────────────────
const DIR_ITEMS = [
  { id: "people",      label: "People",      href: "/people" },
  { id: "companies",   label: "Companies",   href: "/companies" },
  { id: "competitors", label: "Competitors", href: "/competitors" },
];

// ══════════════════════════════════════════════════════════════════
// SVG icons — hairline stroke, neutral style
// ══════════════════════════════════════════════════════════════════

function IcoChevronLeft({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 12L6 8l4-4" />
    </svg>
  );
}

function IcoChevronRight({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 12l4-4-4-4" />
    </svg>
  );
}

function IcoSearch({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="8.5" cy="8.5" r="5.5" />
      <path d="m14.5 14.5 3 3" />
    </svg>
  );
}

function IcoGrid({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <rect x="1.5" y="1.5" width="5" height="5" rx="1" />
      <rect x="9.5" y="1.5" width="5" height="5" rx="1" />
      <rect x="1.5" y="9.5" width="5" height="5" rx="1" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
    </svg>
  );
}

function IcoPlus({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M10 4v12M4 10h12" />
    </svg>
  );
}

function IcoPeople({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7.5" cy="6" r="3" />
      <path d="M1.5 18c0-3.314 2.686-6 6-6s6 2.686 6 6" />
      <path d="M14 4a3 3 0 010 6" />
      <path d="M18 18a5.994 5.994 0 00-2.5-4.9" />
    </svg>
  );
}

function IcoCompanies({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="16" height="12" rx="1" />
      <path d="M6 7V5a1 1 0 011-1h6a1 1 0 011 1v2" />
      <path d="M7 12v3M10 12v3M13 12v3" />
    </svg>
  );
}

function IcoCompetitors({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="8" />
      <polyline points="10 6 10 10 13 13" />
    </svg>
  );
}

function IcoSettings({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 1v2.5M10 16.5V19M4.22 4.22l1.77 1.77M14.01 14.01l1.77 1.77M1 10h2.5M16.5 10H19M4.22 15.78l1.77-1.77M14.01 5.99l1.77-1.77" />
    </svg>
  );
}

function IcoSignOut({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 4h4a1 1 0 011 1v10a1 1 0 01-1 1h-4M8 14l4-4-4-4M12 10H3" />
    </svg>
  );
}

function IcoSun({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="6" /><line x1="12" y1="18" x2="12" y2="22" />
      <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" /><line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
      <line x1="2" y1="12" x2="6" y2="12" /><line x1="18" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" /><line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
    </svg>
  );
}

function IcoMoon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

// ── Dir item icon map ─────────────────────────────────────────────
const DIR_ICON: Record<string, (props: { size?: number }) => JSX.Element> = {
  people:      IcoPeople,
  companies:   IcoCompanies,
  competitors: IcoCompetitors,
};

// ── Avatar initials from email ─────────────────────────────────────
function getInitials(email: string): string {
  return email
    .split("@")[0]
    .split(/[._\-+]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("") || "?";
}

function AvatarDot({ email, size = 30 }: { email: string; size?: number }) {
  return (
    <div
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "var(--accent-soft)",
        color: "var(--accent)",
        display: "grid",
        placeItems: "center",
        fontSize: size * 0.38,
        fontWeight: 640,
        flexShrink: 0,
        userSelect: "none",
      }}
    >
      {getInitials(email)}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// NewProjectModal
// ══════════════════════════════════════════════════════════════════

function NewProjectModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [focus, setFocus] = useState("");

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="New project"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 80,
        background: "rgba(5,8,18,0.6)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20, animation: "fadeIn .18s",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 460,
          background: "var(--surface)", border: "1px solid var(--line)",
          borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-lg)",
          overflow: "hidden", animation: "popIn .2s var(--ease)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "18px 22px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: "var(--accent-soft)", color: "var(--accent)", display: "grid", placeItems: "center" }}>
            <IcoPlus size={18} />
          </div>
          <div>
            <div style={{ fontWeight: 640, fontSize: 16, color: "var(--ink)" }}>New project</div>
            <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 1 }}>Create a discovery workspace for a new research focus.</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ marginLeft: "auto", width: 30, height: 30, display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", border: "none", background: "transparent", color: "var(--ink-3)", cursor: "pointer", fontSize: 18, lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ fontSize: 13, fontWeight: 540, color: "var(--ink-2)", display: "block", marginBottom: 7 }}>Project name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Formwork Hire Discovery"
              style={{ width: "100%", padding: "11px 13px", borderRadius: 10, background: "var(--surface-2)", border: "1px solid var(--line)", color: "var(--ink)", fontSize: 14, outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
            />
          </div>
          <div>
            <label style={{ fontSize: 13, fontWeight: 540, color: "var(--ink-2)", display: "block", marginBottom: 7 }}>What are you trying to learn?</label>
            <textarea
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              placeholder="Describe the research focus…"
              rows={3}
              style={{ width: "100%", padding: "11px 13px", borderRadius: 10, background: "var(--surface-2)", border: "1px solid var(--line)", color: "var(--ink)", fontSize: 13.5, resize: "vertical", outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
            />
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 22px", borderTop: "1px solid var(--line)", background: "var(--surface-2)" }}>
          <button
            onClick={onClose}
            style={{ padding: "9px 14px", borderRadius: "var(--r-sm)", background: "var(--surface-2)", border: "1px solid var(--line)", color: "var(--ink)", fontWeight: 540, fontSize: 13.5, cursor: "pointer", fontFamily: "inherit" }}
          >
            Cancel
          </button>
          <Link
            href={`/projects/new${name ? `?name=${encodeURIComponent(name)}` : ""}`}
            onClick={onClose}
            style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", borderRadius: "var(--r-md)", background: "var(--accent)", color: "#fff", fontWeight: 580, fontSize: 14, textDecoration: "none" }}
          >
            <IcoPlus size={15} /> Create project
          </Link>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// Rail — main component
// ══════════════════════════════════════════════════════════════════

export function Rail({ userEmail, superAdmin, projects, dirCounts }: RailProps) {
  const pathname = usePathname();
  const router = useRouter();

  // Detect active project from URL: /projects/[projectId]/...
  const activeProjectId = pathname.match(/^\/projects\/([^/]+)/)?.[1] ?? null;
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;

  // Detect which directory item is active
  const activeDirId = DIR_ITEMS.find((d) => pathname.startsWith(d.href))?.id ?? null;
  const isSettingsActive = pathname.startsWith("/settings");

  const [collapsed, setCollapsed] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [newProjOpen, setNewProjOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>("dark");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const avatarRef = useRef<HTMLDivElement>(null);

  // Read persisted theme on mount
  useEffect(() => {
    const t =
      (document.documentElement.getAttribute("data-theme") as Theme) ||
      (localStorage.getItem("discos-theme") as Theme) ||
      "dark";
    setTheme(t);
  }, []);

  // Close avatar popover on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) {
        setAvatarOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function applyTheme(next: Theme) {
    setTheme(next);
    localStorage.setItem("discos-theme", next);
    document.documentElement.setAttribute("data-theme", next);
  }

  // ── Project sub-nav item ───────────────────────────────────────
  function ProjectNavItem({ item, projectId, color }: { item: typeof PROJECT_NAV[number]; projectId: string; color: string }) {
    const href = item.href ? `/projects/${projectId}/${item.href}` : `/projects/${projectId}`;
    const on = item.href
      ? pathname.startsWith(`/projects/${projectId}/${item.href}`)
      : pathname === `/projects/${projectId}`;

    return (
      <Link
        href={href}
        style={{
          display: "flex", alignItems: "center", gap: 9,
          padding: "7px 9px", borderRadius: 7,
          textDecoration: "none", transition: ".13s",
          background: on ? "var(--nav-active-bg)" : "transparent",
          color: on ? "var(--ink)" : "var(--ink-3)",
          fontWeight: on ? 620 : 480, fontSize: 13.5,
          position: "relative",
        }}
      >
        {on && (
          <span style={{
            position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)",
            width: 3, height: 14, borderRadius: "0 3px 3px 0", background: color,
          }} />
        )}
        <span style={{ paddingLeft: on ? 3 : 0 }}>{item.label}</span>
      </Link>
    );
  }

  // ── COLLAPSED strip (52px) ─────────────────────────────────────
  if (collapsed) {
    return (
      <>
        <div
          className="rail-collapsed"
          style={{
            width: 52, flexShrink: 0,
            borderRight: "1px solid var(--line)",
            display: "flex", flexDirection: "column", alignItems: "center",
            padding: "8px 0 14px",
            background: "color-mix(in srgb, var(--surface) 92%, transparent)",
            height: "100%",
            overflowY: "auto",
          }}
        >
          {/* Expand */}
          <button
            onClick={() => setCollapsed(false)}
            title="Expand sidebar"
            aria-label="Expand sidebar"
            style={colIconBtn}
          >
            <IcoChevronRight size={13} />
          </button>

          <div style={divider} />

          {/* Active project sub-items (icon-only strip) */}
          {activeProject && (
            <>
              {PROJECT_NAV.slice(0, 3).map((item) => {
                const href = item.href ? `/projects/${activeProjectId}/${item.href}` : `/projects/${activeProjectId}`;
                const on = item.href
                  ? pathname.startsWith(`/projects/${activeProjectId}/${item.href}`)
                  : pathname === `/projects/${activeProjectId}`;
                const color = DOT_COLORS[projects.findIndex((p) => p.id === activeProjectId) % DOT_COLORS.length];
                return (
                  <Link key={item.id} href={href} title={item.label}
                    style={{ ...colIconBtn, color: on ? color : "var(--ink-3)", background: on ? "var(--sel)" : "transparent", textDecoration: "none" }}>
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em" }}>
                      {item.label.slice(0, 2)}
                    </span>
                  </Link>
                );
              })}
              <div style={divider} />
            </>
          )}

          {/* Directory */}
          {DIR_ITEMS.map((d) => {
            const on = activeDirId === d.id;
            const DirIcon = DIR_ICON[d.id];
            return (
              <button key={d.id} title={d.label} onClick={() => router.push(d.href)}
                style={{ ...colIconBtn, color: on ? "var(--accent)" : "var(--ink-3)", background: on ? "var(--sel)" : "transparent" }}>
                <DirIcon size={18} />
              </button>
            );
          })}

          {/* Spacer */}
          <div style={{ flex: 1 }} />
          <div style={divider} />

          {/* Theme */}
          <button
            title={theme === "dark" ? "Switch to light" : "Switch to dark"}
            onClick={() => applyTheme(theme === "dark" ? "light" : "dark")}
            style={{ ...colIconBtn, color: "var(--ink-3)" }}
          >
            {theme === "dark" ? <IcoSun size={17} /> : <IcoMoon size={17} />}
          </button>

          {/* Add evidence */}
          <Link
            href={activeProject ? `/projects/${activeProjectId}/ingest` : "/projects"}
            title="Add evidence"
            style={{
              width: 34, height: 34, borderRadius: "50%",
              background: "var(--accent)", color: "#fff",
              display: "grid", placeItems: "center",
              textDecoration: "none", margin: "4px 0",
              boxShadow: "0 4px 14px -6px var(--accent)",
              flexShrink: 0,
            }}
          >
            <IcoPlus size={17} />
          </Link>

          {/* Avatar */}
          <button
            title="Settings"
            onClick={() => router.push("/settings")}
            style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0, marginTop: 4 }}
          >
            <AvatarDot email={userEmail} size={28} />
          </button>
        </div>

        {newProjOpen && <NewProjectModal onClose={() => setNewProjOpen(false)} />}
      </>
    );
  }

  // ── EXPANDED rail (240px) ──────────────────────────────────────
  return (
    <>
      <div
        className="rail-expanded"
        style={{
          width: 240, flexShrink: 0,
          borderRight: "1px solid var(--line)",
          display: "flex", flexDirection: "column",
          background: "color-mix(in srgb, var(--surface) 92%, transparent)",
          height: "100%",
          overflow: "hidden",
        }}
      >
        {/* ── Top row: collapse + search ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "9px 10px 8px", borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
          <button
            onClick={() => setCollapsed(true)}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
            style={{
              width: 28, height: 28, display: "grid", placeItems: "center",
              borderRadius: 7, border: "none", background: "transparent",
              color: "var(--ink-faint)", cursor: "pointer", transition: ".13s", flexShrink: 0,
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--sel)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          >
            <IcoChevronLeft size={13} />
          </button>
          {/* Search bar — visual affordance only (⌘K wires in Phase 2) */}
          <button
            style={{
              flex: 1, display: "flex", alignItems: "center", gap: 7,
              padding: "5px 9px", borderRadius: 7,
              background: "var(--surface-2)", border: "1px solid var(--line)",
              color: "var(--ink-faint)", fontSize: 12.5, cursor: "pointer",
              transition: ".14s", minWidth: 0,
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--line-strong)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--line)"; }}
          >
            <IcoSearch size={12} />
            <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Search…</span>
            <span style={{ fontSize: 10, opacity: 0.6, fontFamily: "var(--font-mono)" }}>⌘K</span>
          </button>
        </div>

        {/* ── Scrollable body ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 8px 0" }}>

          {/* Projects */}
          <div style={{ marginBottom: 10 }}>
            {projects.map((p, i) => {
              const isActive = p.id === activeProjectId;
              const color = DOT_COLORS[i % DOT_COLORS.length];

              return (
                <div key={p.id} style={isActive ? {
                  background: "var(--surface-2)", border: "1px solid var(--line)",
                  borderRadius: 10, marginBottom: 4, overflow: "hidden",
                } : { marginBottom: 2 }}>
                  {isActive ? (
                    <>
                      {/* Active project label (non-interactive) */}
                      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 10px 6px", cursor: "default" }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0, boxShadow: `0 0 0 3px ${color}22` }} />
                        <span style={{ flex: 1, fontWeight: 640, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", letterSpacing: "-0.01em", color: "var(--ink)" }}>
                          {p.name}
                        </span>
                      </div>
                      {/* Sub-nav items */}
                      <div style={{ padding: "0 5px 8px" }}>
                        {PROJECT_NAV.map((item) => (
                          <ProjectNavItem key={item.id} item={item} projectId={p.id} color={color} />
                        ))}
                      </div>
                    </>
                  ) : (
                    <Link
                      href={`/projects/${p.id}`}
                      style={{
                        display: "flex", alignItems: "center", gap: 9,
                        padding: "8px 10px", borderRadius: 9,
                        textDecoration: "none", transition: ".13s",
                        color: "var(--ink-3)", fontSize: 13.5,
                        background: "transparent",
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--sel)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                    >
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0, opacity: 0.7 }} />
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                    </Link>
                  )}
                </div>
              );
            })}

            {/* All projects · New */}
            <div style={{ display: "flex", gap: 2, padding: "2px 4px" }}>
              <Link
                href="/projects"
                style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--ink-faint)", padding: "4px 7px", borderRadius: "var(--r-sm)", textDecoration: "none", transition: ".13s" }}
                onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; el.style.color = "var(--ink)"; el.style.background = "var(--sel)"; }}
                onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.color = "var(--ink-faint)"; el.style.background = "transparent"; }}
              >
                <IcoGrid size={11} /> All projects
              </Link>
              <button
                onClick={() => setNewProjOpen(true)}
                style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--ink-faint)", padding: "4px 7px", borderRadius: "var(--r-sm)", border: "none", background: "transparent", cursor: "pointer", transition: ".13s", fontFamily: "inherit" }}
                onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; el.style.color = "var(--ink)"; el.style.background = "var(--sel)"; }}
                onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.color = "var(--ink-faint)"; el.style.background = "transparent"; }}
              >
                <IcoPlus size={11} /> New
              </button>
            </div>
          </div>

          {/* ── Directory ── */}
          <div style={{ borderTop: "1px solid var(--line)", paddingTop: 10, marginTop: 4 }}>
            <div style={{ fontSize: 10.5, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--ink-faint)", fontWeight: 700, padding: "0 10px 6px" }}>
              Directory
            </div>
            {DIR_ITEMS.map((d) => {
              const on = activeDirId === d.id;
              const count = dirCounts[d.id as keyof typeof dirCounts];
              const DirIcon = DIR_ICON[d.id];
              return (
                <Link
                  key={d.id}
                  href={d.href}
                  style={{
                    display: "flex", alignItems: "center", gap: 11,
                    padding: "8px 10px", borderRadius: "var(--r-sm)",
                    textDecoration: "none", transition: "background .14s, color .14s",
                    color: on ? "var(--ink)" : "var(--ink-2)",
                    fontWeight: on ? 580 : 500, fontSize: 14,
                    background: on ? "var(--sel)" : "transparent",
                  }}
                  onMouseEnter={(e) => { if (!on) { const el = e.currentTarget as HTMLElement; el.style.background = "var(--sel)"; el.style.color = "var(--ink)"; } }}
                  onMouseLeave={(e) => { if (!on) { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; el.style.color = "var(--ink-2)"; } }}
                >
                  <DirIcon size={16} />
                  <span style={{ flex: 1 }}>{d.label}</span>
                  {count > 0 && (
                    <span style={{ fontSize: 11.5, fontWeight: 500, color: "var(--ink-faint)", fontFamily: "var(--font-mono)" }}>
                      {count}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>

          {/* ── Account ── */}
          <div style={{ borderTop: "1px solid var(--line)", paddingTop: 10, marginTop: 10, marginBottom: 4 }}>
            <div style={{ fontSize: 10.5, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--ink-faint)", fontWeight: 700, padding: "0 10px 6px" }}>
              Account
            </div>
            <Link
              href="/settings"
              style={{
                display: "flex", alignItems: "center", gap: 11,
                padding: "8px 10px", borderRadius: "var(--r-sm)",
                textDecoration: "none", transition: "background .14s, color .14s",
                color: isSettingsActive ? "var(--ink)" : "var(--ink-2)",
                fontWeight: isSettingsActive ? 580 : 500, fontSize: 14,
                background: isSettingsActive ? "var(--sel)" : "transparent",
              }}
              onMouseEnter={(e) => { if (!isSettingsActive) { const el = e.currentTarget as HTMLElement; el.style.background = "var(--sel)"; el.style.color = "var(--ink)"; } }}
              onMouseLeave={(e) => { if (!isSettingsActive) { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; el.style.color = "var(--ink-2)"; } }}
            >
              <IcoSettings size={16} />
              <span>Settings</span>
            </Link>

            {superAdmin && (
              <Link
                href="/admin"
                style={{
                  display: "flex", alignItems: "center", gap: 11,
                  padding: "7px 10px", borderRadius: "var(--r-sm)",
                  textDecoration: "none", marginTop: 4, fontSize: 13,
                  color: "var(--neg)", background: "var(--neg-bg)",
                  border: "1px solid rgba(224,89,79,0.2)",
                }}
              >
                <span style={{ fontSize: 12 }}>⚙</span>
                <span>Admin ↗</span>
              </Link>
            )}
          </div>
        </div>

        {/* ── Footer ── */}
        <div style={{ borderTop: "1px solid var(--line)", padding: "12px 12px 14px", display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
          {/* Add evidence */}
          <Link
            href={activeProject ? `/projects/${activeProjectId}/ingest` : "/projects"}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              padding: "11px 16px", borderRadius: "var(--r-md)",
              background: "var(--accent)", color: "#fff",
              fontWeight: 580, fontSize: 14, textDecoration: "none",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18), 0 4px 14px -6px var(--accent)",
              transition: "background .15s", whiteSpace: "nowrap",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--accent-hover)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--accent)"; }}
          >
            <IcoPlus size={16} /> Add evidence
          </Link>

          {/* Theme toggle */}
          <button
            onClick={() => applyTheme(theme === "dark" ? "light" : "dark")}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "6px 10px", borderRadius: "var(--r-sm)",
              border: "1px solid var(--line)", background: "transparent",
              color: "var(--ink-3)", fontSize: 12, cursor: "pointer",
              transition: ".14s", fontFamily: "inherit",
            }}
            onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = "var(--sel)"; el.style.color = "var(--ink)"; }}
            onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; el.style.color = "var(--ink-3)"; }}
          >
            {theme === "dark" ? <IcoSun size={13} /> : <IcoMoon size={13} />}
            <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
          </button>

          {/* Avatar row + sign-out popover */}
          <div style={{ position: "relative" }} ref={avatarRef}>
            <button
              onClick={() => setAvatarOpen((o) => !o)}
              aria-label="Account menu"
              aria-expanded={avatarOpen}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                width: "100%", padding: "7px 6px", borderRadius: "var(--r-sm)",
                border: "none", background: "transparent", cursor: "pointer",
                transition: ".14s", fontFamily: "inherit",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--sel)"; }}
              onMouseLeave={(e) => { if (!avatarOpen) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              <AvatarDot email={userEmail} size={30} />
              <div style={{ textAlign: "left", minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 580, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--ink)" }}>
                  {userEmail.split("@")[0]}
                </div>
                <div style={{ fontSize: 11, color: "var(--ink-faint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {userEmail}
                </div>
              </div>
            </button>

            {avatarOpen && (
              <div
                role="menu"
                style={{
                  position: "absolute", bottom: "calc(100% + 6px)", left: 0, right: 0,
                  background: "var(--surface)", border: "1px solid var(--line-strong)",
                  borderRadius: "var(--r-md)", boxShadow: "var(--shadow-pop)",
                  padding: 6, zIndex: 60, animation: "popIn .16s ease",
                }}
              >
                <form method="POST" action="/api/auth/sign-out">
                  <button
                    type="submit"
                    role="menuitem"
                    style={{
                      display: "flex", alignItems: "center", gap: 11,
                      padding: "9px 10px", borderRadius: "var(--r-sm)",
                      fontSize: 13.5, color: "var(--ink)", background: "transparent",
                      border: "none", cursor: "pointer", width: "100%", textAlign: "left",
                      fontFamily: "inherit", transition: ".13s",
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--sel)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                  >
                    <IcoSignOut size={15} />
                    Sign out
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Mobile: sticky top bar (visible < 860px via CSS) ── */}
      <div className="mobile-top-bar">
        <span style={{ fontWeight: 640, fontSize: 15, color: "var(--ink)", letterSpacing: "-0.01em" }}>DiscOS</span>
        {activeProject && (
          <span style={{ fontSize: 13, color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, textAlign: "center" }}>
            {activeProject.name}
          </span>
        )}
        <button
          onClick={() => setMobileMenuOpen((o) => !o)}
          aria-label="Open menu"
          style={{ width: 36, height: 36, display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", border: "none", background: "transparent", color: "var(--ink-2)", cursor: "pointer" }}
        >
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
            <path d="M3 5h14M3 10h14M3 15h14" />
          </svg>
        </button>
      </div>

      {/* Mobile slide-in menu */}
      {mobileMenuOpen && (
        <div
          onClick={() => setMobileMenuOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(5,8,18,0.5)", backdropFilter: "blur(3px)", animation: "fadeIn .2s" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: "min(280px, 85vw)", background: "var(--surface)", borderRight: "1px solid var(--line-strong)", boxShadow: "var(--shadow-lg)", display: "flex", flexDirection: "column", padding: "16px 12px", gap: 8, overflowY: "auto" }}
          >
            <button onClick={() => setMobileMenuOpen(false)} style={{ alignSelf: "flex-end", width: 30, height: 30, display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", border: "none", background: "transparent", color: "var(--ink-3)", cursor: "pointer", fontSize: 18 }}>×</button>
            {projects.map((p, i) => {
              const color = DOT_COLORS[i % DOT_COLORS.length];
              const isActive = p.id === activeProjectId;
              return (
                <Link key={p.id} href={`/projects/${p.id}`} onClick={() => setMobileMenuOpen(false)}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: "var(--r-sm)", background: isActive ? "var(--surface-2)" : "transparent", color: isActive ? "var(--ink)" : "var(--ink-2)", fontWeight: isActive ? 620 : 480, fontSize: 14, textDecoration: "none" }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }} />
                  {p.name}
                </Link>
              );
            })}
            <div style={{ height: 1, background: "var(--line)", margin: "4px 0" }} />
            {DIR_ITEMS.map((d) => (
              <Link key={d.id} href={d.href} onClick={() => setMobileMenuOpen(false)}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: "var(--r-sm)", color: "var(--ink-2)", fontSize: 14, textDecoration: "none" }}>
                {d.label}
              </Link>
            ))}
            <div style={{ height: 1, background: "var(--line)", margin: "4px 0" }} />
            <form method="POST" action="/api/auth/sign-out">
              <button type="submit" style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: "var(--r-sm)", border: "none", background: "transparent", color: "var(--ink-2)", fontSize: 14, textAlign: "left", cursor: "pointer", fontFamily: "inherit" }}>
                <IcoSignOut size={15} /> Sign out
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Mobile: bottom tab bar (visible < 860px via CSS) ── */}
      <div className="mobile-tab-bar">
        {[
          { href: "/projects",    label: "Projects" },
          { href: "/people",      label: "People" },
          { href: "/companies",   label: "Companies" },
          { href: "/competitors", label: "Competitors" },
        ].map((tab) => {
          const on = tab.href === "/projects"
            ? pathname.startsWith("/projects")
            : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              style={{
                flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                gap: 3, padding: "8px 4px", textDecoration: "none",
                color: on ? "var(--accent)" : "var(--ink-3)",
                fontSize: 10, fontWeight: on ? 600 : 500, transition: ".13s",
              }}
            >
              <span style={{ width: 4, height: 4, borderRadius: "50%", background: on ? "var(--accent)" : "transparent" }} />
              {tab.label}
            </Link>
          );
        })}
      </div>

      {/* Add Evidence FAB (mobile only, visible < 860px) */}
      <Link
        href={activeProject ? `/projects/${activeProjectId}/ingest` : "/projects"}
        className="mobile-fab"
        aria-label="Add evidence"
        style={{
          width: 54, height: 54, borderRadius: "50%",
          background: "var(--accent)", color: "#fff",
          display: "grid", placeItems: "center",
          position: "fixed", bottom: 72, right: 20,
          boxShadow: "var(--shadow-pop)", zIndex: 50,
          textDecoration: "none",
        }}
      >
        <IcoPlus size={22} />
      </Link>

      {newProjOpen && <NewProjectModal onClose={() => setNewProjOpen(false)} />}
    </>
  );
}

// ── Shared style atoms ─────────────────────────────────────────────
const colIconBtn: React.CSSProperties = {
  width: 36, height: 36,
  display: "grid", placeItems: "center",
  borderRadius: 9, border: "none", background: "transparent",
  cursor: "pointer", transition: ".13s", flexShrink: 0,
};

const divider: React.CSSProperties = {
  width: 28, height: 1, background: "var(--line)", margin: "6px 0", flexShrink: 0,
};
