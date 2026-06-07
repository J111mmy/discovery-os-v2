# Design Brief — App Rebrand Implementation (prototype → live app)

**Author:** Opus 4.8 (PM / reviewer)
**For:** Sonnet (Design)
**Reference (source of truth):** `New DiscOS app design/` — and within it, `design.md` is the spec, `index_v2.html` + its deps are the working prototype. **If anything here conflicts with the prototype, the prototype wins.**

> Scope note: This is a **visual / structural** rebrand. Do **not** change auth logic, route-handler behaviour, middleware route-protection, RLS, or data-fetching contracts. Reskin and restructure the UI only. (If you touch `(auth)/login` or any public page, restyle the markup — leave the logic alone.)

---

## 1. Why this exists

Two goals, one system:

1. **Reskin + restructure the app** from the current dark-only, purple/Inter, top-bar-ish layout to the new navy+light, indigo/Geist, **rail-only** design in the prototype.
2. **Establish the document-primitive kit** (`doc.css`, `doc_kit.css`, `doc_*.jsx`) as the styling layer for the **HTML documents the app generates** (ties directly into the upcoming `#14 Markdown → HTML artifact` migration). Composing beautiful, source-traceable HTML docs is the hero output — this kit is how they look.

The shell rebrand and the artifact-HTML work share the same CSS tokens and primitives. Build the tokens once; both consume them.

---

## 2. Current state (what you're migrating FROM)

- **Styling:** Tailwind + a CSS-variable `:root` block in `src/app/globals.css`. Dark-only.
- **Tokens today:** `--surface-0..3` (#0d0d10 charcoal), `--brand` #7c6dfa (purple), Inter, `--ink*`. Mirrored in `tailwind.config.js` under `colors.{surface,brand,tone,ink}`.
- **Component library:** essentially none. `src/components/ui/` is **empty**; `src/app/(app)/components/` has only `user-menu.tsx`. Pages use inline Tailwind. → Low rewrite cost, lots of freedom.
- **App routes (App Router):** `(app)/` group with `layout.tsx` + `projects`, `people`, `companies`, `competitors`; `(auth)/` (login, callback, reset-password); `accept-invite`; `invite/[token]`; plus `api/*` (actions, artifacts, ask, compose, ingest, sources, etc.).

**The unlock:** because everything already flows through CSS variables in `:root` and Tailwind reads those, swapping the **token values** reskins the entire app in one low-risk step before any structural work.

---

## 3. Target state (what you're migrating TO)

Everything in `design.md`. The non-negotiables from it:

- **Rail-only navigation**, no persistent top bar. 240px expanded / 52px collapsed. Active-project bordered container; inactive projects switch inline (no "back to all projects").
- **Two themes**, `[data-theme="dark"|"light"]` on `<html>`, persisted to `localStorage("discos-theme")`. Dark = navy `#0b1124`. Light = soft grey `#eef0f5` (never harsh white).
- **One accent, one use:** `--accent` `#5b63f0` only for `btn-primary`, active TOC item, accent spine. Nav selection/hover/badges use neutral `--sel`. (See `design.md` §10 "What not to do".)
- **Fonts:** Geist (UI), Geist Mono (kbd/counters), Newsreader (serif — document bodies only).
- **Three layout modes:** Canvas / Reader / Canvas (per `design.md` §2.5).
- **Drawers** for all detail views (sources, entity profiles). No empty detail panes, no full-page profiles.
- **Unified Directory** list style across People/Companies/Competitors → all open drawers.
- **⌘K palette** (Ask + Jump), **Add-evidence modal**, **New Project modal**, **Document reader** with TOC + reading-progress + rich primitives.

---

## 4. The porting problem (read this before coding)

The prototype is **vanilla JSX mounted via `window.*` globals against a `window.DATA` mock** (`shell_v2.jsx`, `doc_kit.jsx`, `data.js`, `icons.jsx`). The live app is **typed React + Next App Router with real API routes**. So porting ≠ copy-paste. For each prototype file you must:

1. Convert `window.Icon` / `window.DK` / global components into real exported TSX components under `src/components/`.
2. Replace `window.DATA` mock reads with the app's **real data** — props from server components, or the existing `api/*` endpoints. **Do not invent new data contracts;** wire to what exists (`api/projects`, `api/people`, `api/companies`, `api/competitors`, `api/sources`, `api/artifacts`, `api/ask`, `api/compose`, `api/actions`, `api/ingest`).
3. Keep CSS as close to the prototype as possible — port `styles.css` / `app.css` / `doc.css` / `doc_kit.css` largely verbatim into the app's CSS layer.

**Decision for you to make and document in your first reply:** do we keep the prototype's hand-written CSS classes (`.btn-primary`, `.card`, `.snav-item`, …) as a global stylesheet, or express tokens through Tailwind and rebuild components as Tailwind? **Recommended:** port the prototype CSS as authored (it's complete and battle-tested in the prototype), point Tailwind's `theme.colors` at the same CSS variables so existing utility classes keep resolving during the transition, and only Tailwind-ify net-new components. Confirm this choice before Phase 1.

---

## 5. Phased plan

