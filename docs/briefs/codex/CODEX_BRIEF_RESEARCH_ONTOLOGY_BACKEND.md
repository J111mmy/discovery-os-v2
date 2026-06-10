# Codex Brief - Research Ontology Backend

> SECURITY GATE APPLIES. Any migration, RLS policy, RPC, service-role use, public route, HTML render path, or auth-sensitive change must be posted for Opus review before commit/apply. Jimmy applies Supabase SQL.

**Status:** Backend specification for Opus review before implementation
**Author:** Codex
**Date:** 2026-06-09
**Depends on:** `docs/briefs/design/DESIGN_BRIEF_RESEARCH_ONTOLOGY.md`
**Frontend pair:** `docs/briefs/design/SONNET_BRIEF_RESEARCH_ONTOLOGY_UX.md`

---

## 0. Goal

Move DiscOS from a compressed model:

```text
Evidence -> themes[] -> themes table -> problems -> artifacts
```

to the clearer research ontology:

```text
Raw material:
Source -> Segment -> Evidence

Analytical layer:
Evidence -> Topics/Codes -> Themes -> Problems

Operational/output layer:
Problems/Evidence/Themes -> Opportunities
Problems/Evidence/Themes -> Actions
Problems/Evidence/Themes -> Artifacts
```

Do this without creating a risky pre-ship migration cliff. The backend work should be phased.

---

## 1. Current Ground Truth

### Existing strengths

- `sources`, `source_segments`, and `evidence` already model raw material.
- `evidence.trust_scope`, `trust_scope_source`, and `evidence_grade_feedback` already model human review/provenance.
- `evidence.themes text[]` gives fast multi-label filtering, but the labels are semantically closer to topics/codes.
- `themes` exists with `label`, `description`, and `evidence_count`.
- `evidence_themes` exists as a join table.
- `problems` exists with `source_theme_ids uuid[]` and `source_evidence_ids uuid[]`.
- `actions` and `product_requests` exist and link to source/evidence.
- `project_opportunities` and its evidence/project join tables exist.
- `artifacts` + `artifact_versions` + citation map exist after #14.
- `agent_runs` exists for AI pipeline logging.

### Current limitations

- `evidence.themes` is misnamed for its actual role.
- Tags are not first-class and are not distinct from analytical labels.
- Topics/codes are not first-class.
- Themes are too thin for interpretive synthesis.
- Problem support is stored as arrays, not typed joins.
- Problem objects do not yet store who/what/why/current-workaround structure.
- Opportunities/actions/artifacts are not consistently linked back to problems/themes.
- AI-suggested analysis does not yet have a full suggested/accepted/edited/rejected lifecycle outside evidence trust.

**[AMENDED - Claude review 2026-06-09]** Three additional limitations are live defects, not just modelling gaps (full trace in `docs/PIPELINE_DEEP_DIVE_2026-06-09.md`):

- **Wrong citation anchors (F1).** `ingest-source.ts` line ~963 anchors every claim in a conversation unit to `unit.segments[0]` - usually the interviewer's question. The computed char offsets are never used to locate claims. Every ingest writes more mis-anchored evidence.
- **Problem clobbering (F6).** `discover-problems.ts` upserts on `(org_id, project_id, title)` with `status: "surfaced"` unconditionally - human-set status is reset and descriptions overwritten on every auto-chained synthesis run; near-duplicate titles accumulate with no merge/retire path.
- **Cross-system theme links (F2).** No UI code reads `evidence_themes`. The workspace chart renders the `themes` table but links into the `evidence.themes text[]` filter - two vocabularies that rarely match, so theme click-throughs show wrong/empty results.

---

## 2. Build Philosophy

### 2.1 Do not big-bang before ship

The system is close to shipping. Do not attempt the full ontology migration as one cut.

Recommended backend sequence:

