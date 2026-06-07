# Codex brief: Affiliation flagging + source type update + people profile page

> ⛔ **SECURITY GATE APPLIES (non-negotiable).** Before committing/pushing any change to auth, RLS/migrations, public routes, middleware, or service-role usage, post the diff and wait for Opus's written **APPROVED**. See `AGENTS.md` → "SECURITY REVIEW GATE". This overrides anything below.

**Branch from:** `main` (or the latest commit once pending fixes are pushed)
**Stack:** Next.js 14 App Router, TypeScript, Tailwind CSS, Supabase
**Prerequisites:** Migration `0013_affiliation_and_source_types.sql` must be applied in Supabase before these UI changes go live.

---

## Context

The backend now supports two things that the UI doesn't yet expose:

1. **Affiliation on people** — every person in the `people` table has an `affiliation` column: `internal | external | unknown`. Internal means they're a team member (sales, research, eng). When Claude sees internal speakers before extraction, it treats their speech as context rather than evidence. But right now Jimmy has no way to flag anyone as internal without writing SQL.

2. **Extended source types** — the `source_type` enum now includes `customer_interview`, `sales_call`, `usability_study`, and `internal_meeting` in addition to the legacy values. The ingest form dropdown still only shows `transcript`, `document`, `note`, `other`.

3. **People profile page** — the existing `/people/[personId]/page.tsx` is a minimal view: name, role, linked projects, and a flat list of evidence mentions. It needs a proper profile layout with affiliation visibility and status.

---

## Task 1 — Update the source type dropdown and ingest API validation

**IMPORTANT:** Both files must be updated together. The API validates the `type` field and will reject new values unless it's updated too.

**File A:** `src/app/(app)/projects/[projectId]/ingest/ingest-form.tsx`

Replace the four `<option>` elements in the `<select id="type">` block with:

```tsx
<option value="customer_interview">Customer interview</option>
<option value="sales_call">Sales call</option>
<option value="usability_study">Usability study</option>
<option value="internal_meeting">Internal meeting</option>
<option value="document">Document</option>
<option value="note">Note</option>
<option value="survey">Survey</option>
<option value="support_ticket">Support ticket</option>
<option value="other">Other</option>
```

Change the default state at the top of the component:
```tsx
const [type, setType] = useState("customer_interview");
```

Also update the auto-type logic in `onFileChange` — when a `.pdf`, `.doc`, or `.docx` is uploaded, keep `type` as `document`. When `.txt` is uploaded, leave `type` unchanged (the user already picked the right type before uploading).

**File B:** `src/app/api/ingest/route.ts`

