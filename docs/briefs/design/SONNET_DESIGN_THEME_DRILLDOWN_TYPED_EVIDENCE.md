# Design Proposal — Theme Drilldown + Typed Evidence (#29 + #28)

**Status:** Design proposal, ready for Opus/Codex review.
**Author:** Sonnet
**Date:** 2026-06-11
**Responds to:** `docs/briefs/design/SONNET_BRIEF_THEME_DRILLDOWN_TYPED_EVIDENCE.md`
**Builds on:** `docs/briefs/design/SONNET_DESIGN_PROBLEM_INTELLIGENCE_P1.md` (Jun 10, problem drawer P1, shipped `33ab407`)

---

## 0. Summary and staging

The brief asks for three connected surfaces (themes browse+detail, problem-drawer typed evidence,
topics placement, opportunities naming). I'm staging the build so Codex can ship the highest-value
slice first:

| Stage | Scope | Why this order |
|---|---|---|
| **P1** | Problem drawer: migrate "Related evidence (via themes)" and "Themes and topics" to the typed `problem_evidence` / `problem_themes` / `problem_topics` tables. New grouping by `relationship`, visible `rationale` + `review_state`, honest mixed-provenance empty states, themes become clickable links. | Most urgent per Opus — the team is reviewing AI-suggested problems *today* and this is the surface they're already looking at. No new route needed. |
| **P1.5** | §2.4 — rename the workspace "Opportunities" teaser to remove the naming collision with the new `opportunities` table. UI copy/label change only, one file. | Small, unblocks #27's link target and #25's eventual surface; worth doing alongside P1 since it's in the same review pass. |
| **P2** | New themes browse (`/projects/{id}/themes`) and theme detail (`/projects/{id}/themes/{themeId}`) pages — §2.1, plus topics surfaced on theme detail — §2.3. | New route + new page; larger build. The P1 typed-evidence links in the problem drawer point here once it exists (P1 ships an interim link target in the meantime — see §1.2). |

A key finding that simplifies all of this: **the 0030 backfill already populated `problem_evidence`
and `problem_themes` for every existing problem** (with `relationship='provenance'`,
`source='imported'`, and a generic backfill `rationale`). That means **the typed tables are now a
complete superset of the legacy `source_evidence_ids` / `source_theme_ids` arrays** — the UI can read
*exclusively* from `problem_evidence` / `problem_themes` / `problem_topics` going forward. No
dual-read, no legacy fallback. The only thing that varies is whether a row's `relationship` is
`provenance` (legacy/unassessed) or `supporting`/`contradicting`/`example`/`edge_case` (P3-assessed).
That single field is the mixed-provenance signal the whole design hangs on.

---

## P1 — Problem Drawer: Typed Evidence Migration

### 1.1 What changes vs. the Jun-10 P1 design

The Jun-10 design rendered `detail.evidence` (resolved from `problem.source_evidence_ids`) under the
heading **"Related evidence (via themes)"**, with a tooltip explaining it was theme-provenance, not
individually-assessed support. **That constraint is lifted.** The section is renamed **"Evidence"**
and is now grouped by `problem_evidence.relationship`, with each group visually and semantically
distinct.

The query swaps from:
```
problems.source_evidence_ids (text[]) → evidence.id IN (...)
```
to:
```
problem_evidence WHERE problem_id = :id
  → evidence_id → evidence / sources / source_segments  (same join shape as before)
  → relationship, rationale, review_state, confidence, source, agent_run_id  (new)
```

### 1.2 Evidence section — grouping and visual treatment

Render up to four groups, in this order, **each only rendered if it has rows**:

1. **Supporting** (`relationship = 'supporting'`)
   - Section label: "Supporting evidence"
   - Badge: small pill, `border-pos/25 bg-pos-bg text-pos`, label "Supports"
2. **Contradicting** (`relationship = 'contradicting'`)
   - Section label: "Contradicting evidence"
   - Badge: `border-info/25 bg-info-bg text-info`, label "Contradicts"
   - **Deliberately not `--neg` (red/error styling).** Per the brief, contradicting evidence is a
     credibility feature — it shows the agent surfaced a counter-signal rather than cherry-picking.
     `--info` (blue) reads as "a different angle," not "something is wrong." Pair with a one-line
     framing note above the group (see copy below).
