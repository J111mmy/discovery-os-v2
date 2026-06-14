# Design Proposal — Clean-Intake Pre-Scan (#41)

**Status:** Design proposal, ready for Opus/Codex review. No build until Codex's backend lands.
**Author:** Sonnet
**Date:** 2026-06-14
**Responds to:** Opus's #41 brief (cross-session message, 2026-06-14): pre-scan on "Add source" to fix #39 (junk people), #40 (company mess), #36 (affiliation), #1 (duplicates).
**Builds on:** `src/app/(app)/projects/[projectId]/ingest/ingest-form.tsx` (current "Add source" flow), `people`/`companies`/`affiliation` model (`src/app/api/people/[personId]/affiliation/route.ts`), entity extraction (`src/lib/inngest/functions/extract-entities.ts`).

---

## 0. Summary and staging

**The root cause:** `extract-entities.ts` runs *after* full ingest, with no human in the loop. It
matches people/companies by exact normalized-name string (`normalizeName`), and **auto-creates** a
new row on any miss. A transcript that says "SPEAKER_2" instead of "Jimmy" creates a junk person.
"Acme Corp" vs "Acme" creates two companies. A Veyor colleague on a call gets the org's default
`affiliation` (internal), even on a project where they were acting as the customer's consultant.
None of this is visible or correctable until someone notices it on the People/Companies pages,
long after the fact.

**The fix:** insert a lightweight **pre-scan** step between "user submits source text" and "full
ingest job runs." The pre-scan extracts just the speaker list and any organizations it can detect,
proposes names/roles/org links (with match candidates against existing people/companies), and lets
the user confirm or correct *before* the expensive full extraction runs. The user's confirmed
resolutions are then passed into the full ingest job so `extract-entities.ts` uses them instead of
its own blind auto-create.

| Stage | Scope | Why this order |
|---|---|---|
| **P1** | Pre-scan + review step in the "Add source" flow. New `/ingest/prescan` endpoint (Codex). Review UI: per-speaker cards with editable name, role classification (customer/internal/interviewer), suggested org + classification. Reconciliation against existing people only (org-level match, using the existing `people`/`companies` tables as-is). States: scanning, review, empty, error. | This alone kills most new junk people and gives every new source a human-reviewed speaker list. No schema change beyond what's needed to pass resolutions into ingest — ships fastest. |
| **P2** | Project-scoped affiliation/role overrides. Requires a new join table (e.g. `project_people`) so a person's role can differ per project without changing their org-wide `affiliation`. Review-step UI already designed for this in P1 (the role picker), but it writes to the new table instead of being a no-op/org-wide write. | This is the piece that needs a schema change Opus flagged as a dependency — sequencing it after P1 means P1 ships value immediately while the schema change is reviewed. |
| **P3** | Org classification (real organization vs. tool/product) on `companies`, surfaced in the review step's org cards and used to suppress tool/product names (Procore, SharePoint, Slack...) from being offered as "this speaker's org." Requires a new `companies.kind` column. | Smaller, but still a schema change — bundle with P2's migration if convenient. Until this lands, the review step simply won't pre-filter tool names; the user can still mark a suggested org as "not an organization" inline (see §2.3), which is a P1-safe manual override that doesn't need the column (stored as a per-resolution flag sent to ingest, not persisted on the company). |

All three stages share one UI surface (the review step) and one endpoint contract (§5). P2/P3 only
change what data is available to populate suggestions and where confirmations are persisted — the
cards and interactions don't change shape.

---

## 1. Where this sits in "Add source"

Today (`ingest-form.tsx`): user fills `title` + `type`, provides text (file upload + extraction, or
pasted text), clicks submit → `POST /api/ingest` → poll `/api/ingest/status` → done.

**New flow:**

```
title + type + text  →  [Scan]  →  pre-scan (new, lightweight)  →  review step  →  [Confirm and ingest]  →  full ingest job (existing, unchanged shape + resolutions payload)  →  poll status  →  done
```

- The first screen (title/type/text entry) is **unchanged**. The submit button's label changes
  from "Add source" to **"Scan source"** — it now triggers the pre-scan, not the full ingest.
