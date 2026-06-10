# DiscOS Pipeline Deep Dive — Current State & Required Changes

**Date:** 2026-06-09 · **Author:** Claude (analysis only, no code changed)
**Scope:** Full trace of the live code path from project setup → ingest → segmentation → evidence → themes → problems → UI, followed by the exact change list required for a best-in-class foundation.

Every claim below is grounded in a specific file and line range in this repo. Nothing is inferred from the PRD alone.

---

# PASS 1 — How the system actually works today

## Step 0. Project setup and the Frame

**Code:** `projects/new/new-project-form.tsx`, `settings/settings-forms.tsx`, `draft-frame.ts`, migrations 0006, 0015, 0019.

What happens: creating a project collects **name and description only**. No framing question is asked. The frame can later be set three ways: typed free-text in settings, generated on demand, or AI-drafted after the first ingest (`draft-frame` fires only when `projects.frame` is empty).

What this means in practice: **the first ingest of every project runs frame-blind.** The extraction agent's most important context input doesn't exist when the most important source (usually the first interview) is processed. The frame draft is then generated *from* that untargeted extraction.

There are also **four overlapping context objects**: `projects.frame` (text), `projects.frame_data` (jsonb, backfilled from frame when parseable — migration 0006), `projects.research_context` (jsonb, added in 0019, used by evidence grading), and `projects.frame_draft` (0015). Ingest uses `frame_data ?? frame`; grading uses `research_context`; problem discovery uses raw `frame` text. Three agents read three different notions of "what this project is about."

**Verdict:** the lightweight-frame philosophy (CLAUDE.md §10) is right, but the implementation is fragmented and the sequencing (frame after first ingest, silently) undermines extraction quality exactly when it matters most.

## Step 1. Source intake

**Code:** `api/ingest/*`, `ingest-source.ts` lines 766–900.

Route handler fires `source/ingest.requested`; Inngest does the work. Job tracking, retries (3), org-level concurrency limit of 1, failure states written to `ingest_jobs`. Raw text is read from `sources.metadata.raw_text`, with a guard against re-ingesting processed markers.

**Verdict:** this layer is solid. Correct architecture (event-driven, durable, resumable), correct error handling.

## Step 2. Segmentation (deterministic)

**Code:** `ingest-source.ts` lines 200–521.

Regex parses speaker turns across several transcript formats (speaker-colon, timestamp-speaker, speaker-timestamp, initials-block). Turns over ~800 tokens split at sentence boundaries. The interviewer is inferred as **the speaker with the most question marks**; a conversation unit = one interviewer question plus all responses until the next question. Non-transcripts split at paragraph boundaries. Char offsets (`char_start`/`char_end`) and timestamps are carried on every segment. PII redaction (`redactPII`) runs before storage; `raw_content` is kept locally, `redacted_content` is what goes to LLMs.

This matches the PRD's deterministic/AI boundary almost exactly. Weaknesses are real but secondary:

- The single-interviewer heuristic breaks on multi-facilitator calls and panel formats; the question-mark heuristic breaks on transcripts where the customer asks lots of questions (common in sales calls).
- `end_time` of a turn is set to the *next* turn's start time only on flush — last turn always has `end_time: null`.
- No handling of diarization noise (e.g. "Speaker 1"/"Speaker 2" labels are treated as real names and become global people records — see Step 3).

**Verdict:** correct design, ~90% correct implementation.

## Step 3. Speaker sync → global people

**Code:** `ingest-source.ts` lines 459–659.

Every speaker label becomes (or matches) a row in the org-global `people` table, **matched by normalized name only**. Internal speakers are inferred (facilitator = most questions) or pre-flagged via `affiliation`. People are linked to the project via `person_projects`.

Problems found:

1. **Name-collision merging.** Two different "John Smith"s in two companies become one person. The PRD's canonical-entity vision needs disambiguation (company context, email, fuzzy review queue) — none exists.
2. **Transcription artifacts become people.** "Speaker 1", "Interviewer", "PM" all pass `isSpeakerNameLine` and become permanent global people records with status `interviewed`.
3. **Taxonomy drift:** `person_projects.status` is written as `"facilitator"` — a value that does not exist in the controlled person-status taxonomy (§18).
4. Every external speaker is immediately `interviewed`, even from an internal meeting transcript where they were merely mentioned in a label.