3. **Example / Edge case** (`relationship IN ('example','edge_case')`)
   - Section label: "Examples and edge cases"
   - Badge: `border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink-2)]`, label = `"Example"` or
     `"Edge case"` (title-cased from the enum value)
   - Secondary/collapsed by default if the Supporting/Contradicting groups are non-empty (see §1.5
     density rules)
4. **Linked, not yet assessed** (`relationship = 'provenance'`)
   - Section label: "Linked, not yet individually assessed"
   - Badge: `border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink-faint)]`, label "Unassessed"
   - This is the legacy-backfill bucket. Always rendered last, and visually quieter (lower-contrast
     border, no colored badge) so it doesn't compete with assessed evidence.

Each evidence card keeps the existing chrome (summary, content, topic chips, trust pill, source
type/speaker, `EvidenceLink` C4 anchor) and adds, directly under the relationship badge:

- **Rationale** — `problem_evidence.rationale`, rendered as a short italic line:
  `"Why linked: {rationale}"`. For `provenance` rows this will be the generic backfill string
  ("Backfilled from legacy problems.source_evidence_ids; not assessed direct support.") — **render
  it anyway**, don't special-case it away. Seeing the same boilerplate on every "Unassessed" card
  reinforces that the group is mechanically generated, which *is* the honest signal.
- **Review state** — small dot + label, only shown for `suggested` and `edited` (the states a
  reviewer should notice):
  - `suggested` → `--warn` dot, label "Needs review"
  - `edited` → `--info` dot, label "Edited by reviewer"
  - `accepted` → no badge (the default/expected state once reviewed; showing a badge for every
    accepted row would be visual noise)
  - `rejected` / `archived` → **row is filtered out of the list entirely** (a reviewer already
    dismissed this link). If this removes evidence that would otherwise have been the *only*
    evidence shown, fall through to the empty-state copy in §1.4, and add one caveat line:
    `"{N} evidence link(s) were reviewed and removed."` in the Gaps & caveats section.

**Confidence** (`problem_evidence.confidence`, low/medium/high) is used for **sort order within each
group** (high → medium → low → null), not shown as its own badge — it would be a fourth badge
competing with relationship/review-state/trust, and confidence is closer to "how sure was the agent"
than "what should the reviewer look at first," which `relationship` + `review_state` already cover.

### 1.3 Themes section — typed relationships, clickable

Replace the current index-based "Primary theme / Contributing theme" guess (`index === 0 ? "Primary"
: "Contributing"`) with the actual `problem_themes.relationship`:

- **Primary theme(s)** (`relationship = 'primary'`) — rendered first, label "Primary theme"
- **Contributing themes** (`relationship = 'contributing'`) — label "Contributing theme"
- **Linked themes** (`relationship = 'provenance'`, legacy backfill) — label "Linked theme
  (unassessed)", same quiet styling as the evidence "Unassessed" group

Each theme card becomes a `<Link>`. **Target for P1** (before the P2 theme-detail page exists):
`/projects/{projectId}/evidence?theme_id={theme.id}` — this route already exists and works (it's the
`ThemeLens` deep-link target in `evidence-browser.tsx`, confirmed in `UI_AUDIT.md` §1). It's not the
final destination, but it's a real, working "go look at this theme's evidence" link today, which is
strictly better than the current non-clickable cards.

**P2 migration note for Codex:** once `/projects/{id}/themes/{themeId}` exists (§2.2), change this one
`href` to point there. No other change needed — the card content (label, `central_concept` /
`interpretation` / `description` snippet, relationship badge) is the same in both targets.

Also surface, per theme card, the theme's own `central_concept` and `interpretation` (new P3 fields on
`themes`, currently unused in the drawer) where present — one line each, below the existing
`description`:

```
{theme.label}                         [Primary theme]
{theme.central_concept}               ← new, shown if non-null
{theme.interpretation}                ← new, shown if non-null, italic
{theme.description}                   ← existing
```