- The pre-scan is synchronous from the user's perspective (target: a few seconds, since it's a
  single lightweight LLM pass over the raw text, not full segmentation + embedding + evidence
  extraction). No job-queue polling needed for this step — see §4 for the scanning state.
- After the user confirms the review step, **then** `POST /api/ingest` fires with the existing
  payload (`project_id`, `title`, `type`, `raw_text`) plus a new `entity_resolutions` array (§5.2).
  Polling for ingest status is unchanged.
- **Escape hatch:** if pre-scan fails or the user doesn't want to deal with it, a "Skip review and
  ingest as-is" link is always available (see §4.4). This keeps the new step from ever being a hard
  blocker on adding a source — `extract-entities.ts`'s existing auto-create behavior remains the
  fallback when `entity_resolutions` is empty/absent, so nothing breaks if pre-scan is skipped.

This step lives inside `ingest-form.tsx` as a second "phase" of the same form (not a new route) —
consistent with how the file-upload → text-extraction step already works as an in-form phase.

---

## 2. Review step UI

The review step replaces the form's submit area once pre-scan returns. It has two sections:
**Speakers** (people detected from the transcript) and **Organizations mentioned** (orgs detected
that aren't tied to a specific speaker — e.g. a tool name mentioned in passing). Most sources will
only populate Speakers.

### 2.1 Layout

```
Review before ingest
"We found 4 speakers in this source. Confirm who they are so evidence gets
attributed correctly."

┌─ Speaker card ──────────────────────────────────────────────┐
│ Detected as: "SPEAKER_1"                                     │
│ Name:  [ Jimmy Keogh                              ]          │
│                                                               │
│ ✓ Looks like existing person "Jimmy Keogh" (Veyor Digital)   │
│   [ Use this match ]   [ This is someone new ]               │
│                                                               │
│ Role on this project:  ( Customer ) ( Internal ) (Interviewer)│
│ Organization:  [ Veyor Digital                    ]          │
└───────────────────────────────────────────────────────────┘

┌─ Speaker card ──────────────────────────────────────────────┐
│ Detected as: "Maria"                                         │
│ Name:  [ Maria                                    ]          │
│                                                               │
│ No existing match found — this will be created as a new      │
│ person.                                                       │
│                                                               │
│ Role on this project:  ( Customer ) ( Internal ) (Interviewer)│
│ Organization:  [ Acme Corp                        ]          │
│   ⚠ Looks like existing organization "Acme Corporation"       │
│   [ Use this org ]   [ This is a different org ]             │
└───────────────────────────────────────────────────────────┘

[ Confirm and ingest ]    [ Skip review and ingest as-is ]
```

### 2.2 Per-speaker card fields

- **Detected as** (read-only, small/faint text) — the raw label the transcript used (e.g.
  `SPEAKER_1`, a diarization tag, or a first-name-only mention). This is shown so the user can tell
  *why* a card exists even when the suggested name is wrong.
- **Name** (editable text input) — pre-filled with `suggested_name` if the pre-scan resolved one,
  otherwise pre-filled with `raw_label`. Always editable; this is the name that will be written to
  `people.name` on create, or used to confirm a match.
- **Match suggestion** (only rendered if `person_match_candidates` is non-empty) — shows the
  top candidate: *"Looks like existing person '{name}' ({company name or 'no org'})"*. Two buttons:
  - **Use this match** — links this speaker to the existing `person_id`. No new person created.
  - **This is someone new** — dismisses the suggestion; a new person will be created with the
    Name field's value. If there are multiple candidates (rare), show a small "Not them? See other
    matches" expander listing the rest with the same two-button pattern per candidate.
  - If no candidates, this section is replaced with the plain statement *"No existing match found —
    this will be created as a new person."* (sets expectations, avoids surprise duplicates showing
    up later).
