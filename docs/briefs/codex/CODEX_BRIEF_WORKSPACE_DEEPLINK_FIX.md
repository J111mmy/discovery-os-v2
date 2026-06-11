# Codex Brief — Workspace deep-link correctness fix (#27)

**Status:** Ready to build. Self-contained. No design dependency.
**Author:** Opus
**Date:** 2026-06-11
**For:** Codex stand-in (bounded correctness task; ~half day)
**Issue:** [#27](https://github.com/J111mmy/discovery-os-v2/issues/27) — Workspace links to generic `/evidence` instead of specific records (traceability break)
**Reference:** `docs/architecture/UI_AUDIT.md` §1

---

## 0. Why this matters

The workspace is the first surface the team will hit after onboarding. Right now, clicking a
problem / theme / opportunity from the workspace dumps you on the generic `/evidence` list — the
"clickable pathway back to source" is broken **at the workspace surface**, even though the
underlying data and the correct deep-links both already exist elsewhere. This is a
**correctness/trust bug, not polish.** No new plumbing is required — you are routing existing
items to deep-links that are already built and working in sibling components.

## 1. Scope — one file

All work is in:
```
src/app/(app)/projects/[projectId]/workspace-client.tsx
```
Do **not** touch the agents, the evidence browser, or the problems list in this task. Those are
covered by separate work (#28/#29, Sonnet design in flight). Keep this PR tight.

## 2. The deep-link targets that already exist (verified live)

Use these exact patterns — they are already used by `evidence-browser.tsx` and `problems-list.tsx`:

| Target | Pattern | Already used at |
|---|---|---|
| Theme → its evidence | `/projects/${projectId}/evidence?theme_id=${id}` | `evidence-browser.tsx:465`; `workspace-client.tsx:1001` (EvidenceChart bars — the one link that's already correct) |
| Problem → its specific evidence | `/projects/${projectId}/problems?problem=${problemId}` | `evidence-browser.tsx`, `problems-list.tsx` |
| Evidence → exact source segment | `/projects/${projectId}/sources/${sourceId}#segment-${segmentId}` | `problems-list.tsx`, `evidence-browser.tsx` |

## 3. The three concrete fixes (with verified line numbers)

> Line numbers are from `2f5d542` (current `main`). Confirm by content, not line, in case of drift.

### 3.1 Opportunities teaser points at `/evidence` — **wrong** (highest priority)
**~line 1080.** The `TeaserCard label="Opportunities"` has `href={`/projects/${project.id}/evidence`}`.
Opportunities are not evidence, and no opportunity detail view exists yet (that's #25). This link
actively misleads.
- **Fix:** The page already renders **"Opportunity detail rows"** immediately below the teaser grid
  (the `opportunityRows.length > 0` block starting ~line 1083). Point the Opportunities teaser at
  that section via an in-page anchor (add `id="opportunities"` to that section's container and set
  the teaser `href="#opportunities"`), **or** drop the `href` entirely so the card is non-clickable
  until the opportunity layer lands (#25). Do **not** leave it pointing at `/evidence`.
- Prefer the anchor approach if `TeaserCard` can render a same-page `<a href="#...">`; if `TeaserCard`
  hard-assumes a route `<Link>`, the no-href (non-clickable) option is acceptable for this task.

### 3.2 Problems teaser is not deep-linked per item
**~line 1066.** `TeaserCard label="Problems"` links to `/projects/${project.id}/problems` (the list).
The section-level link to the list is acceptable, but per-item rows should deep-link to the specific
problem.
- `TeaserCard` (defined ~line 145–260 in this file) currently takes `items: string[]` (titles only).
  Extend it so items can optionally carry an `href` (e.g. `items: Array<{ label: string; href?: string }>`
  or a parallel prop), and when present, render each item as a `<Link href={...}>`.
- Wire Problems items to `/projects/${project.id}/problems?problem=${p.id}`. Note `problemPreviews`
  currently maps to `p.title` only (line ~1063) — you'll need the problem `id` in that preview data.
  Check the server component that builds `problemPreviews` (in `problems/page.tsx` or the workspace
  loader) and include `id` alongside `title`.

### 3.3 Theme links lose context
- **~line 1029** ("View claims →" chip under "+N more themes") → bare `/evidence`. If this represents
  "see the remaining themes," it should carry theme context or route to the themes surface. Since a
  dedicated themes browse view doesn't exist yet (#29), routing to `/evidence` (which has a theme
  lens) is acceptable **only** for the aggregate "+N more" case. Leave a `// TODO(#29): route to
  themes browse view when it lands` comment.
- **~line 919** ("View all" on the "Evidence by theme" card header) → `/evidence`. Section-level
  "view all" to the evidence list is acceptable; leave as-is but add the same `TODO(#29)` marker.
- The per-theme bars (EvidenceChart, ~line 1001) are **already correct** (`?theme_id=`). Don't change them.

## 4. Out of scope (do NOT do here)
- Building a themes browse view (#29 — Sonnet designing now).
- Migrating problem reads from legacy `source_evidence_ids` arrays to typed `problem_evidence` (#28).
- Any opportunity-generation logic (#25).
- Restyling the workspace. Match existing inline-style conventions in the file exactly.

## 5. Acceptance
- From the workspace, clicking a **problem** preview lands on that specific problem
  (`/problems?problem={id}`), not the generic list.
- The **Opportunities** teaser no longer routes to `/evidence` (anchors to the opportunity rows, or
  is non-clickable until #25).
- The **theme** per-item links carry `theme_id`; aggregate "view all/claims" links are marked with a
  `TODO(#29)`.
- `npx tsc --noEmit` clean. No changes outside `workspace-client.tsx` except, if required, adding `id`
  to the problem-preview query/loader (call that out explicitly in the PR description).

## 6. Gate
Pure frontend, no schema/RLS/agent/auth surface → **no security gate**, standard self-review.
Post the diff + a screenshot/gif of the three link behaviours in the channel when done. Opus will
glance before it's considered cleared.
