# Codex brief: Session review UI surface

**Size:** S — one focused chunk
**Depends on:** The session review Inngest function (already built by Claude). No migration required.

---

## Context

After every ingest that produces evidence, an Inngest function called `session-review` automatically writes a post-session brief and saves it as an `artifact` of type `report`. The artifact is linked to the source via `metadata.source_id`.

The brief contains: a summary, what they want, reactions to the product/concept, key friction, notable quotes, and suggested follow-up. It's written in prose — designed to be something a PM would share with a stakeholder.

Right now there's no UI surface for it. This brief adds two things:

1. A "Session brief" card at the top of the source detail page, linking to the brief if it exists, or showing a pending state if it's still generating
2. A dedicated artifact view that renders the brief markdown properly (the existing documents page may already cover this — check first)

---

## Task 1 — Show the session brief on the source detail page

**File:** `src/app/(app)/projects/[projectId]/sources/[sourceId]/page.tsx`

### Data fetch addition
Add a fourth parallel query to the existing `Promise.all` to look up the session brief artifact:

```ts
supabase
  .from("artifacts")
  .select("id, title, content_md, created_at, metadata")
  .eq("org_id", project.org_id)
  .eq("project_id", project.id)
  .eq("type", "report")
  .filter("metadata->>source_id", "eq", params.sourceId)
  .order("created_at", { ascending: false })
  .limit(1),
```

Add a type for the result:
```ts
type SessionBriefRow = {
  id: string;
  title: string;
  content_md: string;
  created_at: string;
  metadata: Record<string, unknown>;
};
```

Extract it from the results:
```ts
const sessionBrief = (briefResult.data?.[0] as SessionBriefRow | undefined) ?? null;
```

### UI addition — Session brief card
Insert a new section **between** the page header block and the segment grid. Show it when ingest is done:

```tsx
{/* Session brief — shown after ingest completes */}
{latestJob?.status === "done" && (
  <div className="mb-6">
    {sessionBrief ? (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5">
        <div className="mb-3 flex items-center justify-between gap-4">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
              Session brief
            </div>
            <h2 className="mt-1 text-base font-semibold text-[var(--ink)]">
              {sessionBrief.title}
            </h2>
          </div>
          <Link
            href={`/projects/${project.id}/documents/${sessionBrief.id}`}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--ink)] transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)] whitespace-nowrap"
          >
            Read brief →
          </Link>
        </div>
        {/* Show a short preview — first non-heading paragraph */}
        <p className="text-sm leading-6 text-[var(--ink-muted)] line-clamp-3">
          {sessionBrief.content_md
            .split("\n")
            .find((line) => line.trim() && !line.startsWith("#"))
            ?.trim() ?? "Brief generated — click to read."}
        </p>
      </div>
    ) : (
      <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-1)] p-5">
        <div className="text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
          Session brief
        </div>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Generating session brief — this usually takes under a minute after evidence is ready.
        </p>
      </div>
    )}
  </div>
)}
```

---

## Task 2 — Verify the artifact detail page renders markdown properly

**File:** `src/app/(app)/projects/[projectId]/documents/[artifactId]/page.tsx`

Check whether this page exists and renders `content_md`. If it does and shows the markdown as prose (not raw text), no changes needed — the "Read brief →" link from Task 1 will work as-is.

If the page renders `content_md` as raw text (no formatting), add a basic markdown renderer. The simplest approach without a library is to split on `\n\n` for paragraphs and `## ` for section headings and render those. Or install `marked` or use `dangerouslySetInnerHTML` with a lightweight sanitiser — your call on approach, but keep it simple.

If the documents detail page doesn't exist yet, create a minimal one:

```tsx
// src/app/(app)/projects/[projectId]/documents/[artifactId]/page.tsx
import { getProjectForUser } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

interface Props {
  params: { projectId: string; artifactId: string };
}

export default async function ArtifactDetailPage({ params }: Props) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const project = await getProjectForUser<{ id: string; org_id: string; name: string }>(
    user.id, params.projectId, "id, org_id, name"
  );
  if (!project) notFound();

  const { data: artifact } = await supabase
    .from("artifacts")
    .select("id, title, type, content_md, created_at, word_count, metadata")
    .eq("org_id", project.org_id)
    .eq("project_id", project.id)
    .eq("id", params.artifactId)
    .single();

  if (!artifact) notFound();

  // For source-linked artifacts, show a back link to the source
  const sourceId = (artifact.metadata as Record<string, unknown>)?.source_id as string | null;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8">
        {sourceId ? (
          <Link
            href={`/projects/${project.id}/sources/${sourceId}`}
            className="mb-4 inline-flex text-sm font-medium text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]"
          >
            ← Back to source
          </Link>
        ) : (
          <Link
            href={`/projects/${project.id}/documents`}
            className="mb-4 inline-flex text-sm font-medium text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]"
          >
            ← All documents
          </Link>
        )}
        <h1 className="text-2xl font-semibold text-[var(--ink)]">{artifact.title}</h1>
        {artifact.word_count && (
          <p className="mt-2 text-sm text-[var(--ink-muted)]">{artifact.word_count} words</p>
        )}
      </div>

      <div className="prose prose-invert max-w-none rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-6">
        {/* Render content_md as plain preformatted text for now — replace with markdown renderer if available */}
        <pre className="whitespace-pre-wrap font-sans text-sm leading-7 text-[var(--ink)]">
          {artifact.content_md}
        </pre>
      </div>
    </div>
  );
}
```

If a markdown library is already installed (`marked`, `react-markdown`, etc.), use it here instead of `<pre>`. The brief uses `##` headings and `>` blockquotes, so proper rendering makes a real difference to readability.

---

## What NOT to change
- Do not touch `session-review.ts` — the backend is done
- Do not touch `ingest-source.ts` — the chaining is done
- Do not touch the Inngest route — `sessionReview` is already registered

## Definition of done
- [ ] Source detail page shows a "Session brief" card when ingest is complete — links to the brief if generated, shows a pending state otherwise
- [ ] Clicking "Read brief →" opens a readable view of the brief content (headings render as headings, blockquotes as blockquotes)
- [ ] TypeScript compiles without errors (`npx tsc --noEmit --skipLibCheck`)
- [ ] No regressions on the sources list or evidence view
