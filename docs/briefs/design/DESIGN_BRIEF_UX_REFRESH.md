# Design Brief — DiscOS Workspace UX Refresh

**Purpose:** Feed this to Claude Design (Figma skill) to generate visual mockups of the proposed changes before implementation. The goal is to see what the cleaned-up UI looks like before committing to code.

**Constraint:** Frontend/UX only. No API changes, no schema changes, no `/api/` routes. Dark-mode app (see tokens below).

---

## Design tokens (current — do not change these)

```css
--surface-0: #0d0d10;   /* page background */
--surface-1: #141418;   /* card / panel background */
--surface-2: #1c1c22;   /* input / secondary background */
--surface-3: #25252d;   /* hover states */
--brand:     #7c6dfa;   /* primary CTA — purple */
--brand-dim: #5a4fd4;   /* brand hover */
--ink:       #e8e8f0;   /* primary text */
--ink-muted: #9090a8;   /* secondary text */
--ink-faint: #5a5a72;   /* tertiary / labels */
--border:    rgba(255,255,255,0.07);  /* subtle border */
--tone-ok:   #4ade80;   /* green / trusted */
--tone-warn: #facc15;   /* yellow / pending */
--tone-error:#f87171;   /* red / error */
```

Typography: Inter, 14px base, weight 400/500/600. Border radius: `rounded-lg` (8px) for buttons/badges, `rounded-xl` (12px) for cards.

---

## Screen 1 — Global header / top nav

### Current state (problems)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  DiscOS    Projects  People  Companies  Competitors    [Sign out]        │
└─────────────────────────────────────────────────────────────────────────┘
```

Problems:
- "Sign out" is a flat top-level nav item (should be in user menu)
- People / Companies / Competitors are visually equal to Projects (they're secondary)
- No user identity visible anywhere in the UI
- No settings/profile access

### Desired state

```
┌─────────────────────────────────────────────────────────────────────────┐
│  DiscOS    Projects   People · Companies · Competitors          [  J  ] │
└─────────────────────────────────────────────────────────────────────────┘
                        (muted, smaller)               (avatar circle)
                                                        opens dropdown:
                                                        ┌──────────────┐
                                                        │ jimmy@...    │
                                                        ├──────────────┤
                                                        │ Sign out     │
                                                        └──────────────┘
```

Specs for the avatar:
- 32×32px circle, `bg: var(--brand)`, white letter (first char of email)
- Dropdown: `bg: var(--surface-1)`, `border: var(--border)`, `border-radius: 12px`, shadow
- Email line: `text-xs`, `color: var(--ink-muted)`, truncated

Specs for de-emphasised directory items:
- `font-size: 12px` (vs 14px for Projects)
- `color: var(--ink-faint)` (vs `var(--ink-muted)`)
- `font-weight: 400` (vs 500)
- Separator dots between them: `·` in `var(--ink-faint)`
- They remain clickable links — just visually secondary

---

## Screen 2 — Project workspace page (empty state, brand new project)

### Current layout problems (empty state, 0 evidence)

1. Stats grid (`0 / 0 / 0 / 0`) shows prominently at the top — useless
2. "Draft artifact" card is always bright purple even with 0 evidence
3. Top-right header has a duplicate "Add evidence" button (already in sidebar)
4. "Add a Project Frame" CTA appears below the stats and confidence bar — user has to scroll
5. Three separate areas all suggest adding evidence

### Desired layout — empty state (0 evidence, no frame set)

```
WORKSPACE
─────────────────────────────────────────────────────
[Project name]
Turn raw discovery input into trusted evidence...

╔═══════════════════════════════════════════════════╗  ← NEW: frame CTA is FIRST
║  Set up your project context →                    ║
║  Tell the system what you're researching and who  ║
║  you're talking to — the AI gets smarter with     ║
║  each field you fill in.          [Set up now →]  ║
╚═══════════════════════════════════════════════════╝

Research confidence  0%  Just started
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Next: add your first source to start building evidence.

[ Review evidence ]  [ Manage sources ]  [ Add source material ]▓  [ Draft artifact ]
  (secondary)          (secondary)        (PRIMARY — purple)          (secondary)

Recent sources
─────────────────────────────────────────────────────
No sessions yet
Add a transcript or note to start building evidence.
              [ Add your first transcript → ]
```

Key changes from current:
- NO stats grid (all zeros — hidden until evidence exists)
- Frame CTA is first element, above confidence bar
- "Add source material" is the primary (purple) CTA when no trusted evidence
- "Draft artifact" is secondary (border-only) when no trusted evidence
- Header-area "Add evidence" button removed (sidebar has it)

### Desired layout — active state (has evidence + frame)

```
WORKSPACE
─────────────────────────────────────────────────────
[Project name]
Turn raw discovery input into trusted evidence...

