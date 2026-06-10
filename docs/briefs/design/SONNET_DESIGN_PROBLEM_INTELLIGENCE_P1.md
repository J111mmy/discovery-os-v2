# Sonnet Design — Problem Intelligence P1 (Drawer + Output Strip)

**Status:** Design proposal, ready for Opus/Codex review
**Author:** Sonnet
**Date:** 2026-06-10
**Responds to:** `SONNET_BRIEF_RESEARCH_ONTOLOGY_UX.md` §2.4, §2.5, §5 (P1 scoping, 2026-06-10)
**Depends on (assumed landed for this design):** Milestone 0.5 pipeline integrity fixes — re-anchored `evidence.segment_id` (incl. `anchor_method` metadata), `problems.status` preservation
**Scope:** Problem detail drawer (§2.4) + operational output strip (§2.5, gated states) + empty/loading/error states for both. **Does not** cover §2.1–2.3 evidence multi-lens redesign (P2/P3, held).

---

## 0. Design Principles Applied

- **Drawer, not page** — per Open Decision #3 (drawer recommended), opens from `ProblemsList` rows. Reuses the right-side slide-in pattern already established in `SourcesClient.tsx` (`SourceDrawer`): backdrop + `slideL` panel, `role="dialog"`, `aria-modal="true"`, close via `×` button, backdrop click, and **Escape** (Escape handling is new — not present in `SourceDrawer` today; add it here and consider back-porting).
- **Honest about provenance** — every section that surfaces evidence reached via `source_evidence_ids` (theme-union, not assessed support) is labelled **"Related evidence (via themes)"**. No "Supporting evidence" language anywhere in P1.
- **Never imply precision the data doesn't have** — C4 governs every "open source" affordance.
- **Show structure even when fields are empty** — Future fields (`who_affected`, `what_is_hard`, `why_it_matters`, `current_tools`, `confidence`, etc.) render as labelled placeholder rows with "Needs backend support," not hidden. This teaches the model (per UX principle 1.4) without inventing data.
- **Outputs are connected, not over-promised** — output strip always renders three slots; only wired actions are clickable.

---

## 1. Problem Detail Drawer (§2.4)

### 1.1 Container & chrome

