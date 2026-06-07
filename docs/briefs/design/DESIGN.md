# DiscOS Design System

**Source of truth for UI consistency.** Read this before building any new screen, component, or generated artifact. All AI tools and developers working on this codebase must follow these patterns — do not invent new ones without updating this file.

Dark-mode only. No light mode variant.

---

## Tokens

All tokens live in `src/app/globals.css` as CSS custom properties. Reference them via `var(--token-name)`. Never hardcode hex values.

### Surfaces (background layers)

| Token | Value | Usage |
|-------|-------|-------|
| `--surface-0` | `#0d0d10` | Page/app background |
| `--surface-1` | `#141418` | Card, panel, sidebar background |
| `--surface-2` | `#1c1c22` | Input background, secondary card fill, hover target |
| `--surface-3` | `#25252d` | Active/selected state background |

Layer rule: content sits one level above its container. Page bg = `surface-0`, card on page = `surface-1`, input inside card = `surface-2`.

### Ink (text)

| Token | Value | Usage |
|-------|-------|-------|
| `--ink` | `#e8e8f0` | Primary text — headings, body copy, values |
| `--ink-muted` | `#9090a8` | Secondary text — descriptions, labels, metadata |
| `--ink-faint` | `#5a5a72` | Tertiary text — timestamps, separators, placeholder-level copy |

### Brand

| Token | Value | Usage |
|-------|-------|-------|
| `--brand` | `#7c6dfa` | Primary CTA background, active nav, focus ring, accent border |
| `--brand-dim` | `#5a4fd4` | Brand hover state |

### Semantic tones

| Token | Value | Usage |
|-------|-------|-------|
| `--tone-ok` | `#4ade80` | Success, trusted, positive |
| `--tone-warn` | `#facc15` | Warning, pending review, caution |
| `--tone-error` | `#f87171` | Error, failed, destructive |
| `--tone-info` | `#60a5fa` | Info, running, in-progress |

### Border

| Token | Value | Usage |
|-------|-------|-------|
| `--border` | `rgba(255,255,255,0.07)` | All borders — cards, inputs, dividers |

There is only one border token. Don't use custom opacity variants; use the token as-is.

---

## Typography

