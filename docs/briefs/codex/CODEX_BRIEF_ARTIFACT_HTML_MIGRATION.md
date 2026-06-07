# Codex Brief — Artifacts: Markdown → HTML Migration (#14)

> ⛔ **SECURITY GATE APPLIES (non-negotiable).** Before committing/pushing any change to auth, RLS/migrations, public routes, middleware, or service-role usage, post the diff and wait for Opus's written **APPROVED**. See `AGENTS.md` → "SECURITY REVIEW GATE". This overrides anything below.

**Author:** Opus 4.8 (PM / security reviewer) · **Date:** 2026-06-04
**GitHub issue:** #14 (label: high-priority)
**Gate:** Schema migration + a NEW XSS surface. **Opus reviews the migration SQL AND the sanitisation layer before either is applied/merged.** State your intended approach and wait for the OK before writing code.
**Why now:** Hard prerequisite for the AI-Improve thin slice (#10). The diff/preview view and the future text-selection scope (#18) both need an HTML document surface — MD byte-offset mapping is too brittle to build on.

---

## The decision (from issue #14)

Move artifact storage from Markdown to native HTML. Claude produces better-structured PM documents in HTML (tables, callouts, hierarchy render natively), the render-time MD→HTML conversion step goes away, the compose editor's `## heading` section-parsing hack goes away, and citation markers become proper HTML elements instead of regex-matched `[N]` text.

---

## What changes

1. **DB migration** — add `content_html` to `artifacts` (or rename `content_md` — decide at migration time and state your choice in the review). Plus a one-time migration script to convert any existing `content_md` rows to HTML.
   - **Do NOT keep both `content_md` and `content_html` indefinitely.** Pick one, migrate, drop the other.
   - **Do NOT round-trip HTML back to Markdown on save.**
2. **Compose prompt** — instruct Claude to output structured HTML using the artifact base stylesheet defined in `DESIGN.md`. Update the relevant prompt in `src/lib/llm/prompts/`.
3. **Compose editor** — AI streams into a single HTML surface, not section cards. (Tiptap is the intended rich-text editor direction — it works natively with HTML, no round-trip.)
4. **Document viewer** — `src/app/(app)/projects/[projectId]/documents/[artifactId]/ArtifactViewer.tsx` currently hand-parses Markdown into React nodes (headings, lists, tables, blockquotes, code, bold, inline-code, `[N]` citation chips). Replace that parser with direct HTML rendering. **This is exactly where the new security risk lands — see below.**
5. **Citations** — `[N]` text markers become HTML elements (e.g. `<cite data-n="N">`). The citation popover logic in `ArtifactViewer.tsx` rebinds to those elements instead of regex matches. `citation_map` storage in `artifact.metadata` and `/api/artifacts/[id]/citations` stay as-is.

---

## SECURITY — C5 from the Gate 3 review (NON-NEGOTIABLE, rides with this issue)

Today `ArtifactViewer` parses MD into React elements — **no `dangerouslySetInnerHTML`, so no XSS surface.** The moment you render stored HTML directly (via `dangerouslySetInnerHTML` or Tiptap), **AI-generated and user-edited content becomes a stored-XSS vector.** The HTML's origin is an LLM influenced by user prompts and possibly-poisoned ingested source content — it cannot be trusted.

**Required:**
- **Server-side HTML sanitisation with a strict allowlist**, applied on the way INTO storage (sanitise before persisting `content_html`) AND defensively at render. Use a maintained sanitiser (`sanitize-html`, or DOMPurify via jsdom) — do not hand-roll.
- **Allowlist** (tune during review): block-level `h1-h6, p, ul, ol, li, blockquote, pre, code, hr, table, thead, tbody, tr, th, td`; inline `strong, em, a, cite, br, span`; attributes limited to `a[href]` (http/https/mailto only — strip `javascript:` and data URIs), `cite[data-n]`, and a constrained `class` allowlist if the base stylesheet needs it.
- **Strip unconditionally:** `script, style, iframe, object, embed, form, input`, all `on*` event-handler attributes, `javascript:`/`data:` URLs.
- This sanitiser must cover **three inputs**: (a) Claude compose output, (b) user edits from the Tiptap editor, (c) future AI-Improve `proposed_content` (#10) — build it as a single reusable server-side function so #10 inherits it for free.

---

## Constraints / gates

- **Opus reviews the migration SQL before it is applied** (same gate as every DB change: Codex authors, Opus reviews, Jimmy runs in Supabase). Do NOT apply.
- **Opus reviews the sanitisation layer** — this is the C5 condition; it is the security deliverable of this issue.
- Per issue #14: the "compose editor section removal" is a related concern that should land at the same time or just after — coordinate if it's a separate change.
- Keep the existing artifact RLS and `org_id` scoping untouched — this migration is about content shape, not access control.

---

## Definition of done

- `artifacts` stores HTML (one column, old column dropped after backfill).
- Compose produces sanitised HTML; the viewer renders it directly; citations work as HTML elements with the popover intact.
- Existing artifacts migrated once, cleanly.
- A reusable server-side sanitiser guards every write path; Opus has reviewed the allowlist.
- No `dangerouslySetInnerHTML` path receives unsanitised content.

---

## Files in scope
- `supabase/migrations/00XX_artifacts_html.sql` (author only — do not apply)
- One-time backfill script for existing `content_md`
- `src/lib/llm/prompts/` — compose prompt (HTML output instruction)
- `src/app/(app)/projects/[projectId]/documents/[artifactId]/ArtifactViewer.tsx` — replace MD parser with HTML render
- Compose editor component(s) — single HTML surface
- New: `src/lib/sanitize/html.ts` (or similar) — the reusable server-side sanitiser

**Reminder:** state your intended approach (column rename vs add, sanitiser library, editor scope) and wait for Opus OK before writing code or SQL.
