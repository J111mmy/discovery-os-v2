"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The research chain, rendered as tabs atop the workspace root and its five
// existing routes. Generic by design — Documents can adopt this same pattern
// later for its own category tabs (GTM/Sales/Product/...).
const WORKSPACE_TABS = [
  { id: "overview",      label: "Overview",      href: "" },
  { id: "sources",       label: "Sources",       href: "sources" },
  { id: "evidence",      label: "Evidence",      href: "evidence" },
  { id: "themes",        label: "Themes",        href: "themes" },
  { id: "problems",      label: "Problems",      href: "problems" },
  { id: "opportunities", label: "Opportunities", href: "opportunities" },
];

export function WorkspaceTabs({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const base = `/projects/${projectId}`;

  function isTabActive(href: string) {
    return href ? pathname.startsWith(`${base}/${href}`) : pathname === base;
  }

  // Only render on workspace-chain routes — hidden on Documents, Compose,
  // Ask, Ingest, Settings, etc.
  if (!WORKSPACE_TABS.some((tab) => isTabActive(tab.href))) return null;

  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        borderBottom: "1px solid var(--line)",
        marginBottom: 20,
        overflowX: "auto",
      }}
    >
      {WORKSPACE_TABS.map((tab) => {
        const href = tab.href ? `${base}/${tab.href}` : base;
        const on = isTabActive(tab.href);
        return (
          <Link
            key={tab.id}
            href={href}
            style={{
              padding: "10px 14px",
              fontSize: 13.5,
              fontWeight: on ? 620 : 480,
              color: on ? "var(--ink)" : "var(--ink-2)",
              borderBottom: on ? "2px solid var(--accent)" : "2px solid transparent",
              textDecoration: "none",
              whiteSpace: "nowrap",
              transition: ".13s",
            }}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