- **Role on this project** — a 3-way segmented control: **Customer / Internal / Interviewer**.
  - Pre-selected based on `suggested_role` if present, else defaults to **Customer** for sources of
    type `customer_interview`/`sales_call`/`usability_study`, and **Internal** for
    `internal_meeting`. Other source types start with nothing pre-selected and require a choice
    (this is the "classification" Opus asked for — it forces the call rather than silently
    defaulting).
  - In P1, this selection feeds `entity_resolutions[].project_role` and is stored against the
    project-source link (see §5.2) without changing the person's org-wide `affiliation` — i.e. it's
    informational/attribution metadata for this ingest only. In P2, it additionally writes to the
    new project-scoped table so it persists as "this person's role on this project" beyond this one
    source (see §6.1).
- **Organization** (editable text input) — pre-filled with `suggested_org_name` if detected,
  otherwise blank ("not detected — leave blank if unknown"). If a matched person already has a
  `company_id`, this is pre-filled from that. Editing it is just an edit — no "disconnect from
  source" semantics needed, since nothing has been persisted yet at this stage.
- **Org match suggestion** (only if `org_match_candidates` non-empty and the typed/suggested name
  doesn't exactly match an existing company) — same pattern as person matches: *"Looks like existing
  organization '{name}'"* with **Use this org** / **This is a different org** buttons.
- **"Not an organization" override** (P1-safe stand-in for P3's `companies.kind`) — a small text
  link under the Organization field: *"This isn't a company (e.g. a tool or product name)"*. If
  clicked, the Organization field clears and is marked `is_tool_or_product: true` in the resolution
  payload, so `extract-entities.ts` skips company creation for that value entirely. This directly
  addresses #40 without waiting on the `companies.kind` schema change — it's a per-resolution flag,
  not a persisted classification, so it has to be re-confirmed each time that name shows up in a new
  source until P3 lands. That tradeoff is acceptable for P1: better to ask once per source than to
  keep creating "Procore" as a company.

### 2.3 Organizations mentioned (no speaker)

A second, collapsed-by-default section: *"We also noticed these organizations mentioned — review if
relevant"* with a simple list, each row having the same Organization-field treatment as above
(match suggestion, "not an organization" override). This section is **collapsed by default** and
shows a count badge, since most users won't need to touch it — it's there so a company mentioned
only in passing doesn't silently get created either. If `detected_orgs` is empty, the section
doesn't render at all.

### 2.4 Visual language

Reuse existing tokens and patterns rather than inventing new ones:
- Cards: same `rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5` treatment as
  opportunity/problem cards.
- Match-found banner: `border-pos/25 bg-pos-bg text-pos` (green, "good news — we found a match").
- Match-suggestion-for-org-with-low-confidence or "no match" statement: plain
  `text-[var(--ink-2)]`, no colored banner — absence of a match isn't a warning, just information.
- Role segmented control: same shape as the `AffiliationToggle` buttons
  (`affiliation-toggle.tsx`) — a row of pill buttons, active state highlighted, inactive state
  `border-[var(--line)] bg-[var(--bg)] text-[var(--ink-2)]`.
- "Not an organization" / "this is a different org" actions: text-link style
  (`text-xs text-[var(--ink-faint)] hover:text-[var(--ink)] underline`), not buttons — these are
  secondary/escape actions, not primary choices.

---

## 3. Reconciliation / merge matching

Per Opus's brief: *"surface likely matches ('looks like existing 'Jimmy Keogh'') so the user merges
instead of creating duplicates."*

- Matching happens **server-side** during pre-scan (Codex's endpoint, §5.1) — the client never does
  fuzzy matching itself, it just renders `person_match_candidates`/`org_match_candidates` as given.
- The matching itself doesn't need to be sophisticated for P1: a fuzzy/trigram match on
  `people.name` (and `companies.name`/`domain`) within the org, returning the top 1-3 candidates
  above some similarity threshold, is enough to catch the "Jimmy Keogh" vs "jimmy" vs "J. Keogh"
  cases that `normalizeName`'s exact-match currently misses. I'm not specifying the matching
  algorithm here — that's Codex's call — only the response shape (score 0-1, used purely to decide
  whether to show the suggestion at all, e.g. only show if score > 0.5; the UI doesn't display the
  raw score number, just the suggestion).
- **No merge of existing records happens here.** "Use this match" only affects *this ingest's*
  attribution (links the new evidence/segments to the existing `person_id`/`company_id` instead of
  creating new ones). If two *already-created* duplicate people need merging, that's a separate,
  out-of-scope feature (a People-page merge tool) — pre-scan prevents *new* duplicates, it doesn't
  clean up old ones. Worth flagging to Opus as a possible #41.1 follow-up but explicitly **not**
  part of this design.

---

## 4. States

### 4.1 Scanning
Replaces the submit button area with a small inline status, consistent with the existing
ingest-status copy style:

> Scanning source for speakers and organizations...

A subtle spinner, no progress bar (pre-scan is a single fast LLM call, not a multi-step job — if
Codex's implementation ends up needing the job-queue/polling pattern after all because of large
transcripts, this state can swap to the same polling UI `ingest-form.tsx` already has for full
ingest, with copy adjusted; the visual slot is the same either way).

### 4.2 Review
The per-speaker/org card list (§2). Primary action **Confirm and ingest**, secondary **Skip review
and ingest as-is**.

### 4.3 Empty
Pre-scan ran successfully but found no speakers and no orgs — e.g. a policy document or spec sheet
with no dialogue. Show a single line, no cards:

> This looks like a document rather than a conversation — no speakers to review.
> [ Continue to ingest ]

Single primary button, same visual weight as "Confirm and ingest" would have. Don't make the user
hunt for how to proceed when there's nothing to review.

### 4.4 Error
Pre-scan failed (timeout, LLM error, etc.). Don't block the user from adding the source — this is a
quality-of-life feature, not a gate:

> We couldn't scan this source for speakers right now. You can still add it — entity matching will
> happen automatically during ingest as before.
> [ Skip review and ingest as-is ]   [ Try scanning again ]

This is the same "Skip review and ingest as-is" action available from the review step (§2.1),
reused here as the primary recovery path. "Try scanning again" re-calls the pre-scan endpoint with
the same payload.

---

## 5. Backend contract for Codex

### 5.1 Pre-scan endpoint

```
POST /api/projects/{projectId}/ingest/prescan
Body: { type: SourceType, raw_text: string }

Response 200:
{
  "speakers": [
    {
      "id": "speaker-1",                 // stable client-side key for this pre-scan response
      "raw_label": "SPEAKER_1",          // the label as it appears in the transcript
      "suggested_name": "Jimmy Keogh" | null,
      "suggested_role": "customer" | "internal" | "interviewer" | null,
      "suggested_org_name": "Veyor Digital" | null,
      "person_match_candidates": [
        { "person_id": "uuid", "name": "Jimmy Keogh", "company_name": "Veyor Digital" | null, "score": 0.92 }
      ],
      "org_match_candidates": [
        { "company_id": "uuid", "name": "Acme Corporation", "domain": "acme.com" | null, "score": 0.81 }
      ]
    }
  ],
  "detected_orgs": [
    {
      "id": "org-1",
      "name": "Procore",
      "org_match_candidates": [ ... same shape as above ... ]
    }
  ]
}

Response 200 (empty source): { "speakers": [], "detected_orgs": [] }
Response 4xx/5xx: { "error": string }  // UI falls back to §4.4
```

Notes for Codex:
- `person_match_candidates` / `org_match_candidates` should be empty arrays (not omitted) when
  there's nothing above the match threshold — keeps the client logic simple (`.length > 0` checks).
- This should be scoped to `org_id` (via `projectId` → project → org, same as every other route) —
  matches must only be searched within the calling org's `people`/`companies`, never cross-org.
- I'd suggest this *not* be a queued Inngest job for P1 — a single LLM call over raw text (similar
  cost/shape to the existing per-source extraction prompt in `src/lib/llm/prompts/ingest.ts`, but
  scoped to "list speakers and any organization names" rather than full evidence extraction) should
  be fast enough to do synchronously. If transcripts are large enough that this times out, that's
  the trigger to revisit and make it a job — the UI's "Scanning..." state (§4.1) is written so it
  doesn't care which.

### 5.2 Ingest endpoint — new optional field

```
POST /api/ingest
Body: {
  project_id, title, type, raw_text,   // unchanged
  "entity_resolutions": [               // new, optional — absent/empty = today's auto-create behavior
    {
      "raw_label": "SPEAKER_1",
      "resolved_name": "Jimmy Keogh",
      "person_id": "uuid" | null,        // set if "Use this match" was chosen; null = create new
      "project_role": "customer" | "internal" | "interviewer" | null,
      "org_name": "Veyor Digital" | null,
      "company_id": "uuid" | null,       // set if an org match was confirmed; null = create new (unless is_tool_or_product)
      "is_tool_or_product": false
    }
  ]
}
```

Notes for Codex:
- `extract-entities.ts` should consult `entity_resolutions` (matched by `raw_label` against
  `source_segments.speaker`/`metadata.speaker`) **before** falling back to its current
  normalize-and-match-or-create logic. If a resolution exists for a given speaker label, use its
  `person_id`/`company_id` directly (creating the person/company first if `*_id` is null but
  `resolved_name`/`org_name` is set) and **skip** `is_tool_or_product` org names entirely (no company
  row created for those).
- `project_role` in P1: I'd suggest writing it to `evidence.metadata` or wherever per-evidence
  speaker attribution already lives, scoped to this ingest — whatever's cheapest given the existing
  shape, since P1 doesn't need it to outlive this source. P2 promotes it to the new
  `project_people`-style table (see §6.1) as the durable per-project role.
- If `entity_resolutions` is absent or empty, behavior is **unchanged** from today — this keeps the
  "Skip review and ingest as-is" / error-state paths (§4.4) working with zero backend risk.

---

## 6. Schema changes flagged for Codex (not required for P1)

### 6.1 P2 — project-scoped person role/affiliation
Today `people.affiliation` is org-wide (`internal | external | unknown`). Opus's brief requires a
person to be, e.g., "internal" org-wide but classified as acting-for-the-customer on one specific
project. This needs a new table, roughly:

```
project_people (
  org_id, project_id, person_id,
  role: 'customer' | 'internal' | 'interviewer',
  created_at, updated_at
)
```

The review step's role picker (§2.2) is designed to write here once it exists — P1 can ship the same
UI writing the role into per-ingest metadata (§5.2) as an interim, then P2 is purely a backend change
(new table + read path for whatever surface displays "this person's role on this project" — likely
the person detail page within a project context) with **no UI change** beyond pointing the existing
control at the new write.

### 6.2 P3 — org classification (real org vs. tool/product)
```
companies: add column `kind: 'organization' | 'tool'` (default 'organization')
```
Used to (a) pre-filter `suggested_org_name`/`org_match_candidates` so tools like "Procore" or
"SharePoint" aren't offered as a speaker's employer, and (b) persist the "not an organization"
override from §2.2 so it doesn't need re-confirming on every future source. P1's per-resolution
`is_tool_or_product` flag (§5.2) is the stopgap; P3 just makes Codex's matching smarter and makes the
override sticky. No UI change needed beyond removing the now-redundant per-source override once
`kind` data exists for a given name (i.e., the override link can hide itself if
`org_match_candidates` already returns a `kind: 'tool'` company).

---

## 7. Out of scope

- **Merging existing duplicate people/companies** (§3) — pre-scan prevents new duplicates, doesn't
  clean up old ones. Flagging as a possible follow-up, not part of this design.
- **Re-running pre-scan on already-ingested sources.** This only applies to the "Add source" flow
  going forward.
- **Editing `companies.kind` or org-wide `affiliation` from the review step.** The review step only
  ever writes per-ingest/per-project data (P1/P2) or creates new records — it never edits an existing
  person's or company's org-wide fields. Org-wide edits stay on the People/Companies pages.

---

## 8. Definition of done (P1)

- "Add source" flow gains a pre-scan step between text entry and full ingest, gated behind
  `POST /ingest/prescan` (Codex).
- Review step renders speaker cards (§2.2) and an optional "organizations mentioned" section (§2.3),
  using only existing tokens/components per §2.4.
- All four states (§4) implemented; "skip review" always available and never blocks adding a source.
- Confirmed resolutions sent to `/api/ingest` via `entity_resolutions` (§5.2); empty/absent case is
  fully backward compatible with today's behavior.
- tsc + build green, no em-dashes, honest copy in empty/error states.
