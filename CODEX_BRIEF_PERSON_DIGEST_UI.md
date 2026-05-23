# Codex brief: Person digest UI

**Size:** S
**Depends on:** Migration `0014_person_digest.sql` must be applied before this UI goes live.
**No new API routes needed** — digest is read from the people table; refresh triggers via `POST /api/people/[personId]/synthesise` (already built by Claude).

---

## Context

The `synthesise-person` Inngest function now auto-generates an AI digest for each external person after every ingest. The digest is stored in `people.digest` (text) and `people.digest_updated_at` (timestamptz). It's a 3–5 paragraph narrative: who the person is, what they consistently want, their product reactions, strong opinions, and overall relationship signal.

The person detail page (`/people/[personId]/page.tsx`) already shows affiliation controls and an evidence list. This brief adds the digest display above the evidence section.

---

## Task 1 — Add digest to the person detail data fetch

**File:** `src/app/(app)/people/[personId]/page.tsx`

Update the people select to include `digest` and `digest_updated_at`:

```ts
.select("id, name, role, email, affiliation, status, company_id, digest, digest_updated_at, person_projects(project_id, projects(name))")
```

Add fields to the `PersonDetail` type:
```ts
type PersonDetail = {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  affiliation: Affiliation;
  status: PersonStatus;
  company_id: string | null;
  digest: string | null;
  digest_updated_at: string | null;
  person_projects: ProjectRelation[] | ProjectRelation | null;
};
```

---

## Task 2 — Digest display + refresh button

Add a new section between the header card and the evidence section. Call the component inline or extract it — your choice.

### Digest display (server-rendered, no client component needed for display)

```tsx
<section className="mb-8">
  <div className="mb-4 flex items-end justify-between gap-4">
    <div>
      <h2 className="text-lg font-semibold text-[var(--ink)]">Intelligence brief</h2>
      {personRow.digest_updated_at && (
        <p className="mt-1 text-xs text-[var(--ink-faint)]">
          Last generated {new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(personRow.digest_updated_at))}
        </p>
      )}
    </div>
    <DigestRefreshButton personId={personRow.id} />
  </div>

  {personRow.digest ? (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-6">
      <p className="whitespace-pre-wrap text-sm leading-7 text-[var(--ink)]">
        {personRow.digest}
      </p>
    </div>
  ) : (
    <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-1)] p-8 text-center">
      <p className="text-sm text-[var(--ink-muted)]">
        No digest yet. Digests are generated automatically after each ingest once this person has 3 or more evidence records. Use the button above to generate one now.
      </p>
    </div>
  )}
</section>
```

### DigestRefreshButton (client component)

Create **`src/app/(app)/people/[personId]/digest-refresh-button.tsx`**:

```tsx
"use client";

import { useState } from "react";

export function DigestRefreshButton({ personId }: { personId: string }) {
  const [state, setState] = useState<"idle" | "queued" | "error">("idle");

  async function refresh() {
    setState("queued");
    const response = await fetch(`/api/people/${personId}/synthesise`, { method: "POST" });
    if (response.ok) {
      // Brief is generating in the background — reload after a delay to show updated digest
      setTimeout(() => window.location.reload(), 8000);
    } else {
      setState("error");
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={refresh}
        disabled={state === "queued"}
        className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--ink)] transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {state === "queued" ? "Generating…" : "Refresh digest"}
      </button>
      {state === "error" && (
        <span className="text-xs text-red-300">Could not start — try again.</span>
      )}
      {state === "queued" && (
        <span className="text-xs text-[var(--ink-faint)]">This takes about 30 seconds</span>
      )}
    </div>
  );
}
```

Import it in the page:
```tsx
import { DigestRefreshButton } from "./digest-refresh-button";
```

---

## What NOT to change
- Do not touch `synthesise-person.ts` — the backend is done
- Do not touch `/api/people/[personId]/synthesise/route.ts` — already built
- Do not modify the affiliation toggle — it's working

## Definition of done
- [ ] Person detail page shows "Intelligence brief" section with the digest prose if it exists, or a pending-state card if not
- [ ] "Refresh digest" button POSTs to the synthesise endpoint, shows a queued state, and reloads after ~8 seconds
- [ ] Date of last generation shown when a digest exists
- [ ] TypeScript compiles without errors (`npx tsc --noEmit --skipLibCheck`)
- [ ] No regressions on people list, affiliation toggle, or evidence list
