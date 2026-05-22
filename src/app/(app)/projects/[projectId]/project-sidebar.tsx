"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface ProjectSidebarProps {
  projectId: string;
  projectName: string;
  projectDescription: string | null;
}

const navItems = [
  { href: "", label: "Workspace" },
  { href: "evidence", label: "Evidence" },
  { href: "ask", label: "Ask" },
  { href: "problems", label: "Problems" },
  { href: "sources", label: "Sources" },
  { href: "compose", label: "Compose" },
  { href: "documents", label: "Documents" },
  { href: "ingest", label: "Add Evidence" },
];

const secondaryNavItems = [{ href: "settings", label: "Settings" }];

export function ProjectSidebar({
  projectId,
  projectName,
  projectDescription,
}: ProjectSidebarProps) {
  const pathname = usePathname();
  const basePath = `/projects/${projectId}`;

  return (
    <aside className="flex h-full flex-col border-r border-[var(--border)] bg-[var(--surface-1)]">
      <div className="border-b border-[var(--border)] p-5">
        <Link
          href="/projects"
          className="mb-5 inline-flex text-xs font-medium text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]"
        >
          Back to all projects
        </Link>
        <Link href={basePath} className="block">
          <div className="text-base font-semibold leading-6 text-[var(--ink)]">
            {projectName}
          </div>
          {projectDescription && (
            <p className="mt-2 line-clamp-3 text-xs leading-5 text-[var(--ink-muted)]">
              {projectDescription}
            </p>
          )}
        </Link>
      </div>

      <nav className="flex flex-1 flex-col gap-1 p-3">
        {navItems.map((item) => {
          const href = item.href ? `${basePath}/${item.href}` : basePath;
          const isActive = item.href ? pathname.startsWith(href) : pathname === href;

          return (
            <Link
              key={item.label}
              href={href}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-[var(--brand)] text-white"
                  : "text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <nav className="border-t border-[var(--border)] p-3">
        {secondaryNavItems.map((item) => {
          const href = `${basePath}/${item.href}`;
          const isActive = pathname.startsWith(href);

          return (
            <Link
              key={item.label}
              href={href}
              className={`block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-[var(--brand)] text-white"
                  : "text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