Right-side drawer, `width: min(560px, 95vw)` (wider than `SourceDrawer`'s 480px — problem detail has more sections). Same visual chrome as `SourceDrawer`:

- Backdrop: `rgba(0,0,0,.32)`, click to close
- Panel: `var(--surface)`, `border-left: 1px solid var(--line)`, `box-shadow: var(--shadow-lg)`, `animation: slideL .24s var(--ease)`
- `role="dialog"` `aria-modal="true"` `aria-labelledby="problem-drawer-title"`
- **New for this drawer:** Escape key closes; focus moves to the close button on open and is trapped within the panel (focus-visible rings on all interactive elements per §6 a11y reqs)
- Deep link: `/projects/[projectId]/problems?problem=<id>` opens the drawer on load (practical per §6 — "Deep links for problem detail if practical"). Closing the drawer removes the query param via `router.replace`.

### 1.2 Header

```
┌─────────────────────────────────────────────────┐
│ [StatusPill] [SeverityPill]              [ × ]   │
│                                                   │
│ Site teams distrust remote inspection workflows  │ ← title, 16px/600
│ because accountability still sits with the       │
│ person physically present on site.               │
│                                                   │
│ Updated 3 days ago · 12 related evidence         │ ← meta line, 12px ink-faint
└─────────────────────────────────────────────────┘
```

- `StatusPill` / `SeverityPill`: reuse exactly as styled in `problems-list.tsx` (no new chip styles).
- Title: `problems.title` (existing field).
- Meta line: `updated_at` relative time + `source_evidence_ids.length` count, worded as **"related evidence"** (not "supporting").
- Status transition buttons (`Acknowledge`, `Mark active`, `Resolve`, `Dismiss`) move from the list card into this header area as a row beneath the title — same button styling as `problems-list.tsx` transitions row. This consolidates the existing status-change UI into the drawer rather than duplicating it on the card (card keeps the pills + summary only; full action set lives in the drawer). **No backend change** — reuses `updateProblemStatusAction`.

### 1.3 Section 1 — Problem statement

Always rendered. Two-tier content:

- **Available now:** `problems.description` (existing field) — rendered as the lead paragraph.
- **Needs backend support** — structured who/what/why breakdown:

```
Who's affected     [Needs backend support]
What's hard        [Needs backend support]
Why it matters     [Needs backend support]
```

Each row: label in `--ink-faint` uppercase 11px, value area shows a single-line neutral placeholder:

> *"Structured breakdown not yet available — see description above."*

styled in `--ink-2` italic, no border/box (avoid implying a broken widget — it's an absent field, not an error). When `problems.statement` / `who_affected` / `what_is_hard` / `why_it_matters` exist (P3), these rows render the real values and the placeholder copy disappears — same row structure, no layout shift beyond text length.

**Needs backend support — minimum shape:**
```ts
problems.statement: string | null
problems.who_affected: string | null
problems.what_is_hard: string | null
problems.why_it_matters: string | null
```

### 1.4 Section 2 — Affected context

Header: "Affected context"

Grid of labelled chips/rows, each independently gated:

| Field | Source today | P1 treatment |
|---|---|---|
| Roles / personas | none | "Needs backend support" placeholder |
| People | `evidence_entities` (people) if linkable from `source_evidence_ids` | render as name chips if resolvable; else placeholder |
| Companies | `evidence_entities` (companies) if linkable | same |
| Current tools / workarounds | none structured | "Needs backend support" placeholder |
| Source types | derivable: join `source_evidence_ids` → `evidence.source_id` → `sources.type`, dedupe | **render now** as small type chips (e.g. "Interview", "Support ticket") |

This section is the clearest "partial data today" case — **Source types** can ship in P1 because it's a pure join over existing tables (no new schema). People/Companies render *only if* `evidence_entities` rows already resolve cleanly for the evidence in `source_evidence_ids`; if the join returns nothing, show the placeholder rather than an empty grid cell.

If **all** rows in this section are placeholders (no source types resolved either — e.g. evidence records were deleted), collapse to a single muted line: *"No affected-context details available yet."*

### 1.5 Section 3 — Evidence

Header: **"Related evidence (via themes)"** — exact required label, with a small info affordance (ⓘ, not a wall of text) whose tooltip reads:

> "Evidence linked through this problem's themes. Not yet individually reviewed against this specific problem."

This satisfies UX principle 1.4 (no education blocks) while being honest about provenance, and matches the brief's amendment to §1.3/§2.4.3.

Each evidence row (compact, reuse `EvidenceRow` density patterns from the evidence browser where possible):

```
┌────────────────────────────────────────────────────┐
│ "We still have to walk the site even when the      │
│  remote inspection says it's fine."                 │
│                                                      │
│ [Topic chip] [Topic chip]      [TrustPill]          │
│ Interview · Jordan T.  ·  ⌖ Open in source / ~Approx│
└────────────────────────────────────────────────────┘
```

- Quote/content: `evidence.content` (or `summary` if content is long — truncate with line-clamp, density matters per §1.7).
- Topic chips: from `evidence.themes` (rendered as **Topics**, per Milestone 0 language correction — never "Themes" at this level).
- Trust pill: reuse `EvidenceRow`'s trust styling (pending/trusted/excluded).
- Source context link: **see §4 (C4 spec)** — this is where the confident-vs-approximate distinction lives.
- List shows up to 5 evidence rows by default with "Show all N related evidence" expander (avoids drawer becoming a full evidence browser — that's P2's job).

If `source_evidence_ids` resolves to zero readable evidence rows (deleted/inaccessible records — "some records are unavailable" case from §5.3):

> "This problem has evidence links, but some records are unavailable."

— shown as a single muted notice line in place of the list, per the brief's exact error copy.

### 1.6 Section 4 — Themes and topics

Header: "Themes and topics"

- **Primary theme:** `source_theme_ids[0]` (existing convention — first ID treated as primary until `primary_theme` field exists). Rendered as a theme row (label + short description if `themes.description` present), clicking opens... *(P2 — Theme lens doesn't exist yet; for P1, this is non-interactive, styled as a static row, not a dead link)*.
- **Contributing themes:** remaining `source_theme_ids`, rendered as smaller secondary rows or a "+N more themes" overflow if more than 2.
- **Provenance topics:** union of `evidence.themes` across the related-evidence set (deduped), rendered as topic chips (visually distinct from theme rows per §1.2 of the brief — chips vs. rows).

If `source_theme_ids` is empty: muted line — *"No themes linked yet."*

**Needs backend support** (for future, not blocking P1): `themes.central_organising_concept`, `themes.confidence`, `primary_theme` field on `problems`.

### 1.7 Section 5 — Outputs

This section *is* the operational output strip. See §2 below for full spec — embedded here as a labelled section ("Outputs") within the drawer, positioned after Themes/Topics and before Gaps/Caveats.

### 1.8 Section 6 — Gaps / caveats

Header: "Gaps and caveats"

P1 can populate this section from data that exists today without new fields:

- **Evidence recency:** if the most recent related evidence is older than e.g. 30 days (configurable, but don't over-engineer — a simple relative-date check), show: *"Most related evidence is from over a month ago."*
- **Weak support:** if `source_evidence_ids.length < 3` (or 0), show: *"This problem currently has limited related evidence."*
- **Trust mix:** if related evidence is mostly `pending`/`excluded` rather than `trusted`, show: *"Most related evidence hasn't been reviewed yet."*

These are computed client/server-side from existing fields — no schema change. They're soft, advisory lines (muted text, small warning-tone icon using `--warn`), not blocking states.

**Needs backend support:** `contradicting_evidence` (explicit contradiction detection) — until then, omit any "contradictory signals" subsection entirely rather than showing an empty placeholder (this one caveat type genuinely doesn't exist yet even as a derivable signal, so don't manufacture a placeholder row for it).

### 1.9 Call-to-actions

Per brief §2.4 "Problem detail call-to-actions" — these live in the header action row (status transitions) and the output strip (§2). No additional floating action bar. `Review evidence` = the "Show all N related evidence" expander in §1.5 (reframed as an action rather than a separate button).

---

## 2. Operational Output Strip (§2.5)

### 2.1 Layout

```
Create from this:
[ ＋ Opportunity ]   [ ＋ Action ]   [ ＋ Artifact ]
```

Three slots, always rendered in this order, equal width on desktop, stacked full-width on mobile (per §1.6 — text must fit, no hover-only actions). Each slot is either:

- **Enabled** — solid/outline button, `--accent` on hover, click triggers create flow
- **Gated/disabled** — neutral (not red/error-toned), reduced-emphasis styling (`--ink-faint` text, `--surface-2` background, `--line` border, `cursor: not-allowed`), with a short tooltip/inline caption explaining the gate **without table names**

### 2.2 Per-slot semantics & gating (current state, 2026-06-10)

| Slot | Meaning (per Opus decision #4) | P1 status | Gated copy |
|---|---|---|---|
| **Opportunity** | The problem-linked *product* opportunity (distinct from `project_opportunities` "Suggested workspaces") | **Gated** — no link table from problem → product opportunity exists yet | "Opportunity creation needs a backend update. Coming soon." |
| **Action** | A task/commitment originating from this problem | **Potentially enabled** — `actions` table exists; needs a `problem_id` (or equivalent) link column to attribute the action back to this problem | If link column doesn't exist yet: gated, "Action creation needs a backend update. Coming soon." If it lands before P1 ships: enabled, opens existing action-create flow pre-filled with problem context |
| **Artifact** | A generated document scoped to this problem (per Milestone 4 / artifact-problem links) | **Gated** — `artifacts` table exists and `/compose` flow exists, but no problem→artifact link field to pre-seed citations/context from this specific problem | "Drafting from this problem needs a backend update. Coming soon." |

All three gated captions follow the same template: **"`<Noun>` `<verb-ing>` needs a backend update. Coming soon."** — neutral, no table names, no "broken" framing, consistent across slots. This satisfies §2.5's example (`"Opportunity creation needs backend link table."` → reworded to remove the word "table").

### 2.3 Visual spec for gated buttons

```css
/* gated state */
background: var(--surface-2);
border: 1px solid var(--line);
color: var(--ink-faint);
cursor: not-allowed;
```

Tooltip on hover/focus (button remains focusable for screen readers — `aria-disabled="true"`, not `disabled`, so the explanation is reachable via keyboard/AT):

```
┌──────────────────────────────────┐
│ Opportunity creation needs a      │
│ backend update. Coming soon.      │
└──────────────────────────────────┘
```

Tooltip styling: `--surface-3` background, `--shadow-pop`, `--r-sm`, 12px text, `--ink-2`.

### 2.4 Reuse on Themes/Evidence (future)

Per brief, the strip pattern is shared across Problems/Themes/Evidence. **P1 ships it only on the Problem drawer.** When Theme detail (P2) and Evidence-on-Problem actions are designed, reuse this exact component — same gating template, same three-slot order — rather than inventing a second pattern.

**Needs backend support — minimum shape for the strip to fully activate:**
```ts
// Action slot
actions.problem_id: string | null  // FK to problems.id

// Artifact slot
artifacts.source_problem_id: string | null  // FK to problems.id, used to pre-seed
                                              // compose context + citations

// Opportunity slot — new object per Opus decision #4 (P3), not project_opportunities
opportunities.problem_id: string | null
opportunities.statement: string  // "How might we..."
opportunities.status: string
```

---

## 3. States

### 3.1 Loading

Drawer opens immediately with skeleton content (don't wait for all sections to resolve before showing the drawer chrome — header/title can usually render from the list row's already-fetched data).

- Header: renders immediately (title, pills already known from list row)
- Sections 1–6: each shows a skeleton block (2–3 shimmer/pulse lines at `--surface-2`, respecting reduced-motion — use opacity pulse only, disable if `prefers-reduced-motion`)
- Evidence section specifically: calm copy while resolving — *"Finding related evidence…"* (per §5.2 wording bank), shown as text above/instead of skeleton rows if resolution is expected to take >1s

### 3.2 Empty states

| Surface | Condition | Copy |
|---|---|---|
| Evidence section | `source_evidence_ids` empty | "No related evidence yet." (muted, no icon needed — calm, not alarming) |
| Affected context | All sub-fields empty/unresolvable | "No affected-context details available yet." |
| Themes/topics | `source_theme_ids` empty | "No themes linked yet." |
| Gaps/caveats | No caveat conditions triggered | Section header still shown, body: "No gaps flagged." (don't hide the section — consistent structure per principle 1.4) |
| Output strip | N/A — strip always shows 3 slots, gated or enabled | — |
| Whole drawer | Problem somehow has no `description` and no derivable sections (degenerate case) | Statement section shows: "This problem doesn't have a description yet." — rest of drawer renders normally with its own empty states |

### 3.3 Error states

| Scenario | Copy | Behaviour |
|---|---|---|
| Evidence records referenced but unreadable (RLS/deleted) | "This problem has evidence links, but some records are unavailable." | Shown in place of the evidence list; rest of drawer unaffected |
| General fetch failure for a section (e.g. entities join times out) | "We could not load this section. Try again." | Inline retry button (small, text-style) scoped to that section only — don't fail the whole drawer for one section |
| Whole-drawer fetch failure (problem itself 404/error) | "We could not load this problem. Try again." | Drawer shows just header chrome + this message + retry; close button still works |
| Output strip create-action failure (future, when enabled) | "Drafting is temporarily unavailable. Try again shortly." | Toast/inline message near the strip, button returns to enabled state |

All error copy avoids IDs, stack traces, provider names — per §5.3 and Opus security note.

---

## 4. C4 — Degraded-Confidence Source Link Spec

Applies to every "open source context" affordance in the evidence section (§1.5) and anywhere else evidence links to source segments.

`evidence.metadata.anchor_method` ∈ `exact | normalised | fuzzy | speaker | fallback_first_segment`

### 4.1 Confident state (`exact` | `normalised`)

```
⌖ Open in source
```

- Icon: target/crosshair glyph (or existing "open" icon used elsewhere — check for an existing external-link icon in the codebase before introducing a new one; if `SourcesClient`'s chevron-in-box pattern exists, prefer reuse)
- Label: "Open in source"
- Behaviour: deep-links to the source detail view, scrolled/highlighted to the exact segment (`source_segments.id` from `evidence.segment_id`)
- Styling: `--accent` text, standard link affordance, full confidence

### 4.2 Approximate state (`fuzzy` | `speaker` | `fallback_first_segment`)

```
≈ Approximate location in source
```

- Icon: tilde/approximation glyph (`≈`) — visually distinct from the confident icon, intentionally "softer"
- Label: **"Approximate location in source"** — never "Open in source" for these methods
- Behaviour: same destination (source detail, segment scrolled-to) but the segment is **not highlighted as "this is where it was said"** — instead, the page may show a neutral marker like "around this part of the source" or simply scroll without a strong highlight. (Exact highlight treatment is a source-detail-page concern; the contract from the drawer's side is: pass the segment as a *hint*, not an assertion.)
- Styling: `--ink-2` (muted) text instead of `--accent` — visually de-emphasized relative to confident links, signaling lower certainty without looking broken
- Optional tooltip on hover: "We're not fully certain where this was said — showing the closest match."

### 4.3 Implementation note for Codex

The drawer/evidence-row component should accept `anchor_method` as a prop (already present in `evidence.metadata` per the brief's data contract) and branch purely on presentation — no new query needed. This is a pure UI fork on existing data, so it can ship in the same pass as the rest of the drawer once `evidence.metadata.anchor_method` is populated by P0.5's re-anchoring work.

If `anchor_method` is missing/null (evidence not yet covered by the P0.5 backfill): treat as the **approximate** state (fail safe toward "don't imply precision").

---

## 5. Mobile / Responsive

- Drawer becomes full-screen sheet below `~640px` (`width: 100vw`, slide up from bottom instead of in from right — consistent with `project-mobile-drawer.tsx` pattern if it already establishes a bottom-sheet convention; otherwise keep slide-from-right but full width, simplest delta).
- Output strip: 3 slots stack vertically, full width, on narrow viewports (no hover-only gating explanation — gated captions render as a visible line under the button, not just a hover tooltip, to satisfy "no hover-only critical actions" / touch reachability).
- Evidence rows: topic chips wrap; quote text keeps line-clamp but at a slightly higher line count (3 vs 2) since width is narrower.
- All section headers remain sticky-scroll-friendly but not pinned (avoid stacking multiple sticky headers in a small viewport).
- Close affordance: ensure the `×` button has a ≥44px touch target even though visually it may render at 30px (padding, not size, increases hit area).

---

## 6. Summary — Needs Backend Support (for Codex)

Consolidated from sections above, in rough priority order:

1. **C4 anchor presentation** — `evidence.metadata.anchor_method` populated by P0.5 (already scoped there; drawer just needs to read it). *Blocking for §4 to be meaningful — without it, all links render as "approximate."*
2. **Source types in Affected Context (§1.4)** — pure join, no schema change: `source_evidence_ids → evidence.source_id → sources.type`, dedupe. Can ship with P1.
3. **Action → Problem link** — `actions.problem_id` (nullable FK). Unblocks the "Action" output-strip slot.
4. **Artifact → Problem link** — `artifacts.source_problem_id` (nullable FK), used to pre-seed `/compose` context. Unblocks "Artifact" slot.
5. **Opportunity object (P3, per Opus decision #4)** — new `opportunities` table distinct from `project_opportunities`, with `problem_id`, `statement`, `status`. Unblocks "Opportunity" slot. Until this exists, the slot stays gated — no UI work blocked on it beyond the static gated state already specified in §2.2.
6. **Structured problem fields (P3)** — `statement`, `who_affected`, `what_is_hard`, `why_it_matters`, `current_tools`, `current_workarounds`, `primary_theme`, `confidence`. Each has a placeholder row already designed (§1.3–§1.6); these can land incrementally — each field's placeholder simply disappears once populated, no layout change needed.
7. **`problem_evidence` typed joins (P3)** — once these exist, "Related evidence (via themes)" becomes "Supporting evidence" (or similar) per the brief's amendment. This is a copy change gated on the join existing, not a layout change.

---

## 7. Accessibility Checklist (applied to this design)

- [x] Drawer is keyboard reachable (tab order: close → status actions → section content → output strip)
- [x] Escape closes drawer; focus returns to the triggering list row
- [x] Focus-visible rings on all buttons/links (existing `--accent` focus ring tokens)
- [x] Gated output-strip buttons use `aria-disabled` (not `disabled`) so AT can read the explanation
- [x] No hover-only critical info — gated captions and C4 approximate labels are always visible, not tooltip-only on touch
- [x] `prefers-reduced-motion` disables skeleton shimmer and `slideL` animation (instant show/hide fallback)
- [x] Deep link support for problem detail (`?problem=<id>`)
- [x] All copy avoids technical identifiers (table names, UUIDs, provider names, stack traces)

---

## 8. Explicitly Out of Scope for This Pass

- §2.1–2.3 evidence multi-lens redesign (Review/Topics/Themes/Problems/Sources tabs) — **P2**, depends on `evidence_topics` / expanded `themes` schema (P3)
- Theme detail page/drawer
- Topic lens
- Any new `dangerouslySetInnerHTML` sink (none introduced — all content here is plain text/structured fields, no rich HTML rendering)
- Tags as first-class objects (per Open Decision #2, deferred)

---

## 9. Opus verdict (2026-06-10) — APPROVED, design-only (P1 scope)

**Approved.** Verified against the live schema and the P0.5 code, not just the brief.

- **C4 wire-compatible** — the confident/approximate split matches the `anchor_method` enum `ingest-source.ts` actually writes; null → approximate fail-safe is correct.
- **Schema assumptions hold** — `evidence_entities`/`people`/`companies` (migs 0006/0007/0014/0016) and `sources.type` (0013) exist; §1.4 chips are real joins. `actions` (0017) has no `problem_id`, so the Action-slot gating is correct.
- **All Opus decisions honored** — "Related evidence (via themes)" verbatim, Topics-not-Themes, Opportunity distinct from `project_opportunities`, nothing auto-accepts, no new `dangerouslySetInnerHTML`.

**Conditions are for Codex at implementation, not for Sonnet:**
1. Extend the C5 tenant-scoping rule to the drawer: `?problem=<id>` fetch + the new joins go through `createClient()` + `getProjectForUser`, `org_id` on every hop, **no `createServiceClient()`**; validate `?problem=<uuid>` against the caller's org.
2. Error/tooltip copy stays literal (no IDs/stack traces/provider names); hold the no-new-`dangerouslySetInnerHTML` line.
3. Map raw `source_type` enum values to display labels in-component.

**Sonnet:** this pass is complete and approved. Hold §2.1–2.3 (P2). Re-engage when Codex wires the P1 query after the backfill dry-run is verified.