1. **P0 - Language-compatible backend support:** no schema migration. Support UI copy that calls `evidence.themes` "Topics" in evidence-facing contexts.
2. **P0.5 - Pipeline integrity fixes (ADDED - Claude review 2026-06-09):** fix citation re-anchoring (+ backfill), problem status preservation/dedupe, and the theme-link vocabulary mismatch. Code-only; see section 3b. **Blocking prerequisite for P1** - P1's problem detail surface would otherwise expose wrong segment links and human-state resets to users.
3. **P1 - Problem Intelligence v1:** enrich problem detail using existing schema and joins.
4. **P2 - Evidence lenses:** add efficient read queries for grouping by topic/theme/problem, using current data first.
5. **P3 - Ontology schema v2:** add first-class topic/tag/theme/problem relationships, with dry-run backfill and Opus-reviewed SQL.
6. **P4 - Operational link loop:** formal links from problems/evidence/themes to opportunities/actions/artifacts.

### 2.2 Keep compatibility during migration

Do not drop `evidence.themes` or `evidence_themes` immediately. Treat them as legacy compatibility fields until the new ontology is backfilled and verified.

### 2.3 No silent AI mutation

AI may suggest analytical objects. Human review/provenance must be supported for accepted analytical truth.

---

## 3. P0 - No-Migration Language Support

Purpose: allow Sonnet to fix the mental model before schema changes.

Backend impact:

- None required for pure copy changes.
- If helper names are added, make them semantic aliases only.

Allowed:

- UI reads `evidence.themes` and labels them as `topics`.
- Existing `themes` table remains in code.
- Existing synthesis continues to work.

Do not:

- rename DB fields;
- introduce migration;
- change synthesis semantics;
- remove old fields.

---

## 3b. P0.5 - Pipeline Integrity Fixes (ADDED - Claude review 2026-06-09)

Purpose: repair three live defects before any UI builds on top of them. No ontology migration required. Full code trace in `docs/PIPELINE_DEEP_DIVE_2026-06-09.md`.

**SCOPE GUARD (agreed Codex + Claude, 2026-06-09).** P0.5 is pipeline integrity only. Explicitly out of scope: the topics/tags schema, opportunities/actions/artifacts restructuring, expanded theme/problem columns, and any typed-join refactor beyond what is needed to make *current* traceability honest. If a P0.5 change starts requiring a migration beyond the targeted evidence backfill, stop - it belongs in P3. P0.5 must not become ontology v2 by stealth.

### 3b.1 Citation re-anchoring (F1)

File: `src/lib/inngest/functions/ingest-source.ts` (claim-to-segment assignment, ~line 963).

Current behaviour: `const primarySegmentId = unit.segments[0]?.id;` - all claims in a conversation unit anchor to the unit's first segment (usually the interviewer question).

Fix:

- After extraction, locate each claim's `content` within the unit's segments: exact substring match on `redacted_content` first, then whitespace/punctuation-normalised match, then a fuzzy window match.
- If text match fails, fall back to the first segment whose `speaker` matches `claim.speaker`.
- Last resort: keep `segments[0]` but write `metadata.anchor_method = "fallback_first_segment"` so the UI can soften the link.
- Store `metadata.anchor_method` for every claim (`exact | normalised | fuzzy | speaker | fallback_first_segment`).
- Optionally store claim char offsets within the segment for future highlight rendering.

Backfill: a Jimmy-run script (Node 22+, sourced env, service-role READ + targeted UPDATE of `evidence.segment_id`/`metadata`) that re-runs the same matcher over stored segments. Dry-run by default, idempotent, reports per-method counts. Embeddings, trust scopes, classifications untouched.

**[OPUS CONDITION C1 - 2026-06-10] Reversible re-anchoring.** Before changing `evidence.segment_id` on any row (live extraction or backfill), write `metadata.original_segment_id` and `metadata.anchor_method`. Never overwrite the original anchor without preserving it — a wrong matcher must be auditable and one-command reversible. `anchor_method` is stored on every claim, not only backfilled ones.

