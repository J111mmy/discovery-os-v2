# Design Brief — Structural Page Ports (the real Phase 2)

**Author:** Opus (PM / reviewer)
**For:** Sonnet (Design)
**Source of truth:** `New DiscOS app design/` — `design.md` is the spec, `index_v2.html` + deps are the working prototype. **Prototype wins on everything except where Jimmy has given direct live feedback** (border radii override — keep the tighter Phase 0 values, do NOT restore prototype radii).

---

## 0. Why this brief exists

The earlier "Phase 2" that shipped (`6ade2e7`) was a **color-token + typography reskin** of the existing page structures. It did **not** do what the rebrand brief's Phase 2 (§75–88 of `DESIGN_BRIEF_APP_REBRAND_IMPLEMENTATION.md`) actually calls for: **rebuilding each surface to the `design.md` layouts, wired to real data.** That structural work is this brief. Naming doesn't matter — call these 2A–2H. What matters is none of it gets lost.

Done already (do not redo): Phase 0 (tokens/fonts/theme), Phase 1 (rail shell), the color reskin of all 14 pages, and Phase 3-partial (`doc.css`/`doc_kit.css` + `ArtifactReader` chrome + the live #14 render path).

---

## 1. Global guardrails (apply to every sub-phase)

- **No logic changes.** Visual + structural only. Auth, middleware, route handlers, RLS, data contracts stay as-is. Anything touching those is Opus-gated per `AGENTS.md` — design work shouldn't go near them.
- **Real data, no mocks.** No `window.DATA` in shipped code. Wire to what exists (see §2). Do not invent new data contracts; if a surface needs data that has no source, **stop and flag it** rather than inventing an endpoint.
- **Locked render files stay locked.** `ArtifactReader.tsx`, `documents/[artifactId]/page.tsx` (`toSafeContentHtml`), `doc.css`, `doc_kit.css` — do not touch except in sub-phase **2H**, and even there only the CSS, never the sanitiser wiring.
- **No new `dangerouslySetInnerHTML`.** There are exactly two sanctioned sinks (artifact reader + theme no-flash script). Adding a third is a stored-XSS surface → Opus review.
- **Accent discipline.** `--accent` (`#5b63f0`) only for `btn-primary`, active TOC item, accent spine. Nav selection/hover/badges use neutral `--sel`. (design.md §10.)
- **Light/dark parity on every surface.** Both themes must look intentional. Soft grey light (`#eef0f5`), never harsh white.
- **`focus-visible` rings + `prefers-reduced-motion`** honoured for all animations (design.md §8).
- **One PR per sub-phase.** App stays runnable after each. Easier review, easier rollback.

---

## 2. The real data surface (wire to these)

**List data → server-component Supabase queries** (there are NO collection REST routes):
- Projects list, Workspace metrics → server query in `projects/page.tsx` / `projects/[projectId]/page.tsx`
- Directory lists → server queries in `people/page.tsx`, `companies/page.tsx`, `competitors/page.tsx`

**Detail + action endpoints that exist:**
- `api/projects/[projectId]`, `api/people/[personId]` (+`/affiliation`, `/synthesise`), `api/companies/[companyId]` (+`/synthesise`), `api/competitors/[competitorId]` (+`/synthesise`)
- `api/sources/[sourceId]` (+`/actions`), `api/ingest` (+`/extract-text`, `/retry`, `/status`)
- `api/artifacts/save`, `api/artifacts/[id]/citations`, `api/artifacts/[id]/status`, `api/compose/draft`, `api/ask`, `api/query`, `api/actions/[actionId]`
- New project: existing server action `projects/new/actions.ts`

If a surface in `design.md` needs data not covered above, **flag it to Opus before building** — it may need a Codex endpoint (which I gate), not invented client logic.

---

## 3. Sub-phases (recommended order; each self-contained)

### 2A — Doc-kit primitives + compose pipeline  ⚠️ JOINT (Sonnet + Codex + Opus)
**Why first:** the HTML docs are the hero output, and #14's render path is already live — this is the highest-leverage work.
- **Sonnet:** define the target **primitive markup contract** and style it in `doc_kit.css`: `Hero`, `Section`, `PullQuote`, `StatGrid`, `Callout`, `Takeaway`, `List`, `DataTable`, `BarChart`, `Flow` (design.md §5.3 / prototype `doc_kit.jsx`, `doc_bodies.jsx`, `doc_report.jsx`, `doc_sales.jsx`). Output: the exact HTML element + class shape each primitive must take, plus CSS. **Citations/evidence chips must survive** — traceability is the product.
- **Codex (I gate):** make `markdownToContractHtml` emit that markup, and **expand the sanitiser allowlist** (`artifact-html.ts` ALLOWED_TAGS/CLASSES) to cover the new tags/classes.
- **Opus:** the allowlist expansion is a **B2 change** — every new tag/class/attribute must be re-checked against the contract (no inline style, no SVG/script/iframe, no `on*`/`javascript:`/`data:`). I review before it ships, and re-run the sanitiser fuzz/check.
- **Hand-off rule:** Sonnet's markup contract lands first (as a written spec + CSS), THEN Codex implements the converter to match. Don't build converter and CSS against different shapes.
- **Exit check:** a composed artifact renders with the rich primitives in both themes, citations intact, and the sanitiser check stays green.

### 2B — Workspace (`design.md` §5.1)
- Confidence ring, evidence-by-theme bar chart, teaser row, collapsible project-context card.
- Data: server query on `projects/[projectId]` (counts/metrics from existing tables). Reuse the `BarChart` primitive from 2A if shapes align.
- Out of scope: any new metric the DB can't already produce — flag instead of computing client-side from partial data.
- **Exit check:** Workspace landing matches §5.1 in both themes; metrics reflect real project data; no mock numbers.

### 2C — ⌘K command palette (`design.md` §6)  [cross-cutting primitive]
- Ask + Jump palette. Ask → `api/ask`; Jump → client nav over projects/entities (and/or `api/query` for search). Global keybinding, focus trap, `prefers-reduced-motion`.
- Build as a reusable shell-level component (lives with the rail), since other surfaces reference it.
- **Exit check:** ⌘K opens anywhere, Ask returns answers via the real endpoint, Jump navigates to real routes, keyboard + a11y correct.

### 2D — Modals: Add-evidence + New-Project (`design.md` §7, §5.6)  [cross-cutting primitive]
- **Add-evidence modal** → `api/ingest`. Replaces/augments the rail's "Add evidence" primary.
- **New-Project modal** → wrap the existing `projects/new/actions.ts` server action in a modal (currently a full page at `projects/new`). Keep the action logic untouched; just move the UI into a modal surface.
- **Exit check:** both modals submit to the existing endpoints/actions, validation + error states styled, no logic changed.

### 2E — Directory + entity drawers (`design.md` §5.4)
- Unified row style across People / Companies / Competitors lists (server-queried).
- **Refactor the existing full-page detail views** (`people/[personId]`, `companies/[companyId]`, `competitors/[competitorId]`) into **drawer overlays** opened from the Directory rows. Keep the detail data wiring (`api/.../[id]` + `synthesise`/`affiliation`) — just change the presentation container from page → drawer. No empty detail panes, no full-page profiles.
- **Exit check:** all three directories share one row style and open drawers; synthesise/affiliation actions still work from inside the drawer.

### 2F — Evidence pipeline (`design.md` §5.2)
- Unify `sources` / claims / `problems` into the **Sources / Claims / Problems tabbed** structure. Existing pages (`evidence`, `sources`, `problems`) provide the data; restructure into the tabbed pipeline view.
- Source detail continues to open as a drawer (consistent with 2E).
- **Exit check:** one pipeline surface with three tabs, real counts, drawers for detail; no orphaned old pages.

### 2G — Documents / Studio (`design.md` §5.3)
- Gallery + Compose + Ask studio layout over `documents`, `compose`, `ask`. Reader itself is already done (Phase 3) — this is the surrounding studio chrome and the gallery.
- **Exit check:** studio layout matches §5.3; gallery lists real artifacts; Compose/Ask wired to `api/compose/draft` / `api/ask`; opening a doc lands in the existing locked reader.

### 2H — Settings Billing tab (`design.md` §5.5)
- Settings already has Appearance + Team. Add the **Billing** tab to complete §5.5. If billing has no backing data/endpoint yet, ship the tab shell + "Coming soon" (same pattern as the Team invite form) and flag the gap — do not invent billing logic.
- **Exit check:** three tabs present; Billing either wired to a real source or explicitly stubbed; Team behaviour unchanged.

---

## 4. Recommended sequence + rationale

`2A → 2C → 2D → 2B → 2E → 2F → 2G → 2H`

- **2A first** — hero output, ties to live #14, and the joint Sonnet/Codex/Opus coordination benefits from being settled early.
- **2C/2D next** — ⌘K and the modals are reused by later surfaces; building them once avoids rework.
- Then the surfaces (**2B, 2E, 2F, 2G**), then **2H** cleanup tab.

Order can flex — each is a standalone PR — but 2A's markup contract should land before its converter half, and 2C/2D before the surfaces that embed them.

---

## 5. Final pass (after all sub-phases) — migration-alias removal

Once every surface is ported, do ONE cleanup PR removing the transition aliases (`--brand`, `--border`, `--ink-muted`, `--surface-0/1`). **Not before** — the structural ports may still reference old names mid-transition. Grep for zero remaining references, then delete. This is the only deferred hygiene item and it's explicitly last.

---

## 6. What routes back through Opus

- **2A** — sanitiser allowlist expansion (B2). Mandatory review.
- Any surface that turns out to need a **new endpoint** (flag it; Codex authors, Opus gates).
- Anything that would add a third `dangerouslySetInnerHTML` or touch auth/RLS/middleware.

Everything else is design-lane and yours to ship one PR at a time.
