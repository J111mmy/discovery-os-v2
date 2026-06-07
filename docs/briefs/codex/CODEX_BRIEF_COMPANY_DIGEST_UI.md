# Codex brief: Company detail page + digest UI

> ⛔ **SECURITY GATE APPLIES (non-negotiable).** Before committing/pushing any change to auth, RLS/migrations, public routes, middleware, or service-role usage, post the diff and wait for Opus's written **APPROVED**. See `AGENTS.md` → "SECURITY REVIEW GATE". This overrides anything below.

**Size:** M
**Depends on:** Migration `0016_company_digest.sql` must be applied.
**New routes needed:** `GET /api/companies/[companyId]` — see Task 1.
**New page:** `/companies/[companyId]` (the companies list page already exists at `/companies`).

---

## Context

Companies are currently just a name in a list. The backend can now synthesise a prose digest for each company from all their linked evidence across projects. The digest is stored in `companies.digest` (text) with `companies.digest_updated_at`.

The goal is a company detail page that serves as a pre-call intelligence brief: who they are, what everyone from that company has told us, which projects they're involved in, and a "Refresh digest" button.

---

## Task 1 — API route: GET /api/companies/[companyId]

Create **`src/app/api/companies/[companyId]/route.ts`**:

This route returns all the data the detail page needs in one call — company metadata, people from this company, projects they appear in, and recent evidence.

```ts
// GET /api/companies/[companyId]
// Returns company detail with people, projects, and recent evidence.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: { companyId: string } }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  const [companyResult, peopleResult, projectsResult, evidenceResult] = await Promise.all([
    supabase
      .from("companies")
      .select("id, name, domain, industry, size, notes, digest, digest_updated_at")
      .eq("org_id", membership.org_id)
      .eq("id", params.companyId)
      .single(),
    supabase
      .from("people")
      .select("id, name, role, status, email")
      .eq("org_id", membership.org_id)
      .eq("company_id", params.companyId)
      .order("name", { ascending: true }),
    supabase
      .from("company_projects")
      .select("project_id, projects(id, name)")
      .eq("company_id", params.companyId),
    supabase
      .from("evidence_entities")
      .select("evidence(id, content, summary, classification, sentiment, metadata, created_at)")
      .eq("org_id", membership.org_id)
      .eq("entity_type", "company")
      .eq("entity_id", params.companyId)
      .limit(20),
  ]);

  if (!companyResult.data) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  // Flatten evidence join
  const evidence = (evidenceResult.data ?? [])
    .flatMap((row: { evidence: unknown }) => {
      const e = row.evidence;
      if (!e) return [];
      return Array.isArray(e) ? e : [e];
    })
    .filter(Boolean);

  return NextResponse.json({
    company: companyResult.data,
    people: peopleResult.data ?? [],
    projects: (projectsResult.data ?? []).map((r: { project_id: string; projects: unknown }) => r.projects).filter(Boolean),
    evidence,
  });
}
```

---

## Task 2 — Company detail page

Create **`src/app/(app)/companies/[companyId]/page.tsx`**:

This is a server component that fetches via the API route and renders the detail view.

### Layout structure (top to bottom):

1. **Header card** — company name, domain (linked), industry + size if known, notes if present
2. **Intelligence brief** — digest prose section with "Refresh digest" button (see Task 3)
3. **People from this company** — card list, each showing name, role, status badge, link to person detail page
4. **Projects** — pill list of every project this company appears in, each linking to `/projects/[projectId]`
5. **Recent evidence** — list of up to 20 evidence cards: classification chip, sentiment, content, source metadata (speaker + project if available)

### Header card example:
```tsx
<div className="mb-8 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-6">
  <h1 className="text-2xl font-semibold text-[var(--ink)]">{company.name}</h1>
  {company.domain && (
    <a
      href={`https://${company.domain}`}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1 text-sm text-[var(--brand)] hover:underline"
    >
      {company.domain}
    </a>
  )}
  <div className="mt-3 flex flex-wrap gap-3 text-sm text-[var(--ink-muted)]">
    {company.industry && <span>{company.industry}</span>}
    {company.size && <span>{company.size}</span>}
  </div>
  {company.notes && (
    <p className="mt-4 text-sm text-[var(--ink-muted)]">{company.notes}</p>
  )}
</div>
```

### People roster example:
```tsx
<section className="mb-8">
  <h2 className="mb-4 text-lg font-semibold text-[var(--ink)]">
    People ({people.length})
  </h2>
  {people.length === 0 ? (
    <p className="text-sm text-[var(--ink-muted)]">No named contacts yet.</p>
  ) : (
    <div className="space-y-2">
      {people.map((person) => (
        <a
          key={person.id}
          href={`/people/${person.id}`}
          className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-4 py-3 transition-colors hover:border-[var(--brand)]"
        >
          <div>
            <p className="text-sm font-medium text-[var(--ink)]">{person.name}</p>
            {person.role && <p className="text-xs text-[var(--ink-muted)]">{person.role}</p>}
          </div>
          <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--ink-faint)]">
            {person.status ?? "—"}
          </span>
        </a>
      ))}
    </div>
  )}