Font: **Inter**. Loaded via system stack — `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. Base: 14px / 1.5 line-height.

| Role | Size | Weight | Class |
|------|------|--------|-------|
| Page heading | 24px | 600 | `text-2xl font-semibold` |
| Section heading | 14–16px | 600 | `text-sm font-semibold` or `text-base font-semibold` |
| Body / label | 14px | 400–500 | `text-sm` |
| Secondary / metadata | 12px | 400–500 | `text-xs` |
| Section label (uppercase) | 11–12px | 500–600 | `text-xs font-medium uppercase tracking-wide` |
| Caption / timestamp | 12px | 400 | `text-xs text-[var(--ink-faint)]` |

---

## Spacing

| Use | Value |
|-----|-------|
| Card internal padding | `p-5` (20px) |
| Card internal padding, compact | `p-4` (16px) |
| Section gap (mb between sections) | `mb-6` or `mb-8` |
| Inline gap between items | `gap-2` (8px) or `gap-3` (12px) |
| Nav / header height | `h-14` (56px) |

---

## Radius

| Use | Class |
|-----|-------|
| Card, panel, large container | `rounded-xl` (12px) |
| Button, input, badge (interactive) | `rounded-lg` (8px) |
| Pill badge (status tag) | `rounded-full` |
| Small utility badge | `rounded-md` (6px) |

Never mix radii on the same level of nesting. Cards are `rounded-xl`, everything inside them is `rounded-lg` or smaller.

---

## Buttons

Four levels, strictly enforced. Only one primary CTA per screen at a time.

### Level 1 — Primary (one per screen)
```tsx
className="rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-dim)]"
```

### Level 2 — Secondary (border, no fill)
```tsx
className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--ink-muted)] transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)]"
```

### Level 3 — Ghost (text only, no border)
```tsx
className="text-sm font-medium text-[var(--ink-muted)] transition-colors hover:text-[var(--brand)]"
```
Use for "View all", "Cancel", low-stakes navigation links inline with content.

### Level 4 — Destructive
```tsx
className="rounded-lg border border-red-500/20 px-3 py-2 text-sm font-medium text-red-300 transition-colors hover:border-red-400/50 hover:bg-red-500/10"
```

### Disabled state (any level)
Add `disabled:cursor-not-allowed disabled:opacity-45` — never change colour, never hide. Always visible so the user understands the action exists but is blocked.

### Brand-outline variant (for synthesis/run actions)
```tsx
className="rounded-lg border border-[var(--brand)] px-3 py-2 text-sm font-medium text-[var(--brand)] transition-colors hover:bg-[var(--brand)] hover:text-white"
```

### Small button (tight spaces, eg. table rows)
Reduce to `px-2.5 py-1 text-xs`. Keep the same level hierarchy.

---

## CTA Hierarchy on the Workspace Page

**Rule:** the primary CTA changes based on project state. Only one card can be purple at a time.

| State | Primary CTA | Reasoning |
|-------|-------------|-----------|
| No trusted evidence (`trustedCount === 0`) | "Add source material" | Nothing to draft from yet |
| Has trusted evidence (`trustedCount > 0`) | "Draft artifact" | Evidence exists, drafting is now the valuable action |

Implementation: `hasTrustedEvidence = trustedTotal > 0`. The variable is declared in `page.tsx` just before `return (`. Cards use conditional classNames.

---

## Cards

### Standard card
```tsx
<div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5">
  ...
</div>
```

### Clickable card (hover border highlight)
```tsx
<Link className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5 text-[var(--ink)] transition-colors hover:border-[var(--brand)]">
  ...
</Link>
```

### Primary/featured card (brand fill — use sparingly, see CTA hierarchy above)
```tsx
<Link className="rounded-xl border border-[var(--brand)] bg-[var(--brand)] p-5 text-white transition-colors hover:bg-[var(--brand-dim)]">
  ...
</Link>
```

### Alert cards (status-tinted)

```tsx
// Info / running
"rounded-xl border border-[var(--tone-info)]/20 bg-[var(--tone-info)]/10 p-4 text-sm text-blue-200"

// Warning / pending
"rounded-xl border border-yellow-500/20 bg-yellow-500/10 p-4 text-sm text-yellow-100"

// Error / failed
"rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300"
```

### Dashed card (empty/placeholder state)
```tsx
"rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-1)] p-5"
```

---

## Badges / Pills

All badges use `rounded-full border px-2 py-0.5 text-xs font-medium`.

### Trust scope (from `src/lib/labels.ts`)

| State | Classes |
|-------|---------|
| Trusted | `bg-green-900/30 text-green-400` |
| Pending / Needs review | `bg-yellow-900/30 text-yellow-400` |
| Excluded / Disputed | `bg-red-900/30 text-red-400` |
| Default / Unknown | `bg-[var(--surface-2)] text-[var(--ink-muted)]` |

### Priority signal

| Signal | Classes |
|--------|---------|
| Critical | `border-red-400/40 bg-red-500/10 text-red-300` |
| Important | `border-amber-400/40 bg-amber-500/10 text-amber-300` |
| Nice to have | `border-[var(--border)] bg-[var(--surface-2)] text-[var(--ink-muted)]` |

### AI grade

| Grade | Classes |
|-------|---------|
| Uncertain | `border-amber-500/30 bg-amber-500/10 text-amber-300` |
| Weak | `border-[var(--border)] bg-[var(--surface-2)] text-[var(--ink-muted)]` |
| Trusted | (no badge — trusted is the default, silence is signal) |

### Confidence

| Level | Classes |
|-------|---------|
| High | `border-green-500/20 bg-green-500/10 text-green-300` |
| Medium | `border-yellow-500/20 bg-yellow-500/10 text-yellow-300` |
| Low | `border-[var(--border)] bg-[var(--surface-2)] text-[var(--ink-muted)]` |

### Generic accent badge (brand)
```tsx
<span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--brand)]">
  Label
</span>
```

---

## Inputs and Form Controls

### Text input
```tsx
<input
  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-sm text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-faint)] focus:border-[var(--brand)]"
/>
```

### Textarea (auto-expanding — use grid mirror trick)
```tsx
<div className="grid" data-value={value}>
  <textarea
    value={value}
    onChange={...}
    className="resize-none overflow-hidden [grid-area:1/1/2/2] rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-sm text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-faint)] focus:border-[var(--brand)]"
    style={{ minHeight: '72px' }}
  />
  <span
    aria-hidden
    className="invisible whitespace-pre-wrap break-words text-sm px-3 py-2 [grid-area:1/1/2/2]"
    style={{ fontFamily: 'inherit', lineHeight: '1.5' }}
  >
    {value + ' '}
  </span>
</div>
```

Never use fixed-height textareas with internal scrollbars. Always use the grid mirror pattern.

### Checkbox
```tsx
<label className="flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-xs font-medium text-[var(--ink-muted)]">
  <input type="checkbox" className="..." />
  Label
</label>
```

### Form section label
```tsx
<div className="mb-3 text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
  Section Name
