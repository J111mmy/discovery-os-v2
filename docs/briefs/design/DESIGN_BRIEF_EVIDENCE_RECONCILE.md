# Design Brief — Evidence browser: fold speaker-hide into the redesign (Cut #3)

**Lane:** Design (Sonnet). Client-side UI only. **Do not** touch data fetching,
queries, server actions, endpoints, RLS, or `evidence/page.tsx` data wiring —
that half is Opus's integration job and is gated.

**Owner of decisions:** Jimmy (answers captured below). Build to these; don't
re-decide.

---

## Why this exists

Two changes edited `evidence/evidence-browser.tsx` off the same old base and now
must merge:

1. **Cut #2 "speaker-hide" (live on `main`)** — hides internal-speaker evidence
   by default with a reveal toggle. Uses the **old** design tokens.
2. **The redesign (`feat/phase-1-rail`)** — re-skinned the browser to the **new**
   token system and added a `themeFilter` prop + theme banner. Has **no**
   speaker-hide.

Your task: produce the redesigned browser **in the new tokens** with speaker-hide
**folded back in**, both props (`themeFilter` + `internalSpeakerNames`)
coexisting. Speaker-hide must not regress.

Work from the redesigned file (`feat/phase-1-rail:src/app/(app)/projects/[projectId]/evidence/evidence-browser.tsx`)
as the base and port the speaker-hide pieces from `main`'s version onto it.

---

## Token mapping (old → new)

When porting speaker-hide markup from `main`, convert every token:

| Old (main) | New (redesign) |
|---|---|
| `--brand` | `--accent` |
| `--border` | `--line` |
| `--ink-muted` | `--ink-2` |
| `--surface-1` | `--surface` |
| `--surface-0` | `--bg` |

`--ink`, `--ink-faint` are unchanged.

---

## Jimmy's decisions (build exactly to these)

1. **Toggle placement:** keep "Show internal" in the **search/filter row**, in
   **both** the normal tab view and the theme-filter view. (A broader filter
   redesign may come later — keep this simple for now.)
2. **Theme + internal:** internal speakers stay **hidden by default everywhere**,
   including when a theme filter is active. The toggle reveals them on top of the
   theme filter.
3. **Restyle scope:** **token-match only.** Keep the existing toggle and "Internal"
   chip shapes; just convert them to the new tokens so they blend in. Do not
   redesign them into a segmented control / pill etc.

---

## Exact pieces to port from `main`'s version

1. **Prop** — add `internalSpeakerNames: string[]` to `EvidenceBrowserProps`
   (alongside the redesign's `themeFilter?: string`).
2. **State** — `const [showInternal, setShowInternal] = useState(false);`
3. **Derivations** — port `internalSet` (useMemo), `isInternal` (useCallback),
   `visibleRecords`, `hiddenInternalCount`.
4. **EvidenceRow** — re-add the optional `isInternal?` param and the **"Internal"
   chip** next to the speaker name (new tokens: `border-[var(--line)]`,
   `bg-[var(--bg)]`, `text-[var(--ink-2)]`).
5. **Search row** — add the **"Show internal" toggle**, rendered **only when**
   `internalSpeakerNames.length > 0`, new tokens.
6. **Count line** — append `· N internal hidden` when `hiddenInternalCount > 0`
   (both the search-match and the "Showing N of M" branches).
7. **Empty state** — port the all-hidden case ("All visible records are hidden" +
   the "Toggle Show internal" helper copy).
8. **Lists** — `records.map(...)` → `visibleRecords.map(...)`, and **select-all**
   (`toggleAll` + its checkbox `checked`) must operate on `visibleRecords`, not
   `records`.

The non-speaker-hide redesign behaviour (theme banner, tabs, search, infinite
scroll, bulk bar) stays exactly as the redesign has it.

---

## Out of scope (do NOT build)

- **Per-speaker inclusion.** The toggle is **all-or-nothing** — "Show internal"
  reveals *every* internal speaker. Showing *some* internal speakers while hiding
  others needs the speaker→person link (future "fix E") and is a separate cut.
  Keep the binary toggle.
- Any change to `evidence/page.tsx`, `actions.ts`, `/api/query`, or the
  `match_evidence` / query layer. Opus wires `internalSpeakerNames` into the page
  and gates that.

---

## Definition of done

- Redesigned browser renders in new tokens, theme banner intact.
- "Show internal" toggle hidden when there are no internal names; when present:
  internal hidden by default, toggle reveals, count shows "· N internal hidden",
  all-hidden empty state works.
- Select-all and counts respect `visibleRecords`.
- No data/query/endpoint changes. Post the diff for Opus to integrate + gate
  before anything lands on a branch.
