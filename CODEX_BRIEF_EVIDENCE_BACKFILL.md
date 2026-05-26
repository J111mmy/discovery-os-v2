# Codex Brief — Evidence Grading Backfill

## Problem

The AI evidence grading feature runs automatically on new ingest. But existing evidence records (ingested before grading was deployed) have `ai_trust_grade = NULL` and `trust_scope = 'pending'`. They show as "Needs review" and will never be graded automatically. We need a one-click backfill in the admin panel to grade them.

Inngest is live and connected in production — use it.

---

## What to build

### 1. Backfill API route

**File:** `src/app/api/admin/backfill-grades/route.ts`

`POST /api/admin/backfill-grades`

- Super admin only — check `isSuperAdmin()`, return 403 if not
- Accepts JSON body: `{ org_id: string }`
- Uses `createServiceClient()` throughout
- Fetches all evidence for that org where `ai_trust_grade IS NULL`
- Groups those records by `project_id + source_id`
- Fires `source/evidence.grading.requested` Inngest events in batches of 50 (the event the existing grade-evidence function listens to)
- Returns `{ queued: number }` immediately — Inngest handles the rest async

```ts
import { inngest } from "@/lib/inngest/client";
import { createServiceClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/auth/super-admin";
import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isSuperAdmin(user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { org_id } = await req.json();
  if (!org_id) return NextResponse.json({ error: "org_id required" }, { status: 400 });

  const service = createServiceClient();
  const { data: evidence } = await service
    .from("evidence")
    .select("id, project_id, source_id")
    .eq("org_id", org_id)
    .is("ai_trust_grade", null);

  if (!evidence || evidence.length === 0) {
    return NextResponse.json({ queued: 0 });
  }

  // Fire one grading event per source — the existing grader works source-by-source.
  const sourceKeys = new Set(
    evidence
      .filter((e) => e.source_id)
      .map((e) => `${e.project_id}:${e.source_id}`)
  );

  await inngest.send(
    Array.from(sourceKeys).map((key) => {
      const [project_id, source_id] = key.split(":");
      return {
        name: "source/evidence.grading.requested",
        data: { source_id, project_id, org_id },
      };
    })
  );

  return NextResponse.json({ queued: evidence.length });
}
```

### 2. Button in admin org detail page

**File:** `src/app/(admin)/admin/orgs/[orgId]/page.tsx`

Add a client component `BackfillButton` and render it at the bottom of the page, after the recent runs section.

```tsx
"use client";
import { useState } from "react";

function BackfillButton({ orgId }: { orgId: string }) {
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function handleClick() {
    setStatus("running");
    try {
      const res = await fetch("/api/admin/backfill-grades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org_id: orgId }),
      });
      const data = await res.json();
      setMessage(
        data.queued === 0
          ? "All evidence already graded."
          : `Queued ${data.queued} records for grading — check Inngest for progress.`
      );
      setStatus("done");
    } catch {
      setMessage("Something went wrong.");
      setStatus("error");
    }
  }

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-[var(--ink)]">Evidence grading</h2>
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5">
        <p className="mb-4 text-sm text-[var(--ink-muted)]">
          Grade all ungraded evidence for this org. Jobs run via the background pipeline — check Inngest dashboard for progress.
        </p>
        <button
          onClick={handleClick}
          disabled={status === "running" || status === "done"}
          className="rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-dim)] disabled:opacity-50"
        >
          {status === "running" ? "Queuing..." : status === "done" ? "Queued ✓" : "Re-grade all evidence"}
        </button>
        {message && (
          <p className={`mt-3 text-sm ${status === "error" ? "text-red-400" : "text-green-400"}`}>
            {message}
          </p>
        )}
      </div>
    </section>
  );
}
```

In the server component, pass `org.id` to it:
```tsx
<BackfillButton orgId={org.id} />
```

---

## How it works end to end

1. Jimmy hits "Re-grade all evidence" in `/admin/orgs/[orgId]`
2. Route fetches all ungraded source-backed evidence for that org
3. Fires one `source/evidence.grading.requested` event per source — Inngest queues them
4. The existing `grade-evidence` Inngest function grades all evidence for each queued source
5. Trusted evidence with research context set gets `trust_scope = 'trusted'` automatically
6. "Needs review" count on the project overview drops as grades come in

---

## TypeScript check

```bash
npm run type-check
npm run build
```

Both must pass before pushing.