</div>
```

---

## Navigation

### Global top nav (app shell)

- Height: `h-14` sticky, `z-30`
- Background: `bg-[var(--surface-0)]/95 backdrop-blur`
- **Primary items** (`Projects`): `text-sm font-medium text-[var(--ink-muted)] hover:bg-[var(--surface-1)] hover:text-[var(--ink)]`
- **Directory items** (`People`, `Companies`, `Competitors`): `text-xs font-normal text-[var(--ink-faint)] hover:text-[var(--ink-muted)]` — visually de-emphasised
- **User avatar**: 32×32 circle, `bg-[var(--brand)]`, initials, opens dropdown with email + Sign out
- **Admin badge** (super admin only): red tinted pill, `text-xs`
- Sign out lives in the user avatar dropdown, not as a top-level item

### Project sidebar

- Background: `bg-[var(--surface-1)]`, `border-r border-[var(--border)]`
- Nav items: `rounded-lg px-3 py-2 text-sm font-medium`
- Active state: `bg-[var(--brand)] text-white`
- Inactive state: `text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]`
- Primary CTA at bottom: `bg-[var(--brand)]` button for "+ Add evidence"
- Settings link at bottom, secondary style

---

## Empty States

### Full-page empty (when a list has no items)
```tsx
<div className="px-5 py-12 text-center">
  <div className="text-sm font-medium text-[var(--ink)]">Nothing here yet</div>
  <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--ink-muted)]">
    One-line explanation of what will appear here.
  </p>
  <Link
    href="/..."
    className="mt-5 inline-flex rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-dim)]"
  >
    Primary action →
  </Link>
</div>
```

### Inline empty (within a card)
```tsx
<div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-1)] p-5 text-center text-sm text-[var(--ink-muted)]">
  Nothing here yet
</div>
```

### Zero-value stats rule
**Do not show stat cards when all values are zero.** Four `0 / 0 / 0 / 0` cards are not information — they're noise. Use the research confidence bar as the progress indicator for empty projects.

When values exist, prefer a compact one-liner over large stat cards for secondary metrics:
```tsx
<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
  <span className="text-[var(--ink-muted)]">47 evidence</span>
  <span className="text-[var(--ink-faint)]">·</span>
  <span className="text-green-400">32 trusted</span>
  ...
</div>
```

---

## Status / Activity Indicators

### Activity pulse (running jobs)
```tsx
<div className="inline-flex items-center gap-2 rounded-full border border-[var(--brand)] bg-[rgba(124,109,250,0.10)] px-3 py-1.5 text-xs font-medium text-[var(--ink)]">
  <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--brand)]" />
  Working through your latest session...
</div>
```

### Attention / error pulse
```tsx
"border-red-500/20 bg-red-500/10 text-red-200"
```

### Quiet / complete pulse
```tsx
"border-[var(--border)] bg-[var(--surface-1)] text-[var(--ink-muted)]"
```

---

## List rows (divide pattern)

```tsx
<div className="divide-y divide-[var(--border)]">
  {items.map(item => (
    <Link
      key={item.id}
      className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-[var(--surface-2)]"
    >
      ...
    </Link>
  ))}
</div>
```

---

## Page Layout

All pages use:
```tsx
<div className="mx-auto max-w-6xl px-5 sm:px-8 py-8">
```

Settings-style single-column forms use `max-w-[780px]`.

Section headings within a page:
```tsx
<div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
  SECTION NAME
</div>
<h1 className="text-2xl font-semibold text-[var(--ink)]">Page Title</h1>
```

---

## Impersonation / Admin Banner

Super admin support mode banner — always at the top, sticky, `z-40`, `bg-red-600`.

```tsx
<div className="sticky top-0 z-40 flex items-center justify-between bg-red-600 px-5 py-2 text-xs font-medium text-white sm:px-8">
  🛟 Support mode — viewing as <strong>{orgName}</strong>
  <button ...>Exit</button>
