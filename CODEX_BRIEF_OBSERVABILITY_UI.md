# Codex Brief — Intelligence Processing UI

## Goal

After a user uploads a source, show them that something meaningful is happening — but without revealing any backend mechanics, agent names, or internal pipeline structure. The UI should feel **magical and purposeful**, not technical. Think of it like a progress experience in a premium app: you feel cared for and informed, not overwhelmed by system detail.

No agent names, no internal IDs, no technical labels. The user should feel like a capable team is reading their material and extracting what matters.

The backend is already built: `GET /api/agent-runs` accepts `source_id` and/or `project_id` query params and returns typed `AgentRunSummary[]`. No backend work needed.

---

## Tone and language principles

- Never say "agent", "pipeline", "extraction", "synthesis", "entity", "LLM", or any technical term
- Use active, purposeful language: "Reading your transcript", "Finding the people mentioned", "Spotting commitments"
- Vary the language — if the same message shows repeatedly across sessions it will feel robotic
- Where possible, draw on **the project's domain**. If the project is named "Proc Trak" or contains procurement-related content, use light procurement/building analogies. Otherwise use neutral discovery language
- Status should feel like a knowledgeable colleague giving a progress update, not a loading bar

---

## User-facing label map

Map each `agent_type` from the API to a friendly display label. Use these exactly — do not expose the raw `agent_type` value anywhere in the UI.

```ts
const STEP_LABELS: Record<string, string> = {
  "entity-extraction":   "Finding who's in the room",
  "session-review":      "Writing up the session",
  "action-extraction":   "Spotting commitments & requests",
  "project-synthesis":   "Updating the project picture",
  "problem-discovery":   "Looking for patterns across sessions",
  "gap-detection":       "Checking what still needs answering",
  "frame-draft":         "Drafting a research frame",
  "person-digest":       "Building a contact profile",
  "company-digest":      "Building a company profile",
  "competitor-digest":   "Building a competitor profile",
  "claim-verification":  "Checking the evidence",
  "evidence-grading":    "Sorting what matters",
  "compose":             "Drafting your document",
};
```

For output summaries (from `output_summary` field), transform them before display:

```ts
function friendlyOutput(agentType: string, raw: string | null): string | null {
  if (!raw) return null;
  if (raw.startsWith("Skipped")) return null; // hide skipped steps entirely
  // Pass through the summary but lowercase and soften it
  // e.g. "3 people, 2 companies extracted" → "Found 3 people and 2 companies"
  // e.g. "4 actions, 2 product requests" → "4 commitments, 2 feature requests logged"
  // e.g. "8 themes synthesised" → "8 patterns identified"
  // Map these explicitly:
  return raw
    .replace(/(\d+) people, (\d+) companies extracted/, "Found $1 people and $2 companies")
    .replace(/(\d+) people extracted/, "Found $1 people")
    .replace(/(\d+) companies? extracted/, "Found $1 companies")
    .replace(/(\d+) themes? synthesised/, "$1 patterns identified")
    .replace(/(\d+) problems? found/, "$1 problems surfaced")
    .replace(/(\d+) research gaps? detected/, "$1 areas still to explore")
    .replace("Session brief generated", "Session summary written")
    .replace("Frame draft generated", "Research frame drafted")
    .replace("Completed", "Done")
    .replace(/(\d+) actions?, (\d+) product requests?/, "$1 commitments, $2 feature requests logged")
    .replace(/Digest generated from (\d+) evidence records?/, "Synthesised from $1 mentions")
    .replace(/Brief generated \(\d+ words\)/, "Profile written")
    .replace(/(\d+) claims? verified/, "$1 claims checked against the evidence");
}
```

---

## What to build

### 1. Source insight card — on the source detail page

Location: `src/app/(app)/projects/[projectId]/sources/[sourceId]/page.tsx`

Add an "Insights being built" section near the top of the source detail page, below the source metadata and above the evidence list. Only show this section while at least one run has `status: "running"`, OR if any run has `status: "failed"`. Once all runs are completed or skipped, hide the section entirely — the results speak for themselves elsewhere on the page.

**Data fetch (client component, auto-refresh every 5s while any run is "running"):**
```ts
const res = await fetch(`/api/agent-runs?source_id=${sourceId}`);
const { runs } = await res.json(); // AgentRunSummary[]
```

**Display:**

Show only the steps that are `running` or `failed` — not completed ones. Use a soft card or banner, not a heavy table. Think ambient indicator, not control panel.

For **running** steps:
- Small animated dot or subtle spinner
- Friendly label from STEP_LABELS
- No duration, no model name, nothing technical

For **failed** steps:
- Subtle error state (e.g. muted red tint)
- Friendly message: "Something didn't go as planned here."
- Small "Try again" link that calls `POST /api/ingest/retry` with `{ project_id, source_id }`
- After clicking: loading state, restart polling

**When all done:** Remove the section. Don't show a "complete" banner — the page content is the confirmation.

**Domain-aware flavour text (optional, adds delight):**

If you can detect the project name or domain from context, vary the ambient label. Examples:
- Procurement project → "Reviewing the tender notes…", "Mapping the stakeholders…", "Flagging the procurement signals…"
- Generic → "Reading through the session…", "Identifying key voices…", "Picking out what matters…"

Show one rotating flavour string above the step list while any step is running. Cycle through 3–4 variants every few seconds to avoid a static feel.

---

### 2. Project activity pulse — on the project overview page

Location: `src/app/(app)/projects/[projectId]/page.tsx`

Add a subtle "Recently active" indicator in the project overview — not a full activity log, just a pulse signal that shows the project is alive and being worked on.

**Data fetch (server component):**
```ts
const res = await fetch(`/api/agent-runs?project_id=${projectId}&limit=10`);
const { runs } = await res.json();
```

**Display:**

Only show this if there are runs in the last 48 hours. If so, show a single soft line:
- If any are `running`: a gentle spinner + "Working through your latest session…"
- If all completed recently: "Last updated [relative time]" (e.g. "Last updated 2 hours ago") — use `completed_at` of the most recent run
- If any `failed`: "Some insights need attention — check your source pages."

This is a single line, not a list. It lives unobtrusively near the confidence score or at the top of the page body. It shouldn't dominate — it's ambient reassurance.

---

## Files to create / modify

| File | Action |
|---|---|
| `src/app/(app)/projects/[projectId]/sources/[sourceId]/page.tsx` | Add insight card section |
| `src/app/(app)/projects/[projectId]/sources/[sourceId]/InsightProgress.tsx` | Create — client component with polling |
| `src/app/(app)/projects/[projectId]/page.tsx` | Add activity pulse line |

---

## Type reference

```ts
import type { AgentRunSummary } from "@/app/api/agent-runs/route";

type AgentRunSummary = {
  id: string;
  agent_type: string;
  status: "running" | "completed" | "failed";
  project_id: string | null;
  source_id: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  model_used: string | null;   // do NOT surface this in the UI
  output_summary: string | null;
  error: string | null;        // do NOT surface the raw error — use friendly message
};
```

**Important:** `model_used`, raw `error` strings, `agent_type` values, `duration_ms`, and `output_summary` (before transformation) must never appear in the rendered UI. They are internal data only.

---

## Visual tone

Soft, ambient, purposeful. Not a loading screen. Not a control panel. The closest analogy is the subtle progress indicator you see in a premium file sync app — you know it's working, you trust it, you don't need to understand the mechanics. The results page is the payoff; this is just the reassurance bridge to get there.