The `IngestSchema` `type` enum must include the new values. *(Claude has already applied this fix — verify it's present before building.)*

```ts
type: z.enum([
  "transcript",
  "document",
  "note",
  "survey",
  "support_ticket",
  "other",
  "customer_interview",
  "sales_call",
  "usability_study",
  "internal_meeting",
]),
```

---

## Task 2 — Affiliation badge and toggle on the people list page

**File:** `src/app/(app)/people/page.tsx`

### Data changes
Update the Supabase query to also select `affiliation` and `status`:
```ts
.select("id, name, role, email, affiliation, status, person_projects(project_id, projects(name))")
```

Add `affiliation: string` and `status: string` to the `PersonRow` type.

### UI changes
On each person card, add two things **before** the project pill row:

**Affiliation badge** — shown inline next to the name:
- `internal` → yellow pill: `border-yellow-500/20 bg-yellow-500/10 text-yellow-300` — label "Internal"
- `external` → no pill (the majority case — don't clutter the list)
- `unknown` → subtle grey pill: `border-[var(--border)] bg-[var(--surface-2)] text-[var(--ink-faint)]` — label "Unclassified"

```tsx
function AffiliationBadge({ affiliation }: { affiliation: string }) {
  if (affiliation === "internal") {
    return (
      <span className="rounded-full border border-yellow-500/20 bg-yellow-500/10 px-2 py-0.5 text-xs font-medium text-yellow-300">
        Internal
      </span>
    );
  }
  if (affiliation === "unknown") {
    return (
      <span className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-xs font-medium text-[var(--ink-faint)]">
        Unclassified
      </span>
    );
  }
  return null;
}
```

Place `<AffiliationBadge affiliation={person.affiliation} />` next to the person's name link, inside the name row `div`.

### Filtering tabs (optional — add if time permits)
Add three tab buttons above the list: **All** | **External** | **Internal**. Client component filter — no server refetch needed. Store selected tab in local state.

---

## Task 3 — Affiliation toggle on the person detail page

**File:** `src/app/(app)/people/[personId]/page.tsx`

### Data changes
Update the people select to include `affiliation`, `status`, and `company_id`:
```ts
.select("id, name, role, email, affiliation, status, company_id, person_projects(project_id, projects(name))")
```

Add fields to `PersonDetail` type:
```ts
type PersonDetail = {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  affiliation: string;
  status: string;
  company_id: string | null;
  person_projects: ProjectRelation[] | ProjectRelation | null;
};
```

### New API route for affiliation toggle
Create **`src/app/api/people/[personId]/affiliation/route.ts`**:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { personId: string } }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Resolve the user's org — every DB write must include org_id
  const { data: membership } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", user.id)
    .order("joined_at", { ascending: true })
    .limit(1)
    .single();

  if (!membership?.org_id) {
    return NextResponse.json({ error: "Org not found" }, { status: 404 });
  }

  const body = await request.json();
  const affiliation = body.affiliation;
  if (!["internal", "external", "unknown"].includes(affiliation)) {
    return NextResponse.json({ error: "Invalid affiliation value" }, { status: 400 });
  }

  const { error } = await supabase
    .from("people")
    .update({ affiliation, updated_at: new Date().toISOString() })
    .eq("org_id", membership.org_id)   // explicit org guard — never skip this
    .eq("id", params.personId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

### Affiliation toggle UI (client component)
Create **`src/app/(app)/people/[personId]/affiliation-toggle.tsx`**:

```tsx
"use client";

import { useState } from "react";

const OPTIONS = [
  { value: "external", label: "External", description: "Customer, prospect, or third party" },
  { value: "internal", label: "Internal", description: "Team member — speech treated as context, not evidence" },
  { value: "unknown", label: "Unclassified", description: "Not yet classified" },
] as const;

type Affiliation = "internal" | "external" | "unknown";

export function AffiliationToggle({
  personId,
  initialAffiliation,
}: {
  personId: string;
  initialAffiliation: Affiliation;
}) {
  const [current, setCurrent] = useState<Affiliation>(initialAffiliation);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setAffiliation(value: Affiliation) {
    if (value === current || saving) return;
    setSaving(true);
    setError(null);

    const response = await fetch(`/api/people/${personId}/affiliation`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ affiliation: value }),
    });

    setSaving(false);
    if (!response.ok) {
      const payload = await response.json();
      setError(payload.error ?? "Could not update affiliation.");
    } else {
      setCurrent(value);
    }
  }

  return (
    <div>
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
        Affiliation
      </div>
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={saving}
            onClick={() => setAffiliation(option.value)}
            title={option.description}
            className={[
              "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              current === option.value
                ? option.value === "internal"
                  ? "border-yellow-500/40 bg-yellow-500/15 text-yellow-300"
                  : option.value === "external"
                  ? "border-green-500/30 bg-green-500/10 text-green-300"
                  : "border-[var(--brand)]/30 bg-[var(--brand)]/10 text-[var(--brand)]"
                : "border-[var(--border)] bg-[var(--surface-0)] text-[var(--ink-muted)] hover:border-[var(--ink-muted)]",
            ].join(" ")}
          >
            {saving && current !== option.value ? option.label : option.label}
          </button>
        ))}
      </div>
      {error && <div className="mt-2 text-xs text-red-300">{error}</div>}
      {current === "internal" && (
        <p className="mt-2 text-xs leading-5 text-[var(--ink-faint)]">
          Claude will treat this person's speech as context, not customer evidence, during ingest.
        </p>
      )}
    </div>
  );
}
```

### Updated person detail page header section
Replace the current `<section>` header with:

```tsx
<section className="mb-8 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5">
  <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
    <div className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <StatusBadge status={personRow.status} />
        {personRow.affiliation === "internal" && (
          <span className="rounded-full border border-yellow-500/20 bg-yellow-500/10 px-2 py-0.5 text-xs font-medium text-yellow-300">
            Internal
          </span>
        )}
      </div>
      <h1 className="text-2xl font-semibold text-[var(--ink)]">{personRow.name}</h1>
      {(personRow.role || personRow.email) && (
        <p className="mt-2 text-sm text-[var(--ink-muted)]">
          {[personRow.role, personRow.email].filter(Boolean).join(" · ")}
        </p>
      )}
    </div>
    {projectLinks.length > 0 && (
      <div className="flex flex-wrap gap-2 sm:justify-end">
        {projectLinks.map((relation) => (
          <Link
            key={relation.project_id}
            href={`/projects/${relation.project_id}`}
            className="rounded-full border border-[var(--border)] bg-[var(--surface-0)] px-2.5 py-1 text-xs font-medium text-[var(--ink-muted)] transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)]"
          >
            {projectName(relation.projects)}
          </Link>
        ))}
      </div>
    )}
  </div>

  <div className="mt-5 border-t border-[var(--border)] pt-5">
    <AffiliationToggle
      personId={personRow.id}
      initialAffiliation={personRow.affiliation as "internal" | "external" | "unknown"}
    />
  </div>
</section>
```

Add a `StatusBadge` component at the top of the file:
```tsx
function StatusBadge({ status }: { status: string }) {
  const label = status.replace(/-/g, " ");
  return (
    <span className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-xs font-medium capitalize text-[var(--ink-muted)]">
      {label}
    </span>
  );
}
```

---

## Task 4 — Add affiliation to people list in `/people/page.tsx` on the server (also enables filtering by affiliation)

The people page is currently a server component. To support the filter tabs without a full reload, extract the list into a client component. However, if time is short, skip the filtering tabs and just add the affiliation badges to the existing server component — that's the priority.

---

## What NOT to change
- Do not touch `extract-entities.ts` — entity extraction already handles people correctly.
- Do not touch `ingest-source.ts` — internal speaker context passing is already implemented.
- Do not modify any migration files — `0013_affiliation_and_source_types.sql` is done.
- Do not add company or competitor profile pages yet — that's a separate brief.

---

## Definition of done
- [ ] Ingest form shows the full source type list with `customer_interview` as default.
- [ ] People list shows `Internal` badge in yellow for internal people; nothing for external; `Unclassified` pill for unknown.
- [ ] Person detail page shows affiliation toggle (External / Internal / Unclassified) that persists via PATCH `/api/people/[personId]/affiliation`.
- [ ] TypeScript compiles without errors (`npx tsc --noEmit --skipLibCheck`).
- [ ] No regressions on the sources page, evidence list, or ingest flow.