## Step 4. AI evidence extraction

**Code:** `ingest-source.ts` lines 913–1000, `prompts/ingest.ts` (v5).

Per conversation unit, Claude (standard tier, via the abstraction layer — correctly no hardcoded models) receives: frame, **org-wide** existing theme labels, known problems, other active projects, internal-speaker list, and the redacted unit. It returns claims with classification, sentiment, speaker, theme labels, and adjacent-project hints. Claims are validated (zod), filtered (≥5 words unless data_point), capped at 200/source, embedded in batches, stored as evidence with `trust_scope: 'pending'`.

This is the AI extraction pass the PRD demanded, and much of it is genuinely good: prompt-injection fencing on source content, internal-speaker exclusion, adjacency detection, prompt versioning stamped in metadata.

**But there is one critical defect:**

### Finding F1 — The citation anchor is wrong (highest-severity finding in this audit)

Line 963: `const primarySegmentId = unit.segments[0]?.id;` — **every claim extracted from a conversation unit is anchored to the unit's first segment, which is usually the interviewer's question, not the segment where the customer actually said the thing.** The carefully-computed char offsets are never used to locate the claim. A unit with a 3-minute customer answer across 4 segments produces 6 evidence records that all cite the question.

"Traceability is the product" (CLAUDE.md §1). Right now the product's atomic promise — *this claim links to the exact place it was said* — is broken at the moment of creation. The evidence browser's segment link (`sources/{id}#segment-{segment_id}`) faithfully takes the user to the wrong segment.

Secondary extraction issues:

- `themes` returned by the agent are free-text strings stored in `evidence.themes text[]`. They are suggested against org theme labels but **never reconciled, normalized, or linked** to the `themes` table. (This becomes F2 below.)
- `speaker` lives in `metadata.speaker` as free text. Evidence is never linked to the `people` rows created in Step 3 — no `evidence_entities` rows at ingest, so "show me everything operations directors said" is impossible despite both halves of the data existing.
- No AI rationale is stored per claim (why this classification, why this theme) — relevant later for grading and for defending claims.

## Step 5. Trust review, grading, downstream fan-out

**Code:** end of `ingest-source.ts`, `grade-evidence.ts`, `session-review.ts`, `extract-actions.ts`, `extract-entities.ts`.

Evidence lands `pending`; a human trusts/excludes (or trust-all). Grading, session review, action extraction, and entity extraction fire as events. Synthesis auto-fires at ≥5 new records. Frame draft fires if no frame. This chaining matches §15's operating rhythm and is architecturally right.

One systemic consequence to be aware of: **everything downstream sees only `trusted` evidence**, so the product is inert until a human completes trust review. That's by design, but the UI doesn't make this gate obvious — a new user ingests a transcript, sees evidence, and then sees zero themes/problems with no explanation of why (the "Trust evidence and run synthesis" hint only appears on the workspace card).

## Step 6. Synthesis → "themes"

**Code:** `synthesise-project.ts`, `prompts/synthesis.ts` (v1).

Trusted evidence is fetched, **chunked into batches of 30**, and each batch is independently sent to the premium tier with the instruction "Group the evidence records below into useful research themes… label: 3-5 words." Results are upserted into `themes` on `(project_id, label)` and links written to `evidence_themes`. Before writing, **all existing `evidence_themes` links for the project are deleted**.

### Finding F2 — Two disconnected theme systems

The system has two things called themes that never meet:

| | `evidence.themes text[]` | `themes` table + `evidence_themes` |
|---|---|---|
| Created by | ingest agent, per claim | synthesis agent, per project |
| Vocabulary | free text, unbounded | 3–5 word labels, upserted |
| Read by | **the UI** (evidence filter) | discover-problems only |

`grep` confirms: **no UI component reads `evidence_themes` at all.** The workspace theme chart is drawn from the `themes` table, but clicking a bar links to `/evidence?theme=<label>` which filters `evidence.themes text[]` — a different vocabulary. When the synthesis label doesn't exactly match an ingest label (the normal case), **the click shows wrong or empty results**. This is the precise mechanical cause of "links go to the wrong places."

### Finding F3 — Batch fragmentation destroys cross-corpus patterns

