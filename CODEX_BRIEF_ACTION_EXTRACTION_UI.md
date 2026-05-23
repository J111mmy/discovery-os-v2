# Codex brief: Action extraction UI

**Size:** S
**Depends on:** Migration `0017_actions_and_requests.sql` must be applied.
**New API routes needed:** Two GET endpoints — see Task 1.
**Surfaces:** Source detail page (actions checklist) + project overview (product requests summary).

---

## Context

After every ingest, the `extract-actions` Inngest function reads the evidence and extracts two things:

1. **Actions** — commitments made by internal team members during the session ("I'll send you the recording", "I'll check with engineering"). Stored in the `actions` table with `status: open | done | dismissed`.

2. **Product requests** — feature/product asks from external participants ("We need CSV export", "Can't buy without Salesforce integration"). Stored in `product_requests` with `priority_signal: nice_to_have | important | critical`.

Both tables reference `source_id` and optionally `evidence_id`. The UI needs to surface these in two places.

---

## Task 1 — API routes

### GET /api/sources/[sourceId]/actions

Create **`src/app/api/sources/[sourceId]/actions/route.ts`**:

```ts
// Returns actions and product_requests for a source.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: { sourceId: string } }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: membership } = await supabase
    .from("org_members").select("org_id").eq("user_id", user.id)
    .order("joined_at", { ascending: true }).limit(1).single();
  if (!membership?.org_id) return NextResponse.json({ error: "No org" }, { status: 403 });

  const [actionsResult, requestsResult] = await Promise.all([
    supabase.from("actions").select("*")
      .eq("org_id", membership.org_id).eq("source_id", params.sourceId)
      .order("created_at", { ascending: true }),
    supabase.from("product_requests").select("*")
      .eq("org_id", membership.org_id).eq("source_id", params.sourceId)
      .order("priority_signal", { ascending: false }),
  ]);

  return NextResponse.json({
    actions: actionsResult.data ?? [],
    product_requests: requestsResult.data ?? [],
  });
}
```

### PATCH /api/actions/[actionId]

Create **`src/app/api/actions/[actionId]/route.ts`**:

```ts
// Updates action status. Body: { status: "open" | "done" | "dismissed" }
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { actionId: string } }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: membership } = await supabase
    .from("org_members").select("org_id").eq("user_id", user.id)
    .order("joined_at", { ascending: true }).limit(1).single();
  if (!membership?.org_id) return NextResponse.json({ error: "No org" }, { status: 403 });

  const body = await req.json() as { status?: string };
  const allowed = ["open", "done", "dismissed"];
  if (!body.status || !allowed.includes(body.status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const { error } = await supabase.from("actions")
    .update({ status: body.status, updated_at: new Date().toISOString() })
    .eq("org_id", membership.org_id)
    .eq("id", params.actionId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

---

## Task 2 — Actions checklist on source detail page

**File:** `src/app/(app)/projects/[projectId]/sources/[sourceId]/page.tsx` (or wherever the source detail page lives — find it by searching for the source detail component).

Add an "Actions from this session" section. Place it below the session brief card (if present) and above the evidence list.

### Fetch actions client-side

Make the actions section a client component that fetches on mount (the source detail page may already be a server component — extract just the actions section as a client component):

```tsx
"use client";

import { useEffect, useState } from "react";

type Action = {
  id: string;
  description: string;
  owner: string | null;
  due_note: string | null;
  status: "open" | "done" | "dismissed";
};

