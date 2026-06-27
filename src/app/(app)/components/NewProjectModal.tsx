"use client";

/**
 * NewProjectModal (2D) — modal wrapper for the createProjectAction server action.
 *
 * Keeps `projects/new/actions.ts` completely untouched — the server action and
 * redirect logic are identical to the full-page flow at /projects/new.
 *
 * Usage:
 *   const [open, setOpen] = useState(false);
 *   <NewProjectModal open={open} onClose={() => setOpen(false)} />
 */

import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { usePathname } from "next/navigation";
import { createProjectAction } from "@/app/(app)/projects/new/actions";

// ── Slug helpers (mirrors new-project-form.tsx) ────────────────────

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

// ── Submit button (needs useFormStatus inside the <form>) ──────────

function SubmitBtn({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      style={{
        marginLeft: "auto",
        display: "flex", alignItems: "center", gap: 6,
        padding: "9px 18px", borderRadius: "var(--r-md)",
        background: "var(--accent)", color: "#fff",
        fontWeight: 580, fontSize: 14, cursor: "pointer",
        border: "none", fontFamily: "inherit",
        transition: "opacity .14s",
        opacity: (pending || disabled) ? 0.6 : 1,
      }}
    >
      {pending ? "Creating…" : "Create project"}
    </button>
  );
}

// ── Props ──────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
}

// ── Modal ──────────────────────────────────────────────────────────

export function NewProjectModal({ open, onClose }: Props) {
  const [state, formAction] = useFormState(createProjectAction, {});
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const prevAutoSlug = useRef("");
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Auto-generate slug from name
  useEffect(() => {
    if (slugTouched) return;
    const next = slugify(name);
    prevAutoSlug.current = next;
    setSlug(next);
  }, [name, slugTouched]);

  // Focus name on open, reset on close
  useEffect(() => {
    if (open) {
      setName("");
      setSlug("");
      setSlugTouched(false);
      const id = setTimeout(() => nameInputRef.current?.focus(), 50);
      return () => clearTimeout(id);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // The create action redirects to the new project, but this modal lives in the
  // persistent rail, so navigation alone never dismisses it. Close once the route
  // changes while we're open (i.e. the create succeeded and navigated us away).
  const pathname = usePathname();
  const prevPathname = useRef(pathname);
  useEffect(() => {
    if (prevPathname.current !== pathname) {
      prevPathname.current = pathname;
      if (open) onClose();
    }
  }, [pathname, open, onClose]);

  if (!open) return null;

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "11px 13px",
    borderRadius: 10, background: "var(--surface-2)",
    border: "1px solid var(--line)", color: "var(--ink)",
    fontSize: 14, outline: "none", fontFamily: "inherit",
    boxSizing: "border-box", transition: "border-color .14s",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 13, fontWeight: 540, color: "var(--ink-2)",
    display: "block", marginBottom: 7,
  };

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
          <div style={{ width: 34, height: 34, borderRadius: 10, background: "var(--accent-soft)", color: "var(--accent)", display: "grid", placeItems: "center", flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M10 4v12M4 10h12" />
            </svg>
          </div>
          <div>
            <div style={{ fontWeight: 640, fontSize: 16, color: "var(--ink)" }}>New project</div>
            <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 1 }}>
              Create a discovery workspace for a new research focus.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              marginLeft: "auto", width: 30, height: 30,
              display: "grid", placeItems: "center",
              borderRadius: "var(--r-sm)", border: "none",
              background: "transparent", color: "var(--ink-3)",
              cursor: "pointer", fontSize: 18, lineHeight: 1, flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>

        {/* Form body */}
        <form action={formAction}>
          <div style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={labelStyle} htmlFor="np-name">Project name</label>
              <input
                ref={nameInputRef}
                id="np-name"
                name="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Rebar Delivery Discovery"
                style={inputStyle}
              />
            </div>

            {/* Hidden slug */}
            <input type="hidden" name="slug" value={slug} />

            <div>
              <label style={labelStyle} htmlFor="np-desc">Description <span style={{ color: "var(--ink-faint)", fontWeight: 400 }}>(optional)</span></label>
              <textarea
                id="np-desc"
                name="description"
                rows={3}
                placeholder="A short note on the audience, problem, or decision this workspace supports."
                style={{ ...inputStyle, resize: "vertical", minHeight: 70 }}
              />
            </div>

            {state?.error && (
              <div style={{
                padding: "10px 14px", borderRadius: "var(--r-md)",
                background: "var(--neg-bg)", border: "1px solid rgba(224,89,79,0.2)",
                fontSize: 13.5, color: "var(--neg)",
              }}>
                {state.error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "14px 22px", borderTop: "1px solid var(--line)",
            background: "var(--surface-2)",
          }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "9px 14px", borderRadius: "var(--r-sm)",
                background: "transparent", border: "1px solid var(--line)",
                color: "var(--ink-2)", fontWeight: 540, fontSize: 13.5,
                cursor: "pointer", fontFamily: "inherit",
              }}
            >
              Cancel
            </button>
            <SubmitBtn disabled={!name.trim()} />
          </div>
        </form>
      </div>
    </div>
  );
}