Each 30-record batch is clustered in isolation, against the theme list as it existed *before the run*. A pattern with 4 records in batch 1 and 3 in batch 2 becomes either two differently-worded themes or one theme missing half its evidence. Theme quality degrades **as the evidence base grows** — the opposite of compounding intelligence.

### Finding F4 — These are topics, not themes

The prompt asks for 3–5-word grouping labels. Per the deep-research report you reviewed (and Braun & Clarke), that's descriptive topic assignment, not interpretive synthesis. There's no central organizing concept, no tension detection, no confidence (the `confidence` column on `evidence_themes` is **always written as null**), no contradiction flags. The PRD's promised synthesis outputs (§ "Synthesis — when and why": clusters with confidence, tension flags, gap signals, opportunity candidates) are mostly not produced.

Also noted: themes are fetched org-wide for context (intended — org taxonomy) but the delete-and-recreate of links plus label-based upsert means label drift creates duplicate themes ("Pricing confusion" / "Confusion around pricing") with no merge mechanism, ever.

## Step 7. Problem discovery

**Code:** `discover-problems.ts`, `prompts/problems.ts` (v1).

Fetches the top 40 themes **as label + one-line description + count only** and the frame text. The LLM writes 3–7 problems with `theme_ids`. Evidence linkage is then computed mechanically: *union of all evidence linked to the supporting themes*. Upsert on `(org_id, project_id, title)`.

### Finding F5 — Problems are a summary of a summary, with fabricated provenance

The problem agent **never reads a single piece of evidence**. Its entire input is ~40 sentences. The `source_evidence_ids` array (what the UI shows as "12 evidence records") is not "evidence supporting this problem" — it's "everything vaguely nearby." No claim in a problem description is verifiable against its linked evidence, because no link was ever assessed. This is inheritance-as-meaning, the exact anti-pattern the research report warns about.

### Finding F6 — Synthesis runs clobber human decisions

The upsert sets `status: "surfaced"` unconditionally. If you acknowledged or activated a problem and the next synthesis run regenerates the same title, **your status is reset to surfaced and the description overwritten**. If the LLM words the title slightly differently (the normal case), you instead get a **duplicate problem**, and the old one lingers forever — there is no merge, retire, or staleness mechanism. Both failure modes compound on every ingest of ≥5 records, because synthesis → problems auto-chains. This is very likely why your problems area feels chaotic.

### Finding F7 — Schema violations

`problems.source_theme_ids uuid[]` and `source_evidence_ids uuid[]` violate the repo's own rule (§7: no uuid[] relationship columns; the migration comment even admits it). Consequence: no per-link metadata (supporting vs contradicting, verified vs inherited, primary vs secondary theme), no FK integrity (deleted evidence leaves dangling IDs in arrays), no efficient reverse query ("which problems cite this evidence?").

## Step 8. The UI layer

**Code:** `workspace-client.tsx`, `PipelineRail.tsx`, `problems/*`, `evidence/*`, `project-sidebar.tsx`.

The three-layer intent (UI renders state, does no intelligence) is respected — no LLM calls in components. But the rendering layer is where all upstream confusion becomes visible:

- **No problem detail page exists.** A problem card shows "3 themes · 12 evidence records" as **dead text** — not links, nothing to click, no way to see the evidence behind a problem. The pipeline rail promises Sources → Claims → Problems and the last stage is a dead end.
- **Wrong-destination links, confirmed at** `workspace-client.tsx` lines 1068–1081: the "Research gaps" teaser links to `/sources`; the "Opportunities" teaser links to `/evidence`. Neither a gaps page nor an opportunities page exists, so the cards lie about where they go.
- **Theme click-through is broken** (F2 above): chart drawn from one theme system, filter applied to the other.
- Evidence browser caps at 50 records with no pagination; no grouping by topic/theme/problem/person/company; the theme filter is exact-string match.
- The frame card behavior (prominent early, collapsing later — §10) is not implemented; the frame lives in settings only.
- Persona-adaptive UI (§8) does not exist yet (acceptable — later phase).

## What is genuinely good (don't touch)

Worth saying plainly: the platform layer under all this is strong. Event-driven Inngest chaining with durable steps; the LLM abstraction with tiers and no hardcoded models; PII redaction before every external call; org_id discipline and RLS posture; prompt versioning stamped into records; agent_runs logging; prompt-injection fencing of source content; trust review as a first-class gate. **The foundation you want to trust customers on is mostly the part that already exists.** What's broken is the *meaning layer* built on top of it — and the UI that exposes it.