If all three are null, keep the existing "no description" silence (don't render empty labels).

### 1.4 Topics placement (§2.3) for the problem drawer

Replace the current "Provenance topics" chip row — which today derives from
`evidence.themes` (a legacy free-text array on each evidence record, conflating topics with themes) —
with `problem_topics`, joined to `topics.label`.

- Section label: **"Topics"** (not "Provenance topics" — `problem_topics.relationship` defaults to
  `provenance` for essentially all rows regardless of P3/legacy status, so "provenance" isn't a useful
  qualifier here the way it is for evidence/themes; it would just be confusing label noise).
- Render as the existing `Chip` row, same visual treatment as before.
- Keep this **below** the Themes section, not interleaved — topics are descriptive/granular, themes
  are interpretive (per the brief's framing), and the visual hierarchy (Themes, then Topics) reflects
  "broad interpretation first, granular tags second."
- No click target for topic chips in P1 — topic detail/filtering by topic is part of the evidence
  browser's existing `TopicLens` (`/evidence?theme={label}`); linking individual chips there is a
  cheap follow-up but not blocking. **Open decision for Opus**: do we want topic chips in the drawer
  to link to `/evidence?theme={label}` now (zero new code, reuses an existing route) or hold for P2?
  I'd lean "do it in P1" since it's a one-line change once the chip data exists — flagging as a
  decision rather than assuming.

### 1.5 Honest empty / mixed-provenance states

This is the core of the #29 "honest empty states" requirement. Because `problem_evidence` is now a
complete superset (§0), **every problem will have at least the backfilled `provenance` rows** unless
`source_evidence_ids` was originally empty. So the real state space is:

| State | Condition | Evidence section renders |
|---|---|---|
| **Rich / P3-assessed** | ≥1 row with `relationship IN (supporting, contradicting, example, edge_case)` | Grouped sections per §1.2, assessed groups first |
| **Legacy only** | All rows have `relationship = 'provenance'`, `source = 'imported'` | Single "Linked, not yet individually assessed" group only, **plus a one-line explainer above it**: *"This problem was identified before evidence-grounded review. The links below come from the original theme analysis and haven't been individually checked against this specific problem."* |
| **Empty** | Zero `problem_evidence` rows (possible if `source_evidence_ids` was empty pre-backfill, or all rows were `rejected`/`archived`) | *"No evidence linked to this problem yet."* — same as the Jun-10 P1 empty copy, still correct |
| **Mixed** | Both assessed and `provenance` rows present | Assessed groups render normally; the "Linked, not yet individually assessed" group renders last with **no** explainer line (its own badge styling already communicates "different tier") — avoids redundant copy when the problem also has real assessed evidence |

Same logic applies to the Themes section, substituting `problem_themes` / `relationship IN (primary,
contributing)` vs `provenance`.

For the **Contradicting** group specifically, add one framing line the first time it renders (not
repeated per-card): *"The agent also found evidence that complicates or pushes back on this problem —
shown here for your review, not hidden."* This directly operationalizes "contradicting evidence is a
feature, not an error" as copy a reviewer will actually read.

### 1.6 Reviewer actions — explicitly deferred, flagged as a dependency

The brief (§5) flags that accept/reject actions on `review_state` "may need a small route." **P1 does
not include reviewer actions** — `review_state` is read-only/display-only in this stage (the
"suggested" / "edited" badges from §1.2). Adding accept/reject buttons would require:
- A new mutation route (e.g. `PATCH` on `problem_evidence`/`problem_themes` scoped by org/project/problem,
  setting `review_state` + `accepted_by`/`accepted_at`)
- Concurrent-edit handling consistent with whatever pattern the rest of the app uses for
  reviewer-initiated state changes

This is real, valuable follow-on work (it's *the* human-in-the-loop loop the brief frames as the
point), but it's a backend-touching change that needs its own C5 review — I'm flagging it as **P1.5 or
P2 work for Codex/Opus to scope separately**, not bundling it into this design's first slice.

### 1.7 Data needed (exact shapes for Codex)

Replace the `getProblemDetail()` evidence/theme/topic resolution in `problems/page.tsx` with:

```sql
-- Evidence (replaces source_evidence_ids resolution)
problem_evidence
  WHERE org_id = :org AND project_id = :project AND problem_id = :problem
    AND review_state NOT IN ('rejected', 'archived')
  SELECT evidence_id, relationship, rationale, review_state, confidence, source, agent_run_id
-- then join evidence/sources/source_segments/evidence_entities exactly as today, keyed by evidence_id

-- Themes (replaces source_theme_ids resolution)
problem_themes
  WHERE org_id = :org AND project_id = :project AND problem_id = :problem
  SELECT theme_id, relationship, rationale, review_state, source
-- then join themes, additionally selecting central_concept, interpretation (new columns)

-- Topics (new)
problem_topics
  WHERE org_id = :org AND project_id = :project AND problem_id = :problem
  SELECT topic_id, relationship, rationale
-- then join topics, selecting id, label
```

`ProblemDetail` type additions (`problems-list.tsx`):
```ts
evidence: Array<{
  // ...existing fields unchanged...
  relationship: "supporting" | "contradicting" | "example" | "edge_case" | "provenance";
  rationale: string | null;
  review_state: "suggested" | "accepted" | "edited" | "rejected" | "archived";
  confidence: "low" | "medium" | "high" | null;
}>;
themes: Array<{
  // ...existing fields unchanged...
  central_concept: string | null;
  interpretation: string | null;
  relationship: "primary" | "contributing" | "provenance";
}>;
topics: Array<{ id: string; label: string }>;  // new top-level field on ProblemDetail
```

`unavailable_evidence_count` / `related_evidence_label` can be retired — `problem_evidence` rows
always resolve (no orphaned-ID case like the legacy array had, since it's a real FK-joined table), so
the "some records are unavailable" caveat no longer applies. Replace the header subtitle
(`detail.related_evidence_label`) with a count derived from the resolved groups, e.g. `"3 supporting ·
1 contradicting · 6 unassessed"` (omit zero-count groups, join with " · ").

---

## P1.5 — Opportunities naming (§2.4)

**Recommendation:** rename the workspace teaser card label from **"Opportunities"** to **"Suggested
workspaces"**, matching what it already says in its expanded header ("Signals for new workspaces" /
"Evidence pointing at adjacent discovery areas" — `workspace-client.tsx` ~line 1126). This is a
one-label change (`TeaserCard label="Opportunities"` → `label="Suggested workspaces"`,
`workspace-client.tsx` ~line 1086) plus the `id="opportunities"` anchor can stay as-is (internal id,
not user-facing).

**Rationale:**
- `project_opportunities` *is* "suggested workspaces" — the expanded section already says so. The
  teaser label is the only place still calling it "Opportunities," and it's the collision point with
  the new `opportunities` table.
- This reserves "Opportunity" / "Opportunities" exclusively for the new problem-linked
  `opportunities` table (schema-only until #25). The P1 problem-drawer output strip's "Opportunity"
  slot (gated, "Opportunity creation needs a backend update. Coming soon.") now unambiguously refers
  to the same concept as a future workspace-level "Opportunities" surface — when #25 ships, both can
  use the same word without collision.
- **No retirement** of `project_opportunities` / the "suggested workspaces" feature — it's a useful,
  working signal (adjacent discovery areas). Renaming the label is the entire change.

**Open decision for Opus:** should the *expanded* section heading also change from "Signals for new
workspaces" to something tighter like "Suggested workspaces" for consistency with the renamed teaser?
I'd lean yes (one more line, same file, ~line 1126) but it's cosmetic enough that I'd rather Opus call
it than bundle it silently.

---

## P2 — Themes Browse + Theme Detail (§2.1)

### 2.1 Drawer vs. page — decision

**Theme detail is a full page**, not a drawer. Justification (per the brief's "make the call"):

- The problem drawer (P1) works as a drawer because it's a *triage* surface — you're scanning a list
  of problems, popping one open to check status/evidence, closing it, moving to the next. The list
  underneath stays visible/contextual.
- Theme detail is closer to **source detail** (`/sources/[sourceId]`, already a full page): it has
  its own substantial content (central concept, interpretation, description, a potentially long
  evidence list, a list of problems it feeds) and is a *destination* reached from multiple places
  (themes index, problem drawer theme links, evidence browser `ThemeLens`, topic chips). A drawer
  stacked on top of whatever surface you arrived from would either need to support drawer-on-drawer
  (the problem drawer is already a drawer) or replace it awkwardly.
- A page gets a real URL (`/projects/{id}/themes/{themeId}`) that's shareable/bookmarkable and back-
  button-friendly — useful when a reviewer wants to send a teammate "look at this theme."

The **themes index** (`/projects/{id}/themes`) reuses the same page chrome as `/problems` and
`/evidence` (heading, `PipelineRail`, card-list layout) — no new visual language.

### 2.2 Themes index

Route: `/projects/{projectId}/themes`. List `themes` for the project, one card per theme:

- Theme `label` (links to detail page)
- `status` pill (`draft` / `reviewed` / `accepted` / `archived`) — reuse the `StatusPill` pattern
  from `problems-list.tsx`, new color mapping:
  - `draft` → `--ink-2` / surface-2 (neutral, "not yet looked at")
  - `reviewed` → `--info`
  - `accepted` → `--pos`
  - `archived` → `--ink-faint`, and **archived themes are excluded from the default list view**
    (toggle to show, similar to how excluded evidence works in the evidence browser)
- `evidence_count` (existing column — the support count)
- Count of problems this theme feeds (`problem_themes` reverse count)
- One-line preview: `central_concept` if present, else `description`, else
  *"No summary yet."*

**Sorting:** default by `evidence_count` descending (most-supported themes first — these are the ones
most likely to already feed problems and be worth reviewing). Secondary sort options: alphabetical,
most-recently-updated (`updated_at`, new trigger-maintained column from 0030).

**Empty states:**
- **No themes at all** (project hasn't run synthesis): *"No themes yet. Trust evidence and run
  synthesis to discover themes."* — mirrors the existing "Trust evidence and run synthesis..." copy
  already used in `workspace-client.tsx`.
- **Rich** (50+ themes, brief's stated upper bound ~200): straightforward pagination or
  virtualized list — given 200 is the realistic ceiling and each card is small, a simple "load more /
  show 50 at a time" button (same pattern as `ProblemEvidenceList`'s "Show all N" button) is
  sufficient; no need for full virtualization at this scale.

### 2.3 Theme detail page

Route: `/projects/{projectId}/themes/{themeId}`.

Sections, top to bottom:

1. **Header** — `label` (h1), `status` pill, `confidence` (low/medium/high, small label), `source`
   (ai/human/imported — small label, e.g. "Identified by synthesis" for `ai`).
2. **Interpretation** — `central_concept` (lead line, larger/bolder), `interpretation` (body text),
   `description` (existing field, supplementary). If all three are null: *"No interpretation recorded
   for this theme yet."*
3. **Evidence** — `theme_evidence` joined to `evidence`/`sources`/`source_segments`, **same grouping
   pattern as the P1 problem drawer** (§1.2): Supporting / Contradicting / Example & edge case /
   Unassessed (`provenance`), same badges, same rationale + review_state display, same `EvidenceLink`
   C4 anchors to `/sources/{sourceId}#segment-{segmentId}`. This is the literal "reuse established
   chrome" instruction — I'd factor the grouped-evidence-list component out of `problems-list.tsx`
   into a shared component (e.g. `RelationshipEvidenceList`) used by both the problem drawer and theme
   detail, rather than duplicating the grouping/badge logic. **Flagging this as a refactor decision
   for Codex** — low risk (pure extraction, same props shape) but touches a file Opus C5-reviewed for
   P1, so worth a quick conditions-still-hold check rather than assuming.
4. **Topics** (§2.3 placement) — `theme_topics` joined to `topics.label`, shown as a chip row labeled
   "Topics", with `relationship` (`contributing`/`primary`/`provenance`) used only for sort order
   (contributing/primary first), not shown as a badge — same "don't stack a fourth badge" reasoning as
   §1.2.
5. **Problems this theme feeds** — reverse `problem_themes` lookup (`theme_id = :themeId`), joined to
   `problems`. Each row links to `/projects/{projectId}/problems?problem={problemId}` (opens the P1
   drawer directly — this route/param already works). Show `relationship` (primary/contributing) as a
   small label per row, and the problem's `severity`/`status` pills (reuse `SeverityPill`/`StatusPill`
   from `problems-list.tsx` — both already exported-shape components, easy to share).
   - **Empty:** *"No problems reference this theme yet."*

### 2.4 Data needed (theme detail)

```sql
themes WHERE org_id = :org AND project_id = :project AND id = :themeId
  SELECT id, label, description, central_concept, interpretation, status, source,
         review_state, confidence, evidence_count, updated_at

theme_evidence WHERE theme_id = :themeId
  SELECT evidence_id, relationship, rationale, review_state, confidence, source
  -- then evidence/sources/source_segments joins as in problem drawer

theme_topics WHERE theme_id = :themeId
  SELECT topic_id, relationship, rationale
  -- then topics: id, label

problem_themes WHERE theme_id = :themeId  (reverse lookup)
  SELECT problem_id, relationship
  -- then problems: id, title, severity, status
```

Themes index query:
```sql
themes WHERE org_id = :org AND project_id = :project AND status != 'archived'
  SELECT id, label, central_concept, description, status, evidence_count, updated_at
  ORDER BY evidence_count DESC

-- problem counts: GROUP BY theme_id on problem_themes, or a per-theme count query
```

---

## States summary (loading / empty / error)

| Surface | Loading | Empty | Error |
|---|---|---|---|
| Problem drawer — Evidence | *(unchanged from P1 — skeleton blocks)* | See §1.5 table | *(unchanged — "We could not load this problem. Try again.")* |
| Problem drawer — Themes/Topics | *(unchanged)* | "No themes linked yet." / no Topics section rendered if `problem_topics` empty | *(unchanged)* |
| Themes index | Skeleton cards (reuse `SkeletonBlock` from P1 work) | "No themes yet. Trust evidence and run synthesis to discover themes." | "We could not load themes. Try again." (same literal-error pattern as problems page — no internals leaked) |
| Theme detail | Skeleton header + sections | Per-section empty copy in §2.3 (interpretation / evidence / topics / problems each degrade independently — a theme can have evidence but no problems yet, etc.) | "We could not load this theme. Try again." + link back to themes index |

---

## Accessibility

- Themes index and theme detail follow the same patterns as `/problems` and `/sources/[sourceId]`
  (already-audited pages) — no new patterns introduced.
- Relationship/review-state badges are not color-only: each carries a text label (`Supports`,
  `Contradicts`, `Example`, `Edge case`, `Unassessed`, `Needs review`, `Edited by reviewer`) so they
  read correctly without color (screen readers, color-blind users).
- Theme detail page heading hierarchy: `h1` = theme label, `h2` per section (Interpretation, Evidence,
  Topics, Problems this theme feeds) — matches source detail page conventions.
- Grouped evidence sections use `h3`/`h4` for relationship-group headers (Supporting evidence,
  Contradicting evidence, etc.) so screen-reader users can navigate by heading to the group that
  matters to them (e.g., jump straight to "Contradicting evidence").

---

## Out of scope (this proposal)

- Reviewer accept/reject actions on `review_state` (§1.6 — flagged as separate dependency)
- Opportunity detail page / `opportunities` table UI (schema-only until #25 — output strip stays
  gated as designed in P1)
- Compose/artifact traversal of the problem→theme→evidence chain (#26 — separate from this UI work)
- Evidence multi-lens redesign (§2.1–2.3 of the original P1 brief — still held, separate from this
  brief's §2.1 "themes browse," which is a different numbering scope)
- Topic detail pages (topics remain chip-level navigation into the existing evidence browser
  `TopicLens`, per §1.4)

---

## Open decisions for Opus/Codex (collected)

1. **§1.4** — should problem-drawer topic chips link to `/evidence?theme={label}` in P1 (zero new
   routes, reuses existing filter), or hold until P2?
2. **§1.5/§1.6** — confirm P1 ships read-only `review_state` display with reviewer actions deferred to
   a separately-scoped P1.5/P2 (new mutation route, C5 review).
3. **§2.3 item 3** — extracting a shared `RelationshipEvidenceList` component used by both the problem
   drawer and theme detail: confirm this doesn't reopen the P1 C5 review of `problems-list.tsx` (it's
   a pure extraction, same query/props shape, but flagging since that file was explicitly reviewed).
4. **P1.5** — confirm the "Suggested workspaces" rename (teaser label only, vs. also renaming the
   expanded section heading) in `workspace-client.tsx`.
