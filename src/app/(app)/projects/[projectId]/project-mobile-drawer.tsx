"use client";

import { useState } from "react";
import { ProjectSidebar } from "./project-sidebar";

interface ProjectMobileDrawerProps {
  projectId: string;
  projectName: string;
  projectDescription: string | null;
}

export function ProjectMobileDrawer({
  projectId,
  projectName,
  projectDescription,
}: ProjectMobileDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <div className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--surface-0)]/95 px-5 py-3 backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-1)] text-[var(--ink)] transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)]"
          aria-label="Open project navigation"
          aria-expanded={isOpen}
        >
          <span className="grid gap-1">
            <span className="block h-0.5 w-4 rounded-full bg-current" />
            <span className="block h-0.5 w-4 rounded-full bg-current" />
            <span className="block h-0.5 w-4 rounded-full bg-current" />
          </span>
        </button>
      </div>

      {isOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          aria-label="Close project navigation"
          onClick={() => setIsOpen(false)}
        />
      )}

      <div
        aria-hidden={!isOpen}
        className={`fixed inset-y-0 left-0 z-50 w-[min(20rem,86vw)] transform transition-transform duration-200 lg:hidden ${
          isOpen ? "pointer-events-auto translate-x-0" : "pointer-events-none -translate-x-full"
        }`}
      >
        <ProjectSidebar
          projectId={projectId}
          projectName={projectName}
          projectDescription={projectDescription}
          onNavigate={() => setIsOpen(false)}
        />
      </div>
    </>
  );
}
