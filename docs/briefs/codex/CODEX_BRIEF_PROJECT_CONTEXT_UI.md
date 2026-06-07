# Codex Brief — Project Research Context UI + Evidence Grade Display

> ⛔ **SECURITY GATE APPLIES (non-negotiable).** Before committing/pushing any change to auth, RLS/migrations, public routes, middleware, or service-role usage, post the diff and wait for Opus's written **APPROVED**. See `AGENTS.md` → "SECURITY REVIEW GATE". This overrides anything below.

## Goal

Two things in one brief:

1. **Research context setup form** — lets users tell the system what they're trying to learn before uploading transcripts. This context is what the AI uses to automatically decide which evidence is worth keeping.

2. **Evidence grade display** — shows the AI's trust assessment inline on the evidence list, so users know what was auto-trusted, what needs their attention, and why.

Together these make the "AI trusts by default" model visible and trustworthy.

---

## Part 1: Research context form

### Where it lives

`src/app/(app)/projects/[projectId]/settings/page.tsx` (or wherever the project settings / frame page lives — check the existing route).

Add a new section called **"Research focus"** above the Frame section. This is the first thing users should fill in when starting a new project.

### Data

The `research_context` field lives on the projects table as a jsonb column. Shape:

```ts
type ResearchContext = {
  goals?: string;           // What are you trying to learn?
  outcomes?: string;        // What decisions will this research inform?
  buyers?: string;          // Who are you talking to? (role, company type, persona)
  scope_in?: string;        // What topics are in scope?
  scope_out?: string;       // What topics are explicitly out of scope?
  research_questions?: string[];  // Key questions you need answered
};
```

Read it from the existing project query — add `research_context` to the select. Save it via `PATCH /api/projects/[projectId]` (already built, accepts partial updates).

### Form design

Five text fields + one dynamic list. All optional. Save on blur (same pattern as Frame / operating style).

| Field | Label | Placeholder |
|---|---|---|
| `goals` | What are you trying to learn? | "Why procurement teams switch away from spreadsheets" |
| `outcomes` | What decisions will this inform? | "Go/no-go on building an approval workflow" |
| `buyers` | Who are you talking to? | "Procurement managers at mid-market manufacturing companies" |
| `scope_in` | What's in scope? | "Workflow pain, approval bottlenecks, compliance requirements" |
| `scope_out` | What's out of scope? | "IT infrastructure, ERP integrations, price sensitivity" |
| `research_questions` | Key questions | Dynamic list — add/remove individual questions |

For `research_questions`: render as a list of text inputs. "Add question" button appends a new input. Each existing question has a remove (×) button. Save the full array on any change (debounce 500ms).

### Helper callout

Below the section header, show a soft callout (not alarming, informational):

> "The more context you add here, the smarter the system gets at sorting what matters from what doesn't — automatically."

Keep it light. One sentence. Don't use words like "AI", "model", or "algorithm".

### When it's empty

If `research_context` is null or all fields are empty, show a soft prompt in the evidence list view (see Part 2) nudging the user to fill this in. Don't block them — just surface it once.

---

## Part 2: Evidence grade display

### Where it lives

The evidence list page/component — wherever individual evidence records are rendered, most likely on the project overview or a dedicated evidence page. Check existing UI for the evidence list.

### What to show per record

Each evidence record now has three new fields:
- `ai_trust_grade`: `"trusted" | "uncertain" | "weak" | null`
- `ai_trust_reason`: `string | null` (10 words max, e.g. "Directly describes approval workflow bottleneck")
- `ai_graded_at`: `string | null`

**Do NOT show "AI grade" or any system language.** Show it as the system's confidence, not as a label from a model.

Display rules:

| Grade | Badge | Colour | Show reason? |
|---|---|---|---|
| `trusted` | (no badge — it's the default, just show the evidence) | — | No |
| `uncertain` | "Needs a look" | amber/yellow | Yes — show reason as tooltip or subtitle |
| `weak` | "Low signal" | muted grey | Yes — show reason as tooltip or subtitle |
| `null` (not yet graded) | (no badge) | — | No |

For `trusted` records: no badge needed — they've been validated and are already in synthesis. Showing a badge would add noise.

For `uncertain` records: a small amber badge + the reason underneath in muted text. These are the ones the user should review. Make them easy to act on — "Keep" and "Dismiss" buttons inline (updating `trust_scope` to `trusted` or `excluded`).

For `weak` records: muted grey badge + reason. These are quietly de-prioritised. Give the user a "Keep anyway" button if they disagree.

### Evidence review nudge

If more than 5 records have `ai_trust_grade = 'uncertain'` in a project, show a nudge at the top of the evidence list:

> "N pieces of evidence are waiting for your input."

With a "Review" button that scrolls to or filters to uncertain records. This replaces the old "646 pending review" anxiety with an actionable, human-scale number.

### Empty research context nudge

If a project has evidence but `research_context` is null/empty, show a one-time callout on the evidence list:

> "Add your research focus to help sort what matters."

Link to the project settings page. Dismissable. Only show once per session.

---

## API notes

- `research_context` is saved via the existing `PATCH /api/projects/[projectId]` route — just pass `{ research_context: { ... } }` in the body. The route accepts partial updates.
- Evidence grades are read-only in the UI — set by the backend after ingest. The user can override them by clicking "Keep" / "Dismiss" / "Keep anyway", which calls the existing trust update mechanism (whatever sets `trust_scope`).
- Add `ai_trust_grade, ai_trust_reason` to the evidence select query wherever the evidence list is built.

---

## Type reference

```ts
// On Project:
research_context: {
  goals?: string;
  outcomes?: string;
  buyers?: string;
  scope_in?: string;
  scope_out?: string;
  research_questions?: string[];
} | null;

// On Evidence (new fields):
ai_trust_grade: "trusted" | "uncertain" | "weak" | null;
ai_trust_reason: string | null;
ai_graded_at: string | null;
```

---

## Files to create / modify

| File | Action |
|---|---|
| `src/app/(app)/projects/[projectId]/settings/page.tsx` (or equivalent) | Add Research focus section |
| Evidence list component (wherever evidence cards are rendered) | Add grade badges + review nudge |
| `PATCH /api/projects/[projectId]` | Already built — no changes needed |

---

## Tone reminder

No system language in the UI. "Needs a look" not "AI grade: uncertain". "Low signal" not "weak". "Waiting for your input" not "pending review". The system is a colleague making a recommendation, not a classifier assigning labels.