### Phase 0 — Tokens + fonts (whole-app reskin, lowest risk)
- Replace the `:root` values in `globals.css` with the prototype's dark tokens; add the `[data-theme="light"]` block. Bring across radii, shadows, `--ease`, semantic colours, badge backgrounds (all in `design.md` §3).
- Repoint `tailwind.config.js` `colors` to `var(--…)` so existing Tailwind classes adopt the new palette automatically. Map old names → new (`brand`→`accent`, `surface-0`→`bg`, etc.) so nothing 404s mid-migration.
- Swap fonts: Inter → Geist; add Geist Mono + Newsreader (Newsreader scoped to document bodies only). Use `next/font` or Google Fonts per `design.md` §3.5.
- Theme toggle component + `localStorage("discos-theme")` + no-flash inline script on `<html>`.
- **Exit check:** app still runs; every existing page now renders in navy dark + has a working light mode, with zero structural changes yet.

### Phase 1 — The shell (rail)
- Build `RailV2` (expanded/collapsed, active-project container, sub-items with accent spine, Directory section, Account/Settings, Add-evidence primary, avatar→sign-out) as the new `(app)/layout.tsx` chrome. Remove any top bar.
- Mobile (<860px): hide rail, sticky top bar + bottom 4-tab bar + FAB, per `design.md` §2.6.
- Wire nav to real routes; project switching is inline.
- **Exit check:** every existing route renders inside the new rail; nav + theme + collapse all work; sign-out still works (don't touch its handler).

### Phase 2 — Page ports (one PR per surface)
Port in this order, each wired to real data, each a self-contained PR:
1. **Workspace** (`design.md` §5.1) — confidence ring, evidence-by-theme bar chart, teaser row, collapsible project-context card.
2. **Evidence pipeline** (§5.2) — Sources / Claims / Problems tabs.
3. **Directory** (§5.4) — unified rows + drawers for People/Companies/Competitors.
4. **Documents / Studio** (§5.3) — gallery + Compose + Ask.
5. **Settings** (§5.5) — Appearance / Team / Billing tabs (Team = the only place to manage membership).
6. **⌘K palette** (§6), **Add-evidence modal** (§7), **New Project modal** (§5.6).
- **Exit check:** no route still renders old layout; accent discipline respected; light/dark parity on every page.

### Phase 3 — Document kit (the HTML-artifact styling layer)
- Port `doc.css` + `doc_kit.css` + the doc primitives (`doc_kit.jsx`, `doc_report.jsx`, `doc_bodies.jsx`, `doc_sales.jsx`, `documents.jsx`) into real components: reader chrome (sticky toolbar, reading-progress bar, sticky TOC, paper column) + primitives (`Hero`, `Section`, `PullQuote`, `StatGrid`, `Callout`, `Takeaway`, `List`, `DataTable`, `BarChart`, `Flow`, `Split`).
- **This is the dependency hand-off to `#14 Markdown → HTML`:** the compose/artifact pipeline must emit markup that maps onto these primitives so generated documents render beautifully and traceably. Coordinate with whoever takes #14 — Phase 3 here unblocks that. Citations/evidence chips must survive (traceability is the product).
- **Exit check:** an existing artifact renders in the new reader with the primitives, in both themes, with citations intact.

---

## 6. Guardrails

- **No logic changes.** Visual + structural only. Auth, middleware, route handlers, RLS, data contracts stay exactly as they are. (Anything touching those is gated to Opus per `AGENTS.md` — but design work shouldn't go near them.)
- **Replace, don't duplicate, the mock.** No `window.DATA` in shipped code — wire real data.
- **Accent discipline** (only `btn-primary`), **light/dark parity** on every surface, **focus-visible rings**, **`prefers-reduced-motion`** honoured for the animations in `design.md` §8.
- **Incremental.** App stays runnable after every phase; one PR per surface in Phase 2.
- **Don't pre-build for layouts that may move.** If a surface isn't in `design.md`, ask before inventing it.

---

## 7. Decisions (resolved — start Phase 0)

All four kickoff questions are now decided. Override only with a written rationale.

1. **CSS strategy — PORT PROTOTYPE CSS AS AUTHORED.** Bring `styles.css` / `app.css` / `doc.css` / `doc_kit.css` across largely verbatim; point `tailwind.config.js` `theme.colors` at the same CSS variables so existing Tailwind utility classes keep resolving during the transition. Only Tailwind-ify net-new components. (No full Tailwind rebuild.)
2. **Fonts — `next/font`** (bundled, no FOUT, self-hosted). Geist (UI), Geist Mono (kbd/counters), Newsreader (document bodies only).
3. **Accent — indigo `#5b63f0` is final** (Jimmy, 2026-06-05). Replaces `#7c6dfa` everywhere. Invite email already swapped; everything else adopts it via the Phase 0 token change.
4. **Sequencing vs. `#14` — shell rebrand (Phases 0–2) lands first/independently;** Phase 3 (doc-kit) is the hand-off into the `#14` Markdown→HTML migration and must be coordinated with whoever owns #14 so the doc-styling work isn't done twice.
5. **Border radii — OVERRIDDEN below prototype spec** (Jimmy, Phase 0): the prototype's radii felt too round, so Phase 0 ships tighter values (e.g. `--r-md` 8px vs prototype 12px, `--r-lg` 10px vs 16px). **This override stands — do NOT "restore" the prototype radii under the "prototype wins" rule.** The prototype wins on everything *except* where Jimmy has given direct live feedback; this is one such case.
