# Codex Brief — Competitor Profiles UI

## Goal

Build the competitor detail page and wire up the on-demand digest refresh button. Competitors already have `positioning`, `known_strengths`, `known_gaps`, and `last_researched` columns from migration 0006. Migration 0018 adds `digest`, `digest_updated_at`, and `battle_card` (jsonb). The Inngest backend (`synthesise-competitor.ts`) writes all of these on demand and automatically after each ingest.

---

## What to build

### 1. Competitor detail page — `src/app/(app)/competitors/[competitorId]/page.tsx`

This mirrors the company detail page pattern (`src/app/(app)/companies/[companyId]/page.tsx`). Build it as a server component that fetches all data upfront.

**Data to fetch via Supabase:**

```ts
// Competitor row
const { data: competitor } = await supabase
  .from("competitors")
  .select("*")
  .eq("org_id", orgId)
  .eq("id", params.competitorId)
  .single();

// Evidence mentioning this competitor (via join table)
const { data: evidenceLinks } = await supabase
  .from("evidence_entities")
  .select("evidence(id, content, summary, classification, sentiment, metadata, project_id, source_id, created_at)")
  .eq("org_id", orgId)
  .eq("entity_type", "competitor")
  .eq("entity_id", params.competitorId)
  .order("created_at", { ascending: false });

// Project names for evidence
// (extract project_ids from evidence, then fetch names)

// People who mentioned this competitor
// (optional: show speakers from evidence metadata if metadata.speaker is populated)
```

**Page sections (in order):**

#### Header
- Competitor name (h1)
- Website as a plain link if set (e.g. `acme.com →`)
- Last researched date if `last_researched` is set (e.g. "Last updated 3 days ago")
- `DigestRefreshButton` client component (see below) — triggers `POST /api/competitors/[competitorId]/synthesise`

---

#### Intelligence Brief (only render if `competitor.digest` is set)

Render `competitor.digest` as prose (markdown or plain text — it arrives as paragraphs). Label the section "Intelligence Brief". Show `digest_updated_at` as a small timestamp beneath.

---

#### Battle Card (always render the section, even if `battle_card` is null)

The battle card has 5 fields split into two zones:

**AI-filled (read-only, rendered as plain text):**
| Field | Label |
|---|---|
| `their_pitch` | Their pitch |
| `where_they_win` | Where they win |
| `their_gap` | Their gap |

**User-filled (editable inline):**
| Field | Label |
|---|---|
| `your_counter` | Your counter |
| `one_proof_point` | One proof point |

Render the 3 AI fields as styled read-only cards. Render `your_counter` and `one_proof_point` as editable textareas — on blur, `PATCH` the value to the API (see API route below).

If `battle_card` is null (digest not yet generated), show a placeholder: "Run the intelligence digest to generate a battle card."

---

#### Competitive Position (only render if any of these are set)

Three subsections side-by-side or stacked:

- **Positioning** — `competitor.positioning` — how customers understand their pitch
- **Where they win** — `competitor.known_strengths`
- **Their gaps** — `competitor.known_gaps`

These are plain text strings (no markdown). Show a label above each and the text below. These are read-only; the AI updates them on each digest run.

---

#### Evidence ({N} records)

List all evidence records mentioning this competitor. For each:
- Classification badge (e.g. "pain", "signal", "request") — same style as used elsewhere
- Speaker name from `metadata.speaker` if present
- Project name (resolve from project_id)
- `summary` if set, otherwise first 200 chars of `content`
- Link to the source: `/projects/[project_id]/sources/[source_id]`

If no evidence yet: "No evidence collected yet. This competitor will appear here after they're mentioned in an interview."

---

### 2. DigestRefreshButton — `src/app/(app)/competitors/[competitorId]/DigestRefreshButton.tsx`

Client component. Identical pattern to `CompanyDigestRefreshButton` (`src/app/(app)/companies/[companyId]/DigestRefreshButton.tsx`) — just changes the fetch URL to `/api/competitors/${competitorId}/synthesise`.

States: idle → loading → queued (success) → error.
After queuing, show "Regenerating — refresh the page in a moment."

---

### 3. Battle card PATCH route — `src/app/api/competitors/[competitorId]/route.ts`

```ts
// PATCH /api/competitors/[competitorId]
// Updates user-editable battle card fields only.
// Accepts: { your_counter?: string | null, one_proof_point?: string | null }
// Guards: org_id check, only writes battle_card fields — never overwrites AI fields.
```

Read the existing `battle_card` jsonb, merge user fields into it, write back. Return `{ ok: true }`.

Auth pattern: same as company route — `createClient()` (async), fetch org membership, confirm competitor belongs to org.

---

### 4. Competitors list page — `src/app/(app)/competitors/page.tsx`

If a list page already exists, add a link from each competitor row to `/competitors/[competitorId]`.

If no list page exists yet, create a minimal one:
- Table/list of competitors: name, website, last_researched, evidence count (from evidence_entities)
- Each row links to the competitor detail page
- "Add competitor" button if there's already a mechanism for that elsewhere; otherwise omit

---

### 5. Navigation / linking

Link competitor names to their detail pages from anywhere they appear:
- Evidence metadata / entity chips (if any exist)
- Project overview (if competitors are listed there)
- The competitors list page

---

## Type reference

All types are in `src/types/database.ts`.

```ts
export interface CompetitorBattleCard {
  their_pitch: string;
  where_they_win: string;
  their_gap: string;
  your_counter: string | null;
  one_proof_point: string | null;
}

export interface Competitor {
  id: string;
  org_id: string;
  name: string;
  slug: string;
  website: string | null;
  positioning: string | null;
  known_strengths: string | null;
  known_gaps: string | null;
  last_researched: string | null;
  digest: string | null;
  digest_updated_at: string | null;
  battle_card: CompetitorBattleCard | null;
  created_at: string;
  updated_at: string;
}
```

The synthesise route is already built at `src/app/api/competitors/[competitorId]/synthesise/route.ts`.

---

## Files to create / modify

| File | Action |
|---|---|
| `src/app/(app)/competitors/[competitorId]/page.tsx` | Create |
| `src/app/(app)/competitors/[competitorId]/DigestRefreshButton.tsx` | Create |
| `src/app/api/competitors/[competitorId]/route.ts` | Create (PATCH for battle card user fields) |
| `src/app/(app)/competitors/page.tsx` | Create or modify (add links to detail page) |

---

## Visual tone

Match the company detail page (`src/app/(app)/companies/[companyId]/page.tsx`) for structure and spacing. The battle card is the centrepiece — give it visual weight. AI-filled fields should look "generated" (slightly muted background, lock icon or "AI" label). User-editable fields should look like inputs — clear affordance that these are for the user to fill.
