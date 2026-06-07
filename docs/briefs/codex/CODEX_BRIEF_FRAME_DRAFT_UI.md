# Codex brief: Frame draft UI

> ⛔ **SECURITY GATE APPLIES (non-negotiable).** Before committing/pushing any change to auth, RLS/migrations, public routes, middleware, or service-role usage, post the diff and wait for Opus's written **APPROVED**. See `AGENTS.md` → "SECURITY REVIEW GATE". This overrides anything below.

**Size:** S
**Depends on:** Migration `0015_frame_draft.sql` must be applied before this goes live.
**No new API routes needed for display** — `frame_draft` and `frame_draft_generated_at` are read from the projects table. Accepting the draft writes to `projects.frame` via the existing project update route.

---

## Context

After the first ingest on a project where `projects.frame` is null, the `draft-frame` Inngest function automatically generates a structured frame proposal and saves it to `projects.frame_draft` (jsonb):

```ts
{
  problem:          string;  // one or two sentences
  hypothesis:       string;  // "We believe that…" or "If we…"
  buyers:           string;  // one or two sentences describing the buyer persona
  research_areas:   string[]; // 3–5 short labels, e.g. ["Pricing sensitivity", "Workflow fit", "Champion identification"]
}
```

The live frame field (`projects.frame`) is **not touched** — Jimmy has full control over whether to accept, edit, or discard the draft.

The frame page already exists at `/projects/[projectId]/frame`. This brief adds a draft notice banner to that page when a draft exists but no live frame has been set.

---

## Task 1 — Add frame_draft to the project data fetch

**File:** `src/app/(app)/projects/[projectId]/frame/page.tsx`

Update the project select to include the draft fields:

```ts
.select("id, name, frame, frame_data, frame_draft, frame_draft_generated_at")
```

Add fields to the local type:
```ts
type ProjectFrameData = {
  id: string;
  name: string;
  frame: string | null;
  frame_data: Record<string, unknown> | null;
  frame_draft: {
    problem: string;
    hypothesis: string;
    buyers: string;
    research_areas: string[];
  } | null;
  frame_draft_generated_at: string | null;
};
```

---

## Task 2 — Draft suggestion banner

Show the banner **only when**: `project.frame_draft` is non-null AND (`project.frame` is null OR `project.frame.trim().length === 0`).

Place the banner **above** the frame edit form, inside the page layout.

```tsx
{project.frame_draft && (!project.frame || project.frame.trim().length === 0) && (
  <FrameDraftBanner
    projectId={project.id}
    draft={project.frame_draft}
    generatedAt={project.frame_draft_generated_at}
  />
)}
```

### FrameDraftBanner (client component)

Create **`src/app/(app)/projects/[projectId]/frame/frame-draft-banner.tsx`**:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type FrameDraft = {
  problem: string;
  hypothesis: string;
  buyers: string;
  research_areas: string[];
};

export function FrameDraftBanner({
  projectId,
  draft,
  generatedAt,
}: {
  projectId: string;
  draft: FrameDraft;
  generatedAt: string | null;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "accepting" | "discarding" | "error">("idle");

  // Build a formatted frame text from the draft fields — written to projects.frame on accept
  function buildFrameText(d: FrameDraft): string {
    const areas = d.research_areas.map((a) => `- ${a}`).join("\n");
    return [
      `Problem: ${d.problem}`,
      `Hypothesis: ${d.hypothesis}`,
      `Buyers: ${d.buyers}`,
      `Research areas:\n${areas}`,
    ].join("\n\n");
  }

  async function accept() {
    setState("accepting");
    const res = await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frame: buildFrameText(draft), frame_draft: null }),
    });
    if (res.ok) {
      router.refresh();
    } else {
      setState("error");
    }
  }

  async function discard() {
    setState("discarding");
    const res = await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frame_draft: null }),
    });
    if (res.ok) {
      router.refresh();
    } else {
      setState("error");
    }
  }

  const formattedDate = generatedAt
    ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(generatedAt))
    : null;

  return (
    <div className="mb-8 rounded-xl border border-[var(--brand)] bg-[var(--surface-1)] p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-[var(--brand)]">AI-proposed frame</h2>
          {formattedDate && (
            <p className="mt-0.5 text-xs text-[var(--ink-faint)]">Generated {formattedDate} from your first research session</p>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            onClick={discard}
            disabled={state !== "idle"}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--ink-muted)] transition-colors hover:border-[var(--ink-muted)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {state === "discarding" ? "Discarding…" : "Discard"}
          </button>
          <button
            type="button"
            onClick={accept}
            disabled={state !== "idle"}
            className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {state === "accepting" ? "Applying…" : "Accept draft"}
          </button>
        </div>
      </div>

      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">Problem</dt>
          <dd className="mt-1 text-[var(--ink)]">{draft.problem}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">Hypothesis</dt>
          <dd className="mt-1 text-[var(--ink)]">{draft.hypothesis}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">Buyers</dt>
          <dd className="mt-1 text-[var(--ink)]">{draft.buyers}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">Research areas</dt>
          <dd className="mt-1 flex flex-wrap gap-2">
            {draft.research_areas.map((area) => (
              <span
                key={area}
                className="rounded-full border border-[var(--border)] px-2.5 py-0.5 text-xs text-[var(--ink-muted)]"
              >
                {area}
              </span>
            ))}
          </dd>
        </div>
      </dl>

      {state === "error" && (
        <p className="mt-3 text-xs text-red-300">Something went wrong — please try again.</p>
      )}

      <p className="mt-4 text-xs text-[var(--ink-faint)]">
        Accepting will pre-fill the frame below for editing. You can change anything before saving.
      </p>
    </div>
  );
}
```

Import it in the frame page:
```tsx
import { FrameDraftBanner } from "./frame-draft-banner";
```

---

## Task 3 — PATCH route must accept frame_draft: null

The existing `PATCH /api/projects/[projectId]` route handles frame updates. Ensure it also accepts and writes `frame_draft` (including `null` to clear it). If the route currently only handles `frame` and `frame_data`, add `frame_draft` to the allowed update fields.

Check `src/app/api/projects/[projectId]/route.ts`. The PATCH handler should allow:
```ts
const allowed = ["name", "description", "frame", "frame_data", "frame_draft", "gtm_context", "operating_style"];
```

Anything not in the allowed list should be stripped before the `.update()` call. Do not add `org_id` or `id` to the allowed list.

---

## What NOT to change
- Do not touch `draft-frame.ts` — backend is done
- Do not modify the ingest pipeline
- Do not create a new API route for accepting — the existing PATCH handles it

## Definition of done
- [ ] Frame page fetches `frame_draft` and `frame_draft_generated_at`
- [ ] Banner appears when `frame_draft` is non-null and `frame` is null/empty
- [ ] "Accept draft" writes formatted frame text to `projects.frame` and clears `frame_draft`, then refreshes
- [ ] "Discard" clears `frame_draft: null` and refreshes
- [ ] Banner does not appear when a live frame is already set
- [ ] `PATCH /api/projects/[projectId]` accepts `frame_draft` as a writable field (including `null`)
- [ ] TypeScript compiles without errors (`npx tsc --noEmit --skipLibCheck`)
- [ ] No regressions on the existing frame edit form