**[OPUS CONDITION C2 - 2026-06-10] No P0.5 schema creep.** Claim char offsets, if stored, go in `metadata` jsonb only. No new column on `evidence`, no `evidence_segments` table in P0.5 — both are P3. This is the scope guard in practice: if offset storage starts wanting a column or table, stop and defer to P3.

Acceptance: for a known transcript, every claim's segment link lands on the segment containing the quoted text; backfill dry-run reports >90% exact/normalised matches on existing data; every touched row retains `metadata.original_segment_id` so the backfill is reversible.

### 3b.2 Problem state preservation and dedupe (F6)

File: `src/lib/inngest/functions/discover-problems.ts`.

Current behaviour: upsert on `(org_id, project_id, title)` writes `status: "surfaced"` and a fresh description on every run (synthesis auto-chains after ingests of >= 5 records), resetting human decisions; differently-worded titles create permanent duplicates.

Fix - minimum bar (blocking, must ship in P0.5):

- **Never write `status` on an existing row.** Status is human-owned after first touch.
- **Never overwrite human-edited fields** (description, title) once a human has modified them.
- **Reduce duplicate creation:** at minimum, match candidates against existing problems on normalised title (case/whitespace/punctuation-insensitive) before insert.
- Existing problems whose theme/evidence support disappears get a staleness flag (metadata or column later in P3), never silent deletion.

**[OPUS CONDITION C3 - 2026-06-10] Concrete no-migration mechanism.** There is no dirty-flag on `problems` today (that arrives with `review_state` in P3), so implement "never overwrite human edits" using status as the human-touch signal:

- Write `status` **only on INSERT** (new problem). Never on UPDATE.
- On UPDATE, refresh the description **only while `status` is still `surfaced`**. Once `status` ≠ `surfaced` (a human acknowledged/activated/resolved/dismissed it), the row is **locked** — the agent writes nothing to it.
- **Known accepted limitation:** a description a human edits while leaving `status = surfaced` can still be overwritten on the next run. This is acceptable for the P0.5 minimum bar; proper field-level dirty-tracking is deferred to the P3 problem-discovery rewrite. Do **not** add a column to close this gap in P0.5 (scope guard).

Optional within P0.5 (only if it stays contained and does not delay the blocker - Codex condition, 2026-06-09):

- ~~Match candidate problems to existing problems by embedding similarity of the problem statement (threshold to tune), not exact title.~~ Embedding-similarity dedupe is directionally right but is **not required** for P0.5. If trivial to include, do it; otherwise defer the smarter matching to the P3 problem-discovery rewrite.

Acceptance (minimum): acknowledge a problem, re-run synthesis twice; status remains `acknowledged` and human edits survive. Acceptance (stretch, if embedding dedupe included): no duplicate appears for a reworded equivalent.

### 3b.3 Theme link vocabulary fix (F2)

Files: `workspace-client.tsx` (theme chart hrefs), `evidence/page.tsx` (filter).

Current behaviour: chart items from the `themes` table link to `/evidence?theme=<label>` which filters `evidence.themes text[]` (ingest topic labels) - different vocabulary, wrong/empty results.

Fix (choose one):

- (a) Add a `theme_id` filter path on the evidence page that resolves evidence IDs through `evidence_themes` (org/project scoped, validated UUID, fail-closed); chart links use `?theme_id=`.
- (b) Remove the chart click-through until the P2 Theme lens lands.

Option (a) is preferred - it is also the first real consumer of `evidence_themes`, which currently no UI reads. Keep the existing `?theme=` param working against `evidence.themes` for topic chips (it becomes the Topic filter after P0 renaming).

### 3b.4 Security notes for P0.5

- No new tables, routes, or RLS changes. Not hard-gated, but the backfill script touches `evidence` rows via service role: post the script for Opus light-touch review before Jimmy runs it.
- `theme_id` filter must be validated as a UUID belonging to the project (fail closed to unfiltered default).
- No service role in user-facing reads.