export function ActionsList({ sourceId }: { sourceId: string }) {
  const [actions, setActions] = useState<Action[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(`/api/sources/${sourceId}/actions`)
      .then((r) => r.json())
      .then((data) => {
        setActions(data.actions ?? []);
        setLoaded(true);
      });
  }, [sourceId]);

  async function toggleDone(action: Action) {
    const newStatus = action.status === "done" ? "open" : "done";
    await fetch(`/api/actions/${action.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    setActions((prev) =>
      prev.map((a) => (a.id === action.id ? { ...a, status: newStatus } : a))
    );
  }

  if (!loaded || actions.length === 0) return null;

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-lg font-semibold text-[var(--ink)]">
        Actions ({actions.filter((a) => a.status === "open").length} open)
      </h2>
      <div className="space-y-2">
        {actions.map((action) => (
          <div
            key={action.id}
            className="flex items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-4 py-3"
          >
            <button
              type="button"
              onClick={() => toggleDone(action)}
              className={`mt-0.5 h-4 w-4 shrink-0 rounded border transition-colors ${
                action.status === "done"
                  ? "border-[var(--brand)] bg-[var(--brand)]"
                  : "border-[var(--border)] bg-transparent hover:border-[var(--brand)]"
              }`}
              aria-label={action.status === "done" ? "Mark open" : "Mark done"}
            />
            <div className="min-w-0 flex-1">
              <p
                className={`text-sm ${
                  action.status === "done"
                    ? "text-[var(--ink-faint)] line-through"
                    : "text-[var(--ink)]"
                }`}
              >
                {action.description}
              </p>
              <div className="mt-0.5 flex flex-wrap gap-2 text-xs text-[var(--ink-faint)]">
                {action.owner && <span>{action.owner}</span>}
                {action.due_note && <span>· {action.due_note}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
```

Import and place `<ActionsList sourceId={source.id} />` in the source detail page.

---

## Task 3 — Product requests on source detail page

Add a "Requests from this session" section below the actions list. Fetch from the same `/api/sources/[sourceId]/actions` endpoint (it returns both).

Priority signal colours:
- `critical` → red-tinted border or chip
- `important` → amber-tinted
- `nice_to_have` → default border

```tsx
"use client";

// (can be in the same file as ActionsList, or a separate component)

type ProductRequest = {
  id: string;
  description: string;
  requester_name: string | null;
  priority_signal: "nice_to_have" | "important" | "critical";
};

export function ProductRequestsList({ sourceId }: { sourceId: string }) {
  const [requests, setRequests] = useState<ProductRequest[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(`/api/sources/${sourceId}/actions`)
      .then((r) => r.json())
      .then((data) => {
        setRequests(data.product_requests ?? []);
        setLoaded(true);
      });
  }, [sourceId]);

  if (!loaded || requests.length === 0) return null;

  const priorityLabel = {
    critical: "Critical",
    important: "Important",
    nice_to_have: "Nice to have",
  };

  const priorityClass = {
    critical: "border-red-400 text-red-400",
    important: "border-amber-400 text-amber-400",
    nice_to_have: "border-[var(--border)] text-[var(--ink-faint)]",
  };

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-lg font-semibold text-[var(--ink)]">
        Product requests ({requests.length})
      </h2>
      <div className="space-y-2">
        {requests.map((req) => (
          <div
            key={req.id}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-4 py-3"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm text-[var(--ink)]">{req.description}</p>
              <span
                className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${priorityClass[req.priority_signal]}`}
              >
                {priorityLabel[req.priority_signal]}
              </span>
            </div>
            {req.requester_name && (
              <p className="mt-1 text-xs text-[var(--ink-faint)]">{req.requester_name}</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
```

---

## Task 4 — Deduplicate the fetch (optional optimisation)

If both `ActionsList` and `ProductRequestsList` are siblings on the same page, they'll make two identical API calls. Lift the fetch to a shared parent component and pass the data down as props, or combine both into a single `SessionExtras` component that fetches once and renders both sections.

---

## What NOT to change
- Do not touch `extract-actions.ts` — backend is done
- Do not modify the ingest pipeline

## Definition of done
- [ ] `GET /api/sources/[sourceId]/actions` returns `{ actions, product_requests }`
- [ ] `PATCH /api/actions/[actionId]` updates status with org_id guard
- [ ] Source detail page shows actions checklist (only when actions exist)
- [ ] Source detail page shows product requests list (only when requests exist)
- [ ] Checking off an action marks it done optimistically and PATCHes the API
- [ ] Priority signal shown as a coloured chip on each product request
- [ ] Both sections are hidden when empty (no "No actions yet" empty state needed — the session may simply have had nothing to extract)
- [ ] TypeScript compiles without errors (`npx tsc --noEmit --skipLibCheck`)
- [ ] No regressions on source detail page, evidence list, or session brief