---

# PASS 2 — Exactly what needs to change

Ordered by dependency, not by ease. Items 1–4 are the foundation; 5–7 are the product payoff; 8+ is hardening. Migrations are gated per §0 (Opus reviews, Jimmy runs SQL).

## 1. Fix citation anchoring at extraction (do this first — it's data corruption, ongoing)

Every ingest that runs today writes more mis-anchored evidence. Change the extraction step so each claim is mapped to the segment it actually came from:

- Have the agent return the verbatim span (it already returns near-verbatim `content`) and locate it deterministically: search each segment's `redacted_content` within the unit for the best match (exact, then normalized, then fuzzy); fall back to the speaker-matched segment; only then fall back to the first segment, and **flag the fallback in metadata**.
- Store `char_start`/`char_end` of the claim within the segment on the evidence record (or an `evidence_segments` link table if a claim spans segments).
- Backfill: re-anchor existing evidence by running the same matcher over stored segments. No re-ingest needed; embeddings, classifications, trust states are preserved.

Acceptance test: click any evidence record → lands on the segment where the customer said it, with the quote highlightable via offsets.

## 2. One ontology, one migration (fold into the already-planned schema reconciliation)

Adopt the layered model — `Source → Segment → Evidence → Topic → Theme → Problem → {Opportunity, Action, Artifact}` — in the same migration that CLAUDE.md already lists as priority #1:

- **Topics:** new `topics` table (org-scoped, label + status `active|merged|deprecated` + merged_into) and `evidence_topics` join. Migrate `evidence.themes text[]` into it (keep the column temporarily for compatibility, stop writing to it). Add `kind: 'topic' | 'tag'` so operational tags (`follow-up`, `demo-candidate`) can exist without ever feeding synthesis.
- **Themes:** keep the `themes` table but add `status (active|merged|archived)`, `confidence`, `central_concept text` (the one-sentence organizing idea), `merged_into`. Stop delete-and-recreate of links; make synthesis incremental (see #3).
- **Problems:** replace the uuid[] arrays with `problem_themes (problem_id, theme_id, relationship: primary|contributing)` and `problem_evidence (problem_id, evidence_id, relationship: supporting|contradicting, verified bool, rationale text)`. Add a stable matching key for dedupe (see #4).
- **Opportunities:** new `opportunities` table linked to problems (many-to-one), status lifecycle. This is distinct from `project_opportunities` (rename that to `workspace_suggestions` or similar — it's "signals for a new project," a different object, and the current name will keep confusing everyone including agents).
- **Evidence ↔ people:** populate `evidence_entities` at ingest time by resolving `claim.speaker` against the people rows already synced in the same run. The data is sitting in the same function; it just isn't joined.
- Also in this migration: the naming cleanups CLAUDE.md already mandates, `person_projects.status` brought back into taxonomy, and unified project context (see #6).

## 3. Rewrite synthesis as a real two-stage, incremental process

- **Stage A — topic hygiene (cheap tier):** normalize new ingest topic labels against the org topic registry; merge near-duplicates; this runs after every ingest and keeps the descriptive layer clean.
- **Stage B — theme construction (premium tier):** operate on the **whole corpus via topics**, not 30-record batches. Map-reduce: per-topic-cluster evidence summaries → one global pass that proposes themes with a central organizing concept, assigns confidence (volume, source diversity, recency — the §9 inputs), flags tensions (evidence contradicting evidence), and proposes merges of existing themes rather than duplicating them.
- **Incremental by default:** new evidence is assigned to existing themes; new themes require a threshold; theme IDs are stable across runs; nothing human-touched is deleted. Write real values to `evidence_themes.confidence`.
- Store the agent's rationale per assignment (one sentence) — this is the cheap XAI win and feeds the grading loop.

## 4. Rewrite problem discovery to read evidence and emit verified, typed links

- Input per candidate problem: the theme's central concept **plus the actual evidence records** (content, speaker, source kind, recency) — not the one-liner.
- Output per problem: title, description, severity, who-is-affected, **explicit evidence_ids with relationship `supporting` or `contradicting` and a one-line rationale each** — the evidence gate (§ "The evidence gate") applied to problems, not just artifacts.
- **Dedupe by meaning, not title:** embed the problem statement; if cosine similarity to an existing problem exceeds a threshold, *update* that problem (append new evidence links, refresh description as a proposal, never touch status). Below threshold → new problem. Surfaced problems whose evidence support collapses get flagged stale, not silently deleted.
- **Never reset human state.** Status is human-owned after first touch. Full stop.

## 5. Build the problem detail page and grouped evidence views (the product payoff)

- **Problem deep-dive:** who's affected (from `evidence_entities` → people/companies/roles), what's hard, why it matters, primary + contributing themes, supporting evidence (each row click-through to its exact segment, per #1), contradicting evidence shown honestly, recency/source-diversity strip, confidence label, and the downstream objects (opportunities, actions, artifacts citing it). This page is where a customer decides DiscOS is credible.
- **Evidence area becomes a repository, not a table:** views by Topic, by Theme, by Problem, by Person/Company, by Source; pagination past 50; filters powered by the join tables (one theme system, see F2).
- **Fix navigation honesty:** problem card counts become links; gaps teaser gets a real gaps surface (gap_signals data already exists) or loses its link; opportunities teaser points at an opportunities surface; pipeline rail optionally gains the Themes stage between Claims and Problems.

## 6. Unify project context and fix the cold-start

- One `projects.frame jsonb` (the §10 shape), migrating/absorbing `frame`, `frame_data`, and `research_context`; one reader used by every agent.
- At project creation, ask **one optional question** ("What are you trying to find out?") and let the AI draft the rest of the frame immediately — before the first ingest, so the first extraction is never frame-blind. Keep Option 3 (empty frame) valid.
- Surface the frame card on the workspace (prominent early, collapsing later) as §10 specifies; surface frame-vs-evidence tension after synthesis.

## 7. Entity layer hardening

- Speaker resolution: stop minting people from diarization labels ("Speaker 1", "Interviewer" → segment metadata only, optional review queue); disambiguate name collisions with company/email context before merging; keep `affiliation` flow (it's good).
- Link evidence to people at ingest (#2) — this unlocks the "by persona / by company" views in #5 with no extra AI work.

## 8. Hardening for customer trust (after the above)

- Theme/topic governance job (monthly meta-review per §17 — table exists in spirit via `agent_runs`, loop not built).
- `skill_configs` + versioned prompt defaults (§ "Skills stored in the database") — prompts are currently code-only; fine for now, needed before org customization.
- Evidence confidence indicator on the workspace (volume/coverage/diversity/recency/freshness — §9); the inputs all exist.
- Compose pipeline to Inngest (already acknowledged in CLAUDE.md as deferred — still correct to defer).

## Sequencing and effort (honest estimates)

| # | Change | Size | Gated? |
|---|---|---|---|
| 1 | Citation re-anchoring + backfill | 2–4 days | migration: yes |
| 2 | Ontology migration (topics, typed joins, opportunities, context merge) | 3–5 days | yes |
| 3 | Synthesis rewrite (two-stage, incremental) | 1–2 weeks | no (prompts/functions) |
| 4 | Problem discovery rewrite | ~1 week | no |
| 5 | Problem detail + evidence views + nav fixes | 1–2 weeks | no |
| 6 | Frame unification + creation flow | 2–3 days | migration part: yes |
| 7 | Entity hardening | 3–5 days | no |
| 8 | Governance/meta-review/skill_configs | 1–2 weeks | partly |

Items 1+2 are one combined migration cycle. Realistic total: **5–7 focused weeks** to a foundation you can put customers on, with visible product improvement landing as early as item 5.

## The one-paragraph summary

The plumbing is genuinely good — durable pipelines, model abstraction, redaction, tenancy, trust gates. The meaning layer on top of it has four structural defects: evidence cites the wrong segment, two theme systems exist and the UI wires one to the other, themes fragment because synthesis clusters in isolated batches, and problems are generated from one-line summaries with inherited (unverified) evidence links that clobber human decisions on every re-run. Every UI symptom you're seeing — wrong links, thin problems, messy navigation — traces back to those four. Fix anchoring first (it's actively corrupting data), do the ontology migration second, rewrite the two synthesis agents third, and the problem deep-dive UI becomes the moment the product starts looking like the best in the world rather than claiming to be.
