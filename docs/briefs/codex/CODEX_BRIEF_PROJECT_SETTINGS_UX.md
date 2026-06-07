# Codex Brief — Project Settings Page UX Overhaul

> ⛔ **SECURITY GATE APPLIES (non-negotiable).** Before committing/pushing any change to auth, RLS/migrations, public routes, middleware, or service-role usage, post the diff and wait for Opus's written **APPROVED**. See `AGENTS.md` → "SECURITY REVIEW GATE". This overrides anything below.

## Goal

The project settings page (`/projects/[projectId]/settings`) has a functional form but a broken UX. This brief covers all the fixes needed to make it feel polished, trustworthy, and fast to fill in. It also adds two new behaviours: a fully scoped "Suggest from evidence" action that fills all fields, and a post-save "Re-assess evidence" flow.

No new API routes needed. No schema changes. This is a pure UI brief.

---

## Background

The settings page currently has a Research focus section (goals, outcomes, buyers, scope_in, scope_out, research_questions) built from `CODEX_BRIEF_PROJECT_CONTEXT_UI.md`. This brief extends that section and adds Project Frame, Operating Style, and GTM Context to the same settings page. It also fixes the form's visual behaviour throughout.

---

## Fix 1: Auto-expanding textareas

**Problem:** Textareas are fixed height. Long content gets a scrollbar inside the field. Short content looks padded. Both feel broken.

**Fix:** Every `<textarea>` on the page should auto-expand vertically to fit its content. No scrollbars inside fields. No fixed height.

**Implementation pattern** — the CSS grid mirror trick:

```tsx
// Wrap each textarea in a div with this pattern
<div
  className="grid"
  style={{ gridTemplateColumns: '1fr' }}
  data-value={value}
>
  <textarea
    value={value}
    onChange={...}
    className="resize-none overflow-hidden [grid-area:1/1/2/2]"
    style={{ minHeight: '72px' }}
  />
  {/* invisible mirror that drives height */}
  <span
    aria-hidden
    className="invisible whitespace-pre-wrap break-words text-sm px-3 py-2.5 [grid-area:1/1/2/2] min-h-[72px]"
    style={{ fontFamily: 'inherit', lineHeight: '1.6' }}
  >
    {value + ' '}
  </span>
</div>
```