</div>
```

---

## Generated Artifacts (HTML documents)

Exec summaries, GTM documents, sales enablement, and any HTML output generated by Compose/Documents must use this base stylesheet. Inject it at the top of every generated HTML document. This ensures all AI-generated output looks like it came from the same product.

```html
<style>
  /* DiscOS artifact base — inject into all generated HTML documents */
  :root {
    --artifact-bg:      #0d0d10;
    --artifact-surface: #141418;
    --artifact-border:  rgba(255,255,255,0.07);
    --artifact-ink:     #e8e8f0;
    --artifact-muted:   #9090a8;
    --artifact-faint:   #5a5a72;
    --artifact-brand:   #7c6dfa;
    --artifact-ok:      #4ade80;
    --artifact-warn:    #facc15;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: var(--artifact-bg);
    color: var(--artifact-ink);
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 14px;
    line-height: 1.6;
    padding: 40px 24px 80px;
    max-width: 900px;
    margin: 0 auto;
    -webkit-font-smoothing: antialiased;
  }

  h1 { font-size: 28px; font-weight: 600; letter-spacing: -0.02em; margin-bottom: 8px; }
  h2 { font-size: 18px; font-weight: 600; letter-spacing: -0.01em; margin: 32px 0 12px; }
  h3 { font-size: 14px; font-weight: 600; margin: 24px 0 8px; }
  p  { color: var(--artifact-muted); margin-bottom: 12px; max-width: 680px; }

  /* Cards */
  .card {
    background: var(--artifact-surface);
    border: 1px solid var(--artifact-border);
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 16px;
  }

  /* Evidence quote */
  blockquote {
    border-left: 3px solid var(--artifact-brand);
    padding: 10px 16px;
    margin: 16px 0;
    background: rgba(124,109,250,0.08);
    border-radius: 0 8px 8px 0;
    font-style: normal;
    color: var(--artifact-ink);
    font-size: 13px;
    line-height: 1.6;
  }
  blockquote cite {
    display: block;
    margin-top: 6px;
    font-size: 11px;
    color: var(--artifact-faint);
    font-style: normal;
  }

  /* Badge */
  .badge {
    display: inline-block;
    border-radius: 999px;
    border: 1px solid var(--artifact-border);
    padding: 2px 8px;
    font-size: 11px;
    font-weight: 500;
    color: var(--artifact-muted);
    background: rgba(255,255,255,0.04);
  }
  .badge-ok    { border-color: rgba(74,222,128,0.3); background: rgba(74,222,128,0.1); color: #4ade80; }
  .badge-brand { border-color: rgba(124,109,250,0.4); background: rgba(124,109,250,0.1); color: #7c6dfa; }

  /* Table */
  table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
  th { text-align: left; font-weight: 600; font-size: 11px; text-transform: uppercase;
       letter-spacing: 0.05em; color: var(--artifact-faint);
       border-bottom: 1px solid var(--artifact-border); padding: 8px 12px; }
  td { padding: 10px 12px; border-bottom: 1px solid var(--artifact-border);
       color: var(--artifact-muted); }
  tr:last-child td { border-bottom: none; }

  /* Section divider */
  hr { border: none; border-top: 1px solid var(--artifact-border); margin: 32px 0; }

  /* Watermark footer */
  .artifact-footer {
    margin-top: 64px;
    padding-top: 16px;
    border-top: 1px solid var(--artifact-border);
    font-size: 11px;
    color: var(--artifact-faint);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .artifact-footer .brand { color: var(--artifact-brand); font-weight: 600; }
</style>
```

**Usage in generated documents:**
Every HTML artifact must:
1. Include the base stylesheet above in `<head>`
2. End with a footer: `<div class="artifact-footer"><span>Generated by <span class="brand">DiscOS</span></span><span>{date}</span></div>`
3. Wrap evidence quotes in `<blockquote>...<cite>— {person}, {org}</cite></blockquote>`
4. Use `.card` divs for sections, `.badge` for status tags

---

## Patterns to Avoid

| Don't | Do instead |
|-------|-----------|
| Hardcode hex colours | Use `var(--token-name)` |
| Show `0 / 0 / 0 / 0` stat cards | Hide stats when all zero |
| Multiple primary (purple) CTAs on one screen | One primary CTA, rest secondary |
| "Sign out" as a top-level nav item | Put it in the user dropdown |
| Fixed-height textareas with scrollbars | Grid mirror auto-expand pattern |
| Inline `org_members` subqueries in new RLS policies | Use `auth_user_org_ids()` / `auth_user_org_role()` helpers |
| Light backgrounds, white cards | Dark surfaces only — `surface-0` through `surface-3` |
| Generated HTML with no base stylesheet | Inject `artifact-base` CSS (see above) |
| New font families or custom icons | Inter only; use text + Tailwind for iconography |

---

## File Map

| File | What it defines |
|------|----------------|
| `src/app/globals.css` | All CSS tokens (source of truth) |
| `src/lib/labels.ts` | All badge label functions and colour classes |
| `src/lib/confidence.ts` | Research confidence scoring + colour tokens |
| `src/app/(app)/layout.tsx` | Global header, nav structure |
| `src/app/(app)/projects/[projectId]/project-sidebar.tsx` | Project sidebar nav |
| `src/app/(app)/components/user-menu.tsx` | User avatar dropdown |
| `DESIGN.md` | This file — component patterns and rules |
| `DESIGN_BRIEF_UX_REFRESH.md` | Figma brief for the workspace page redesign |