---

## 4. P1 - Problem Intelligence v1 Using Existing Data

Purpose: make problem detail useful without waiting for schema v2.

### 4.1 Data to fetch

For a selected problem, fetch within `org_id` + `project_id`:

- problem row;
- source themes via `source_theme_ids`;
- source evidence via `source_evidence_ids`;
- evidence source/segment details;
- evidence entities;
- people/companies/competitors linked through `evidence_entities`;
- actions/product requests linked to any supporting evidence/source;
- artifacts whose metadata/citation map references supporting evidence where practical;
- project opportunities linked to supporting evidence through `project_opportunity_evidence`.

### 4.2 Server query shape

Prefer server-component Supabase queries for read surfaces. Do not add public API routes unless the UI requires client-side interaction.

If an endpoint is needed, it must:

- authenticate the user;
- resolve project access with `getProjectForUser` or equivalent;
- include explicit `org_id` and `project_id` filters on every table;
- not use service role;
- return only the fields needed by the UI.

**[OPUS CONDITION C5 - 2026-06-10] Light-touch query review.** P1 needs no hard gate, but the problem-detail query is a new multi-join read surface. Before commit, post the query to `OPUS_CODEX_CHANNEL.md` for a second pass confirming: `org_id` + `project_id` scoping on **every** joined table (not just the root `problems` row), no service-role client in the user-facing path, and redacted evidence content preferred over raw. Same light-touch path as the P0.5 backfill script — fast, not blocking-by-default.

### 4.3 Problem detail response shape

Minimum frontend shape:

```ts
type ProblemDetail = {
  problem: {
    id: string;
    title: string;
    description: string | null;
    severity: "high" | "medium" | "low";
    status: "surfaced" | "acknowledged" | "active" | "resolved" | "dismissed";
    created_at: string;
    updated_at?: string;
  };
  themes: Array<{
    id: string;
    label: string;
    description: string | null;
    evidence_count: number;
  }>;
  evidence: Array<{
    id: string;
    content: string;
    summary: string | null;
    trust_scope: string;
    classification: string | null;
    sentiment: string | null;
    topics: string[];
    source_title: string | null;
    source_type: string | null;
    segment_speaker: string | null;
    segment_index: number | null;
    created_at: string;
  }>;
  entities: Array<{
    evidence_id: string;
    entity_type: string;
    label: string;
    relationship: string | null;
  }>;
  actions: Array<{
    id: string;
    description: string;
    status: string;
    evidence_id: string | null;
    source_id: string;
  }>;
  product_requests: Array<{
    id: string;
    description: string;
    status: string;
    evidence_id: string | null;
  }>;
  opportunities: Array<{
    id: string;
    title: string;
    description: string | null;
    status: string;
    confidence: string;
  }>;
  artifacts: Array<{
    id: string;
    title: string;
    type: string;
    verification_status: string | null;
  }>;
};
```

### 4.4 Derived fields

Until schema v2, derive:

- `who_affected`: from evidence entities, speakers, companies, source metadata.
- `current_tools`: from evidence entities of type company/product/tool plus metadata and text heuristics.
- `current_workarounds`: from evidence content/product requests/actions where available.
- `support_count`: count of source evidence IDs.
- `source_mix`: group by source type.
- `freshness`: newest/oldest supporting evidence dates.

These should be presented as "observed signals," not absolute truth.

**[AMENDED - Claude review 2026-06-09]** Same honesty rule for the evidence list itself: until typed `problem_evidence` joins exist (P3), evidence reached through `source_evidence_ids` is an inherited theme union, not assessed support. API/UI labels must say "Related evidence (via themes)", not "Supporting evidence". P0.5 (3b.2) is a prerequisite for this surface; P0.5 (3b.1) is a prerequisite for its segment links.

---