Both the `<textarea>` and the mirror span sit at `grid-area: 1/1/2/2` — they overlap. The mirror is invisible and drives the height via its natural content height. The textarea inherits that height because they share the same grid cell. When the user types, update `data-value` on the wrapper (or control via React state on the mirror span's children) so the mirror updates synchronously.

Apply this wrapper to **every textarea on the settings page** — goals, outcomes, buyers, scope_in, scope_out, frame, operating_style, gtm_context.

---

## Fix 2: Equal-height paired fields in the same row

**Problem:** Two-column rows (e.g. "What are you trying to learn?" + "What decisions will this inform?") display at different heights when their content lengths differ. This looks unbalanced.

**Fix:** Paired fields in a two-column row must stretch to the same height. The taller field sets the row height; the shorter field's textarea fills to match.

**Implementation:**

Use CSS grid with `align-items: stretch` on the row, and `display: flex; flex-direction: column` on each field wrapper with `flex: 1` on the textarea wrapper inside:

```tsx
// Row wrapper
<div className="grid grid-cols-2 gap-4 items-stretch">

  {/* Each field */}
  <div className="flex flex-col">
    <label>...</label>
    {/* auto-expand wrapper from Fix 1 — also needs flex: 1 */}
    <div className="grid flex-1" data-value={value}>
      <textarea className="resize-none overflow-hidden [grid-area:1/1/2/2] h-full" ... />
      <span className="invisible ... [grid-area:1/1/2/2]">{value + ' '}</span>
    </div>
  </div>

  {/* Second field — same structure */}
  <div className="flex flex-col">...</div>

</div>
```

The key: `flex-1` on the grid wrapper inside each field column makes it stretch to fill the column height. `h-full` on the textarea makes it fill the grid wrapper. Combined with `align-items: stretch` on the outer row, both fields in a pair are always the same height.

**Which rows are paired:**
- "What are you trying to learn?" + "What decisions will this inform?"
- "Who are you talking to?" + "What's in scope?"
- "What's out of scope?" is full-width (single column)

---

## Fix 3: Nav alignment

**Problem:** The page title, breadcrumb, tab row (Project / Team), and card content sit at different horizontal indentations. They do not share a left edge.

**Fix:** Constrain the entire page to a `max-w-3xl` (or `max-w-[780px]`) container with consistent horizontal padding (`px-6`). The breadcrumb, title, description, tab row, and all cards should all share the same left edge.

```tsx
<div className="max-w-[780px] mx-auto px-6 py-8">
  <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Settings</p>
  <h1 className="text-2xl font-medium mb-1">Project settings</h1>
  <p className="text-sm text-muted-foreground mb-7">...</p>

  {/* Tabs flush with content — no extra indent */}
  <div className="flex border-b border-border mb-7">
    <button className="...">Project</button>
    <button className="...">Team</button>
  </div>

  {/* Card — same max-width, no extra indent */}
  <div className="rounded-xl border border-border bg-card p-6">
    ...
  </div>
</div>
```

Do not add additional horizontal padding inside the card that pushes content further right than the page title.

---

## Fix 4: "Suggest from evidence" fills all fields

**Problem:** The button currently only fills the Research focus section (goals, outcomes, buyers, scope_in, scope_out, research_questions). The Project Frame, Operating Style, and GTM Context fields are not populated.

**Fix:** "Suggest from evidence" should trigger a single AI call that returns a complete draft for all seven sections. Update the backend prompt and the frontend handler accordingly.

**New fields to add to the settings page** (these are new UI additions, not new API fields — check whether `frame`, `operating_style`, and `gtm_context` already exist on the projects table as separate columns or inside a jsonb column, and add them to the select query):

| Section | Field key | Label | Description |
|---|---|---|---|
| Project frame | `frame` | Project frame | One-paragraph summary of what the project is validating and why |
| Operating style | `operating_style` | Operating style | How the AI should write and filter. Evidence standards, output voice, watchouts |
| GTM context | `gtm_context` | GTM context | Target segment, wedge positioning, proof points, pricing anchor, priority competitors |

**Backend: update the suggest-from-evidence prompt** to return all fields:

```ts
// Prompt should return:
{
  goals: string;
  outcomes: string;
  buyers: string;
  scope_in: string;
  scope_out: string;
  research_questions: string[];
  frame: string;
  operating_style: string;
  gtm_context: string;
}
```

The prompt should read from: problem registry (top problems by evidence count and confidence), evidence records (most-cited), entity records (orgs and people), strategy records (segments, risks, thesis), and existing project frame if present.

**Frontend:** On successful response, populate all fields at once. Show a brief loading state on the button ("Drafting from evidence…") while the call is in flight. After population, show a subtle "Review before saving" hint beneath the button.

**PATCH call:** Save via the existing `PATCH /api/projects/[projectId]` — pass all fields in one call.

---

## Fix 5: Post-save re-assess banner

**Problem:** After saving updated research focus, scope, or key questions, existing evidence is not re-graded against the new criteria. There is no prompt to trigger this.

**Fix:** Immediately after a successful save, show a banner above the card (not a toast — this needs to be persistent until acted on or dismissed):

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Settings saved — re-assess evidence against new criteria?              │
│  This will re-score all evidence and problems using your updated        │
│  research focus, scope, and key questions.                              │
│                                                  [Re-assess now]  [×]  │
└─────────────────────────────────────────────────────────────────────────┘
```

**Banner behaviour:**
- Appears immediately after `PATCH` returns 200
- Stays visible until the user clicks "Re-assess now", dismisses with ×, or navigates away
- Does NOT appear if nothing changed from the last saved state (compare dirty fields before save)
- Styled with `background: info`, `border: info`, body text in info colour (see design system)

**"Re-assess now" action:**
- Calls `POST /api/projects/[projectId]/regrade` (new route — see below)
- Button shows "Running…" while in flight
- On success: button shows "Done ✓" for 2 seconds, then banner auto-dismisses
- On error: banner stays, button resets to "Re-assess now", show a toast with the error

**New API route: `POST /api/projects/[projectId]/regrade`**

```ts
// src/app/api/projects/[projectId]/regrade/route.ts
// Auth: org membership required (same pattern as other project routes)
// Action: send inngest event { name: 'evidence/regrade.requested', data: { projectId, orgId } }
// Returns: { status: 'queued' }
```

**New Inngest function: `regrade-evidence.ts`**

This is a thin wrapper around the existing `grade-evidence` logic. It:
1. Fetches all evidence for the project (not just ungraded — re-grades everything)
2. Fetches the current `research_context` from the project
3. Runs the same grading prompt as `grade-evidence.ts` but forces a re-grade even for records that already have `ai_trust_grade` set
4. Updates `ai_trust_grade`, `ai_trust_reason`, `ai_graded_at` on each record
5. Logs to `agent_runs` with `agent_type: 'regrade'`

Use the same batch-of-20 pattern as the existing `grade-evidence.ts`. Cheap tier model is fine — this is classification, not synthesis.

---

## Section layout (complete settings page structure)

After this brief is implemented, the project settings page should render in this order:

```
[Breadcrumb: Settings]
[Page title: Project settings]
[Page description]

[Tabs: Project | Team]

┌─ Project context card ──────────────────────────────────────────┐
│  [Card title + subtitle]       [Suggest from evidence button]   │
│                                                                 │
│  ── Research focus ─────────────────────────────────────────    │
│  [What are you trying to learn?] [What decisions will...?]      │
│  [Who are you talking to?]       [What's in scope?]             │
│  [What's out of scope?]  (full width)                           │
│                                                                 │
│  ── Key questions ──────────────────────────────────────────    │
│  [Question 1]  [×]                                              │
│  [Question 2]  [×]                                              │
│  [+ Add question]                                               │
│                                                                 │
│  ── Project frame ──────────────────────────────────────────    │
│  [Textarea — full width]                                        │
│                                                                 │
│  ── Operating style ────────────────────────────────────────    │
│  [Textarea — full width]                                        │
│                                                                 │
│  ── GTM context ────────────────────────────────────────────    │
│  [Textarea — full width]                                        │
│                                                                 │
│                              [Cancel]  [Save settings]          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Save behaviour

Save is explicit (button click), not auto-save on blur. This is intentional — these are consequential settings that affect AI grading and artifact generation. The user should consciously commit the change.

Dirty state tracking: compare current form values to last-saved values. Enable "Save settings" only when something has changed. Show a subtle "Unsaved changes" label near the save button when dirty.

On save:
1. Disable save button, show "Saving…"
2. `PATCH /api/projects/[projectId]` with all changed fields
3. On success: reset dirty state, show "Saved ✓" badge for 2s, show re-assess banner (see Fix 5)
4. On error: re-enable button, show toast with error message

---

## Files to modify

| File | Change |
|---|---|
| `src/app/(app)/projects/[projectId]/settings/page.tsx` | Full layout overhaul per this brief |
| `src/app/api/projects/[projectId]/route.ts` | Ensure `frame`, `operating_style`, `gtm_context` are included in select + accepted in PATCH |
| `src/app/api/projects/[projectId]/suggest/route.ts` (or equivalent) | Expand prompt to return all 9 fields |
| `src/app/api/projects/[projectId]/regrade/route.ts` | New route — fire Inngest event |
| `src/inngest/functions/regrade-evidence.ts` | New Inngest function — force re-grade all project evidence |
| `ROADMAP.md` | Mark this item as 🔜 |

---

## Design reference

See the visual mockup produced in the Cowork session (May 2026) for the intended layout, field sizes, banner treatment, and button states. The mockup shows the complete form filled with procurement-tracking project data as a reference example.

Key visual rules from the mockup:
- Section labels: 11px, uppercase, 0.07em letter-spacing, muted colour, with a hairline bottom border
- Paired field rows: CSS grid `1fr 1fr`, `align-items: stretch`
- Textareas: `background: var(--color-background-secondary)`, `border: 0.5px solid var(--color-border-tertiary)`
- Re-assess banner: `background: var(--color-background-info)`, `border: 0.5px solid var(--color-border-info)`
- Page container: `max-w-[780px] mx-auto px-6 py-8`

---

## Out of scope for this brief

- Team tab content
- Any new database migrations (unless `frame`, `operating_style`, `gtm_context` don't exist yet — check first)
- Changes to the evidence list page (covered in `CODEX_BRIEF_PROJECT_CONTEXT_UI.md`)
- Mobile responsive breakpoints (nice to have, not required for this pass)