</section>
```

### Projects section:
```tsx
<section className="mb-8">
  <h2 className="mb-3 text-lg font-semibold text-[var(--ink)]">Projects</h2>
  {projects.length === 0 ? (
    <p className="text-sm text-[var(--ink-muted)]">Not linked to any projects yet.</p>
  ) : (
    <div className="flex flex-wrap gap-2">
      {projects.map((project) => (
        <a
          key={project.id}
          href={`/projects/${project.id}`}
          className="rounded-full border border-[var(--border)] px-3 py-1 text-sm text-[var(--ink-muted)] transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)]"
        >
          {project.name}
        </a>
      ))}
    </div>
  )}
</section>
```

### Evidence section:
```tsx
<section className="mb-8">
  <h2 className="mb-4 text-lg font-semibold text-[var(--ink)]">Recent evidence</h2>
  {evidence.length === 0 ? (
    <p className="text-sm text-[var(--ink-muted)]">No linked evidence yet.</p>
  ) : (
    <div className="space-y-3">
      {evidence.map((item) => (
        <div key={item.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-4">
          <div className="mb-2 flex flex-wrap gap-2">
            {item.classification && (
              <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-xs text-[var(--ink-muted)]">
                {item.classification}
              </span>
            )}
            {item.sentiment && (
              <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-xs text-[var(--ink-muted)]">
                {item.sentiment}
              </span>
            )}
          </div>
          <p className="text-sm leading-relaxed text-[var(--ink)]">{item.content}</p>
          {item.summary && (
            <p className="mt-2 text-xs italic text-[var(--ink-muted)]">{item.summary}</p>
          )}
        </div>
      ))}
    </div>
  )}
</section>
```

---

## Task 3 — Intelligence brief section + DigestRefreshButton

Add the digest section between the header card and the people roster. Mirror the pattern from the person detail page (`CODEX_BRIEF_PERSON_DIGEST_UI.md`).

Create **`src/app/(app)/companies/[companyId]/digest-refresh-button.tsx`**:

```tsx
"use client";

import { useState } from "react";

export function DigestRefreshButton({ companyId }: { companyId: string }) {
  const [state, setState] = useState<"idle" | "queued" | "error">("idle");

  async function refresh() {
    setState("queued");
    const response = await fetch(`/api/companies/${companyId}/synthesise`, { method: "POST" });
    if (response.ok) {
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
      {state === "error" && <span className="text-xs text-red-300">Could not start — try again.</span>}
      {state === "queued" && <span className="text-xs text-[var(--ink-faint)]">This takes about 30 seconds</span>}
    </div>
  );
}
```

Digest display section (server-rendered):
```tsx
<section className="mb-8">
  <div className="mb-4 flex items-end justify-between gap-4">
    <div>
      <h2 className="text-lg font-semibold text-[var(--ink)]">Intelligence brief</h2>
      {company.digest_updated_at && (
        <p className="mt-1 text-xs text-[var(--ink-faint)]">
          Last generated {new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(company.digest_updated_at))}
        </p>
      )}
    </div>
    <DigestRefreshButton companyId={company.id} />
  </div>

  {company.digest ? (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-6">
      <p className="whitespace-pre-wrap text-sm leading-7 text-[var(--ink)]">
        {company.digest}
      </p>
    </div>
  ) : (
    <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-1)] p-8 text-center">
      <p className="text-sm text-[var(--ink-muted)]">
        No digest yet. Digests generate automatically after evidence accumulates from this company. Use the button above to generate one now.
      </p>
    </div>
  )}
</section>
```

Import in the page:
```tsx
import { DigestRefreshButton } from "./digest-refresh-button";
```

---

## Task 4 — Link company names to detail page

**File:** Wherever company names appear in the app — company list page, person detail page, evidence cards.

Find usages of company name display and wrap them in links to `/companies/[companyId]`.

At minimum:
- Company list page (`/companies`): each company row/card should link to `/companies/[id]`
- Person detail page: the company name shown in the header should link to `/companies/[company_id]` if `company_id` is set

---

## What NOT to change
- Do not touch `synthesise-company.ts` — backend is done
- Do not touch `/api/companies/[companyId]/synthesise/route.ts` — already built

## Definition of done
- [ ] `GET /api/companies/[companyId]` returns company, people, projects, evidence
- [ ] `/companies/[companyId]` page renders all four sections (header, digest, people, projects, evidence)
- [ ] "Refresh digest" button POSTs to synthesise endpoint, shows queued state, reloads after ~8 seconds
- [ ] Company names in the companies list link to the detail page
- [ ] Company name on person detail page links to detail page (if company_id is set)
- [ ] TypeScript compiles without errors (`npx tsc --noEmit --skipLibCheck`)
- [ ] No regressions on companies list, people list, or person detail page