## 5. P2 - Evidence Lenses Queries

Purpose: support Evidence views grouped by review/topic/theme/problem/source.

### 5.1 Review lens

Existing evidence page query is sufficient.

### 5.2 Topic lens

Near-term:

- derive topics from `evidence.themes`;
- group trusted/pending evidence by label;
- return support counts and recent evidence.

Security:

- never interpolate query params into PostgREST array literals;
- use `.contains()` or server-side whitelist validation for filters;
- retain `org_id` + `project_id` filters.

### 5.3 Theme lens

Near-term:

- use `themes`;
- join through `evidence_themes`;
- show evidence counts and representative evidence.

### 5.4 Problem lens

Near-term:

- use `problems.source_evidence_ids`;
- group evidence under problem IDs.

Longer-term:

- switch to typed `problem_evidence`.

---

## 6. P3 - Ontology Schema v2

This is a migration project. Do not implement before Opus reviews the plan.

### 6.1 Proposed enums

```sql
analysis_source: 'ai' | 'human' | 'imported' | 'system'
review_state: 'suggested' | 'accepted' | 'edited' | 'rejected' | 'archived'
theme_status: 'draft' | 'reviewed' | 'accepted' | 'archived'
evidence_relation: 'supporting' | 'contradicting' | 'example' | 'edge_case' | 'provenance'
theme_relation: 'primary' | 'contributing' | 'provenance'
output_relation: 'source' | 'supporting' | 'created_from' | 'cites' | 'addresses'
```

Naming may change after Opus review.

### 6.2 Tags

```sql
tags (
  id uuid primary key,
  org_id uuid not null,
  project_id uuid null,
  label text not null,
  description text null,
  color text null,
  created_by uuid null,
  created_at timestamptz not null,
  unique (org_id, project_id, label)
)

evidence_tags (
  org_id uuid not null,
  project_id uuid not null,
  evidence_id uuid not null,
  tag_id uuid not null,
  created_by uuid null,
  created_at timestamptz not null,
  primary key (evidence_id, tag_id)
)
```

Tags are workflow/organisation labels. They should not feed synthesis unless explicitly selected.

### 6.3 Topics/Codes

```sql
topics (
  id uuid primary key,
  org_id uuid not null,
  project_id uuid not null,
  label text not null,
  description text null,
  parent_topic_id uuid null references topics(id),
  source analysis_source not null default 'ai',
  review_state review_state not null default 'suggested',
  created_by uuid null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (org_id, project_id, label)
)

evidence_topics (
  org_id uuid not null,
  project_id uuid not null,
  evidence_id uuid not null,
  topic_id uuid not null,
  source analysis_source not null default 'ai',
  review_state review_state not null default 'suggested',
  confidence numeric null,
  rationale text null,
  agent_run_id uuid null references agent_runs(id),
  accepted_by uuid null,
  accepted_at timestamptz null,
  created_at timestamptz not null,
  primary key (evidence_id, topic_id)
)
```

Backfill:

- distinct labels from `evidence.themes` become `topics`;
- evidence rows get `evidence_topics`;
- source is `system` or `imported` for backfill;
- review_state should be `accepted` only if current workflow treats these labels as active truth. Otherwise use `suggested` and keep UI wording cautious.

### 6.4 Themes

Evolve existing `themes` rather than creating a parallel table unless Opus prefers a fresh table.

Add columns:

```sql
central_concept text null
interpretation text null
status theme_status not null default 'draft'
source analysis_source not null default 'ai'
review_state review_state not null default 'suggested'
confidence text null check (confidence in ('low','medium','high'))
agent_run_id uuid null references agent_runs(id)
accepted_by uuid null
accepted_at timestamptz null
updated_at timestamptz not null
```

Add joins:

```sql
theme_topics (
  org_id uuid not null,
  project_id uuid not null,
  theme_id uuid not null references themes(id) on delete cascade,
  topic_id uuid not null references topics(id) on delete cascade,
  relationship text not null default 'supporting',
  created_at timestamptz not null,
  primary key (theme_id, topic_id)
)

theme_evidence (
  org_id uuid not null,
  project_id uuid not null,
  theme_id uuid not null references themes(id) on delete cascade,
  evidence_id uuid not null references evidence(id) on delete cascade,
  relationship evidence_relation not null default 'supporting',
  rationale text null,
  created_at timestamptz not null,
  primary key (theme_id, evidence_id, relationship)
)
```

Migration note:

- `evidence_themes` can be retained during compatibility.
- Later, `evidence_themes` can become a view over `theme_evidence` if needed.

### 6.5 Problems

Evolve `problems`.

Add fields:

```sql
statement text null
who_affected text null
what_is_hard text null
why_it_matters text null
current_workarounds text[] not null default '{}'
current_tools text[] not null default '{}'
confidence text null check (confidence in ('low','medium','high'))
freshness text null
source analysis_source not null default 'ai'
review_state review_state not null default 'suggested'
agent_run_id uuid null references agent_runs(id)
accepted_by uuid null
accepted_at timestamptz null
```

Add typed joins:

```sql
problem_themes (
  org_id uuid not null,
  project_id uuid not null,
  problem_id uuid not null references problems(id) on delete cascade,
  theme_id uuid not null references themes(id) on delete cascade,
  relationship theme_relation not null,
  rationale text null,
  created_at timestamptz not null,
  primary key (problem_id, theme_id, relationship)
)

problem_evidence (
  org_id uuid not null,
  project_id uuid not null,
  problem_id uuid not null references problems(id) on delete cascade,
  evidence_id uuid not null references evidence(id) on delete cascade,
  relationship evidence_relation not null default 'supporting',
  rationale text null,
  created_at timestamptz not null,
  primary key (problem_id, evidence_id, relationship)
)

problem_topics (
  org_id uuid not null,
  project_id uuid not null,
  problem_id uuid not null references problems(id) on delete cascade,
  topic_id uuid not null references topics(id) on delete cascade,
  relationship theme_relation not null default 'provenance',
  created_at timestamptz not null,
  primary key (problem_id, topic_id, relationship)
)
```

Compatibility:

- Keep `source_theme_ids` and `source_evidence_ids` until after backfill and UI migration.
- Backfill typed joins from arrays.
- Later deprecate arrays.

### 6.6 Operational links

Add generic link tables or targeted joins. Targeted joins are safer and easier to RLS-review.

Recommended near-term targeted joins:

```sql
problem_opportunities (
  org_id uuid not null,
  project_id uuid not null,
  problem_id uuid not null references problems(id) on delete cascade,
  opportunity_id uuid not null references project_opportunities(id) on delete cascade,
  relationship output_relation not null default 'created_from',
  created_at timestamptz not null,
  primary key (problem_id, opportunity_id, relationship)
)

problem_actions (
  org_id uuid not null,
  project_id uuid not null,
  problem_id uuid not null references problems(id) on delete cascade,
  action_id uuid not null references actions(id) on delete cascade,
  relationship output_relation not null default 'created_from',
  created_at timestamptz not null,
  primary key (problem_id, action_id, relationship)
)

artifact_links (
  org_id uuid not null,
  project_id uuid not null,
  artifact_id uuid not null references artifacts(id) on delete cascade,
  target_type text not null check (target_type in ('evidence','theme','problem','opportunity')),
  target_id uuid not null,
  relationship output_relation not null default 'created_from',
  created_at timestamptz not null,
  primary key (artifact_id, target_type, target_id, relationship)
)
```

Opus should decide whether polymorphic `artifact_links.target_id` is acceptable or whether to use separate typed tables for stronger FK safety.

---

## 7. Backfill Strategy

All backfills must be dry-run first, idempotent, and report counts.

### 7.1 Backfill topics from legacy evidence labels

Inputs:

- `evidence.themes`

Outputs:

- `topics`
- `evidence_topics`

Dry-run report:

- distinct labels found;
- evidence rows with labels;
- duplicate/case-normalised collisions;
- labels longer than threshold;
- rows with empty/null labels.

### 7.2 Backfill theme evidence

Inputs:

- `themes`
- `evidence_themes`

Outputs:

- expanded theme fields where possible;
- `theme_evidence`;
- `theme_topics` if topics can be inferred.

### 7.3 Backfill problem joins

Inputs:

- `problems.source_theme_ids`
- `problems.source_evidence_ids`

Outputs:

- `problem_themes`
- `problem_evidence`
- `problem_topics` provenance from supporting evidence topics.

### 7.4 Backfill operational links

Inputs:

- artifact metadata citation maps and evidence IDs;
- `project_opportunity_evidence`;
- actions/product requests evidence IDs.

Outputs:

- `artifact_links`;
- `problem_opportunities` where evidence overlap is strong enough;
- `problem_actions` where evidence/source overlap is direct.

For fuzzy/uncertain links, report suggestions rather than write automatically.

---

## 8. AI Pipeline Changes

### 8.1 Ingest

Current ingest should continue to create evidence.

Future:

- AI assigns evidence topics/codes, not themes.
- Topic assignment returns rationale/confidence.
- Topic assignment is stored as suggested unless policy says auto-accept for low-risk labels.

### 8.2 Project synthesis

Current `synthesise-project.ts` clusters trusted evidence into `themes`.

**[AMENDED - Claude review 2026-06-09]** Two current behaviours should be recorded as defects, not just "future improvements":

- Evidence is clustered in **independent batches of 30** against a theme list fetched once before the run. Patterns spanning batches fragment into duplicate or partial themes, so theme quality *degrades* as the corpus grows (deep dive F3). The rewrite must operate corpus-wide (map-reduce over topics) and be incremental across runs.
- All `evidence_themes` links for the project are **deleted and recreated** each run, and `confidence` is always written as null. Stable theme identity and real confidence values are prerequisites for the Theme lens (P2) being trustworthy.

Future:

- build or read accepted evidence topics;
- generate themes with central organising concept;
- link themes to supporting topics and evidence;
- keep evidence links direct, not only inherited through labels.

### 8.3 Problem discovery

Current `discover-problems.ts` generates title/description/severity/theme_ids.

**[AMENDED - Claude review 2026-06-09]** Note also that the current function (a) never reads evidence content - its entire input is ~40 theme one-liners - and (b) clobbers human state on re-run (see P0.5, 3b.2; the clobbering fix cannot wait for this future schema). The future version below must additionally receive the actual evidence records per candidate theme cluster, so `supporting_evidence_ids` / `contradicting_evidence_ids` are assessed by the model, not inherited.

Future schema:

```json
{
  "title": "...",
  "statement": "...",
  "who_affected": "...",
  "what_is_hard": "...",
  "why_it_matters": "...",
  "current_workarounds": ["..."],
  "current_tools": ["..."],
  "severity": "high",
  "confidence": "medium",
  "primary_theme_id": "...",
  "contributing_theme_ids": ["..."],
  "supporting_evidence_ids": ["..."],
  "contradicting_evidence_ids": [],
  "topic_provenance_ids": ["..."]
}
```

Rules:

- Do not invent unsupported affected roles/tools.
- Evidence IDs must be from supplied project evidence only.
- Distinguish direct support from provenance.
- Return JSON only.

### 8.4 Artifacts

When composing from a problem/theme/evidence selection:

- store explicit source links in artifact metadata or `artifact_links`;
- citations remain required for claims;
- do not cite a problem as evidence. Cite evidence.

---

## 9. Security Requirements

### 9.1 RLS

Every new table:

- `org_id` not null;
- `project_id` not null for project objects;
- RLS enabled;
- select limited to org members;
- insert/update/delete limited to owner/admin/member where appropriate;
- service role policy only where background jobs require it and only after Opus review.

### 9.2 Query scoping

Every query must include:

```ts
.eq("org_id", orgId)
.eq("project_id", projectId)
```

where `project_id` exists.

Do not trust client-provided `org_id`.

### 9.3 Filter safety

Any user-controlled filter:

- validate against project-owned IDs or labels;
- use typed PostgREST helpers rather than string interpolation;
- fail closed to no filter or 400;
- never bypass org/project filters.

### 9.4 Service role

User-facing routes must use user-scoped clients.

Service role is acceptable only for:

- background Inngest jobs;
- admin-only maintenance;
- approved migrations/backfills.

Never expose service-role-derived data without reapplying org/project constraints.

### 9.5 Prompt injection

All prompts using source/evidence content must:

- wrap untrusted evidence in clear data delimiters;
- instruct the model that source text is data, not instructions;
- avoid tools/function calls unless security-reviewed;
- cap output counts.

### 9.6 PII and curation

Problem/theme views should prefer redacted evidence content where available.

Do not expose raw source content in stakeholder-friendly output surfaces unless the user explicitly opens source context and has access.

### 9.7 HTML/XSS

If generated theme/problem content is rendered as HTML:

- use the existing sanitiser pattern;
- sanitise on store and render;
- no new `dangerouslySetInnerHTML` without Opus approval.

Plain text rendering is preferred for theme/problem fields.

---

## 10. Files Likely in Scope Later

Do not edit these until the specific phase starts.

Backend/data:

- `src/types/database.ts`
- `supabase/migrations/00XX_research_ontology.sql`
- backfill script under `scripts/`
- `src/lib/inngest/functions/ingest-source.ts`
- `src/lib/inngest/functions/synthesise-project.ts`
- `src/lib/inngest/functions/discover-problems.ts`
- `src/lib/llm/prompts/ingest.ts`
- `src/lib/llm/prompts/synthesis.ts`
- `src/lib/llm/prompts/problems.ts`
- query helpers under `src/lib/query/`

Read surfaces:

- `src/app/(app)/projects/[projectId]/evidence/page.tsx`
- `src/app/(app)/projects/[projectId]/problems/page.tsx`
- `src/app/(app)/projects/[projectId]/problems/problems-list.tsx`
- new problem detail component/query if approved.

Operational:

- `src/app/api/compose/draft/route.ts`
- `src/lib/compose/draft.ts`
- `src/app/api/artifacts/save/route.ts`
- `src/app/api/actions/[actionId]/route.ts`
- opportunity/project action handlers.

---

## 11. Recommended First Backend Slice

Build only after Sonnet design and Opus review:

**Problem Intelligence v1, no migration.**

Why:

- highest visible value;
- uses existing data;
- minimal security blast radius;
- avoids schema churn right before ship;
- proves the richer ontology before hardening it in SQL.

Implementation shape:

- server-side problem detail query;
- no service role;
- no new migration;
- no new public API unless interaction requires it;
- strict org/project scoping;
- expose derived fields as "signals" where they are inferred.

Definition of done:

- problem detail answers who/what/why;
- supporting evidence shown;
- source/person/company/tool context visible;
- linked actions/opportunities/artifacts visible where available;
- no raw SQL/provider errors in UI;
- type-check/build pass.

---

## 12. Definition of Done for Full Backend Initiative

- Tags and topics are separate concepts.
- Evidence topics are first-class and multi-label.
- Themes are interpretive, reviewed objects with support.
- Problems have structured who/what/why fields and typed support links.
- Evidence/theme/problem provenance is direct and auditable.
- Opportunities/actions/artifacts can be created from and linked back to evidence/themes/problems.
- Legacy `evidence.themes` and array fields are either compatibility aliases or fully deprecated after verified backfill.
- Opus has reviewed every migration and security-sensitive path.