47 evidence · 32 trusted · 3 needs review · 8 documents  ← COMPACT one-line stats

Research confidence  73%  Building
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━████████████░░░░
Next: add 3 more sources to improve source diversity.

[Themes from trusted evidence]
 ● Procurement delays   ● Material tracking   ● Inspection gaps  +4 more

[ Review evidence ]  [ Manage sources ]  [ Draft artifact ]▓  [ Add source material ]
  (secondary)          (secondary)        (PRIMARY — purple)    (secondary)

Recent sources
─────────────────────────────────────────────────────
Interview: Ben - Foreman - QAQC        trusted  →
Interview: Sarah - Site Manager         trusted  →
Document: Procurement process v2.pdf   pending  →
```

Key changes from empty state:
- Stats appear as a compact single-line summary (not 4 big cards)
- "Draft artifact" is now the primary (purple) CTA
- Frame CTA disappears (frame is already set)

---

## Screen 3 — Stats: compact vs card comparison

### Current (cards — 4 × large)
```
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│    47    │ │    32    │ │    3     │ │    8     │
│ Evidence │ │ Trusted  │ │  Needs   │ │Documents │
│  records │ │          │ │  review  │ │          │
└──────────┘ └──────────┘ └──────────┘ └──────────┘
```

### Desired (single compact row — only when evidence > 0)
```
47 evidence  ·  32 trusted  ·  3 needs review  ·  8 documents
```
Rendered as a single line with muted text, small font (12px), dot separators. "3 needs review" is a link to the evidence tab with `color: var(--tone-warn)`. "8 documents" links to documents tab.

---

## Screen 4 — Quick action cards: state-aware CTA hierarchy

### Empty state (trustedCount = 0)
```
┌────────────────────┐ ┌────────────────────┐ ┌────────────────────┐▓ ┌────────────────────┐
│                    │ │                    │ │  Add source        │▓ │                    │
│  Review evidence   │ │  Manage sources    │ │  material          │▓ │  Draft artifact    │
│  Search, inspect,  │ │  View segments,    │ │  Paste a           │▓ │  Generate a        │
│  and trust claims. │ │  retry ingest...   │ │  transcript...     │▓ │  working doc...    │
└────────────────────┘ └────────────────────┘ └────────────────────┘▓ └────────────────────┘
  border-only            border-only            PURPLE/PRIMARY         border-only
```

### Active state (trustedCount > 0)
```
┌────────────────────┐ ┌────────────────────┐ ┌────────────────────┐▓ ┌────────────────────┐
│  Review evidence   │ │  Manage sources    │ │  Draft artifact    │▓ │  Add source        │
│                    │ │                    │ │  Generate a        │▓ │  material          │
│                    │ │                    │ │  working doc...    │▓ │                    │
└────────────────────┘ └────────────────────┘ └────────────────────┘▓ └────────────────────┘
  border-only            border-only            PURPLE/PRIMARY         border-only
```

---

## Figma generation instructions

1. **Dark mode only** — use the tokens above. Do not generate a light variant.
2. **Produce two artboards for Screen 2:** empty state (0 evidence) and active state (47 evidence). Side by side.
3. **Produce one artboard for Screen 1** showing the new top nav with the avatar dropdown open.
4. **Keep the left project sidebar** exactly as-is — do not redesign it. The sidebar nav (Workspace / Evidence / Ask / Problems / Sources / Compose / Documents / Settings) is correct.
5. **Font:** Inter. Use system weights — no custom font loading needed.
6. **Card radius:** 12px. Button radius: 8px. Inputs: 8px.
7. **Spacing:** 20px padding inside cards. 8px gap between elements. 32px between sections.
8. **Do not** add new features — only redesign existing elements per the specs above.

---

## What NOT to redesign

- The project left sidebar (already correct)
- The evidence browser page (`/evidence`)
- The settings page (`/settings`) — Codex is overhauling this separately
- The ingest/source pages
- The compose/documents pages
- Any API routes

---

## Files that will change (for reference)

| File | Change |
|------|--------|
| `src/app/(app)/layout.tsx` | Top nav: de-emphasise directory items + UserMenu component |
| `src/app/(app)/components/user-menu.tsx` | New: user avatar dropdown |
| `src/app/(app)/projects/[projectId]/page.tsx` | State-aware CTAs, hide zero-stats, compact stats, frame CTA first |
