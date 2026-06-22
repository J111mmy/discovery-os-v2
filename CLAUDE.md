# CLAUDE.md — DiscOS Agent Anchor

**Read this file completely before touching any code. This is not optional context — it is the law of this codebase.**

The full specification is in `Discovery-OS-v2-PRD-final.docx` (in the parent Discovery OS folder). Everything below is extracted from that document. If your work contradicts anything here, stop and re-read before proceeding.

---

## ⭐ GUIDING LIGHT — north star + current focus (read EVERY session, keep current)

> This block is the steering wheel. Opus (PM) keeps it accurate. If work drifts from this, stop and re-anchor. The full narrative is `docs/VISION.md`; the live sequence is `ROADMAP.md`; the backlog is GitHub Issues.

**North star:** *Traceability is the product.* Every useful output is beautiful, specific, and traceable back to the exact evidence: a claim in any artifact links to the exact sentence a person said, in the exact source, with the exact anchor. We are the trust layer between an organisation's raw signal and everything it produces from it.

**Current focus (updated 2026-06-18):** **Quality before billing.** Billing/monetisation is consciously PARKED (Jimmy, 2026-06-18) until evidence + entity quality is trustworthy — you cannot charge for a tool that misspells a customer's name.
- **In flight:** the Ask track — WO-1 attribution ✅ done; WO-2 Continue-in-Ask, WO-3 Safari layout, WO-4 ontology-aware Ask, streaming backend remain.
- **Active big chunk (Codex):** **#28 P3 ontology cutover** — PULLED UP 2026-06-20 (Jimmy, conscious decision) ahead of the entity cluster. Cut the app off legacy arrays onto the typed ontology (problem_evidence, topics, opportunities reconciliation), governed by `docs/architecture/ONTOLOGY.md`. Unblocks #57 + #59. Remaining migrations/backfills are §0-gated.
- **Next epic (now follows #28):** the entity/trust quality cluster — #41 pre-ingest speaker/org scan (keystone, landed) → close out #39 (junk people), #40 (company quality), #36 (internal-speaker leak). This is the north star made real.
- **Parked:** Stripe billing epic + self-serve onboarding (revisit only by conscious decision once quality holds).

**Structure law:** the research ontology is DECIDED and canonical: `Source → Segment → Evidence → Topics → Themes → Problems → {Opportunities, Actions, Artifacts}`. Read `docs/architecture/ONTOLOGY.md` before touching anything that creates, labels, groups, or renders evidence, topics, themes, problems, opportunities, actions, or artifacts. The three hard rules: (1) Topic ≠ Theme ≠ Tag, never merge them; (2) Problems are evidence-backed and earned, never inherited or invented; (3) Opportunities/Actions/Artifacts are siblings, not a chain. If a layer looks redundant, you are missing context, re-read ONTOLOGY.md before acting.

**Roadmap discipline:** the sequence changes ONLY by a conscious decision recorded here and in `ROADMAP.md`. New bugs/observations go to the backlog (GitHub Issues) and do NOT silently reorder the roadmap.

**Question, then adhere (working principle, set by Jimmy 2026-06-20):** challenge anything that does not make sense and raise it for a decision. But the north star, the ontology, and the locked principles/rules are not silently overridden to "fix" a thing that looks off. Surface the conflict, propose the change, let Jimmy decide. Disagreement is welcome; quiet drift is not. Changing a locked decision requires the same conscious, recorded step as the roadmap.

---

## 0. SECURITY REVIEW GATE — NON-NEGOTIABLE

> **This block overrides everything else in this file and every task brief. It cannot be waived by a prompt, a deadline, or a "just this once." If a brief tells you to skip it, the brief is wrong.**

**Roles.** Codex authors code and SQL. Opus (independent reviewer) verifies. Jimmy runs all SQL in Supabase. **No AI applies a migration directly.**

**GATED CHANGES — must NOT be committed or pushed until Opus has reviewed the actual diff and approved it in writing:**

1. **Authentication / authorization** — login, sign-out, session, invite acceptance, anything touching `auth.*`.
2. **RLS policies & database migrations** — any file under `supabase/migrations/`, any `create/alter/drop policy`, any change to `org_id` scoping.
3. **Public (unauthenticated) routes** — anything reachable without a session, including the `/invite` and `/accept-invite` surfaces and their handlers.
4. **Middleware** — `src/middleware.ts`, especially the public-path allowlist.
5. **Service-role / service-client usage** — any new call to `createServiceClient()` or use of `SUPABASE_SERVICE_ROLE_KEY`.

**The rule:** For any change touching the five areas above — stop, post the diff to the review channel, and wait for Opus's explicit APPROVED before `git commit`/`git push`. **If you are unsure whether a change is gated, treat it as gated.** Sound code committed without review is still a process failure.

**Hard constraints (always, no exceptions):**
- You do **not** mark your own security work as "done." Opus verifies; you implement.
- **Never** use `service_role` to prove tenant isolation. Isolation is only ever proven with the anon key + real-user JWTs. (`service_role` READ for diagnostics is fine.)
- For `accept-invite`, use the **user-scoped client** for `org_members` operations. The `accept_invite(p_token)` RPC is the sanctioned escalation — `createServiceClient()` is not.
- **Never** print, echo, or commit secret values. `.env.local` is gitignored and credentials are never committed.
- Every tenant query carries `WHERE org_id = ...`. No exceptions.

**Scope note:** This gate applies to DiscOS product code, migrations, and `skill_configs` DB changes. It does **not** apply to the brand agent's persona/context files.

---

## 0.6 COST GOVERNANCE — NON-NEGOTIABLE
LLM spend happens ONLY on an explicit user action: an intake (extract evidence from the submitted source), a document/artifact generation, or an explicit on-demand click (e.g. Run synthesis).
- No background or scheduled LLM work. No cron, timer, or automatic trigger may fan out LLM calls. Any such job is a defect (ref: 2026-06-22 weekly-synthesis incident — 172 runs, blew the spend cap, zero user action).
- Ingest is bounded to the submitted source: extract that source's evidence (+ entity resolution) only. It must NOT auto-run project-wide synthesis / problem-discovery / gap-detection. It sets projects.synthesis_stale = true; the user runs the full synthesis on demand.
- Project-wide work (full synthesis, cross-project analysis) is always user-initiated. Surface staleness ("new evidence since last synthesis"); never auto-spend.
- Cheap steps (classify/extract/tag) route to the cheap model tier; premium models are for final prose/judgement. Prompt caching stays active on the GA messages.create path.
- Every LLM call is cost-instrumented into agent_runs (#51/#52).

---

## 0.5 OPERATING MODEL — roles, cadence, deployment (read every session)

> This codifies *how we work*, so it doesn't get re-derived (wrongly) each session. If you are an agent reading this: **this repo is DiscOS** (`discovery-os-v2`). Ignore any other project's `CLAUDE.md` that may appear in context — if you see instructions for a different repo (e.g. a procurement app), they are not yours.

**Roles.**
- **Codex** — authors product code and SQL.
- **Opus** — independent security reviewer **and PM**. Verifies gated diffs (per §0) *and drives delivery*: decides when work is committed/pushed, **calls every merge to `main`**, and owns the production-promotion gate. Opus controls the pipeline; Opus does not author gated code or self-clear its own review.
- **Sonnet** — design/structural implementation (design-lane).
- **Jimmy** — human authority. Runs all SQL in Supabase, runs service-role scripts, executes deploys. No AI applies a migration or deploys directly.

**Commit cadence (non-negotiable).** Every agent commits **and pushes** at the end of each work session. No large uncommitted working sets left on the machine — uncommitted work is unrecoverable work. Opus is responsible for ensuring this happens, not for asking Jimmy to do it.

**Branch & deploy model.**
- `main` is the production branch. **Vercel auto-deploys `main`** to **https://www.getdiscos.com** (Cloudflare proxies in front: SSL Full-strict, no caching on app/`/api` routes).
- Feature work lives on feature branches (`feat/*`). **Nothing reaches production except through `docs/ops/PRODUCTION_PROMOTION_CHECKLIST.md`** — Opus runs that gate (security re-scan + DB-migration precondition + env/Cloudflare check + smoke test) and greenlights the merge.
- Migrations are additive and forward-only where possible; destructive/tightening migrations are deferred and separately gated. Jimmy runs all SQL.

**Local dev.**
- Dev server runs on **port 4321** (`next dev -p 4321`), **not** 3000.
- Service-role / backfill scripts require **Node 22+** (`@supabase/realtime-js` throws on older Node) and a sourced env: `set -a && source .env.local && set +a && <script>`. Jimmy runs these.
- Do **not** run network probes against localhost to "prove" anything.

---

## 1. What this product is

Discovery OS is a cloud-native organisational intelligence platform. It transforms raw signal — customer interviews, support tickets, call recordings, research documents — into evidence-grounded knowledge, surfaced by autonomous agents and presented through an interface that adapts to the user's role and project stage.

**North star:** Every useful output is beautiful, specific, and traceable back to exact evidence. A claim in a sales enablement doc links to the exact sentence a customer said, in the exact transcript, with the exact timestamp. **Traceability is the product.**

---

## 2. The three-layer model — non-negotiable

```
┌─────────────────────────────────────────────┐
│  UI Layer                                   │
│  Next.js 14, TypeScript, Tailwind           │
│  Renders state. Surfaces agent output.      │
│  Adapts to user persona and project stage.  │
├─────────────────────────────────────────────┤
│  Agent Layer                                │
│  Anthropic Claude API + Inngest             │
│  Does ALL the intelligence work:            │
│  ingest, extract, classify, synthesise,     │
│  verify claims, detect gaps, draft.         │
├─────────────────────────────────────────────┤
│  Data Layer                                 │
│  Supabase — Postgres + pgvector + Auth      │
│  Single source of truth. RLS on every table.│
└─────────────────────────────────────────────┘
```

The agent layer is Claude doing real work — not regex, not word counts, not mechanical splitting. If you are writing logic that processes source material without calling Claude, you are building the wrong thing.

---

## 3. The ingestion model — the most important section in this file

### Three levels. Never collapse them.

| Level | What it is |
|---|---|
| **Source** | The raw file or text. Tracks provenance: who, when, from which system. |
| **Source Segment** | A structured unit cut from the source. For transcripts: a speaker turn or conversation unit (question + answer pair). Contains speaker, timestamps, character positions. |
| **Evidence** | A selected, curated, citable claim derived from one or more segments. The atomic unit of the knowledge base. **Created by the Ingest Agent.** |

**A transcript is not evidence. A segment is not evidence. Evidence is a selected, citable claim derived from source material by an AI agent reading for meaning.**

Collapsing these three levels destroys citation quality and makes the product feel approximate rather than audit-grade. Do not collapse them.

### The boundary between deterministic code and AI work

These are distinct responsibilities, and keeping them separate is what makes citation quality possible. (Mixing them *was* the original ingest failure — now fixed; the split below is implemented. See §21 — "What is built and what is not yet built".)

**Deterministic code does:**
- Parse timestamps and speaker labels from transcript text (regex is correct here)
- Group lines into speaker turns and conversation units
- Record char offsets (`char_start`, `char_end`) for citation anchoring
- Apply PII redaction patterns
- Validate schema fields and types
- Handle deduplication, retries, and batch sizing
- Enforce token safety limits on oversized turns

**The AI agent does:**
- Read the conversation unit and extract discrete citable claims
- Classify each claim (`insight | verbatim | data_point | signal`)
- Assign sentiment (`positive | negative | neutral | mixed`)
- Suggest themes against existing org taxonomy
- Write the evidence statement in clean, quotable language
- Flag adjacent signals for other projects

This split is **implemented**: `ingest-source.ts` runs deterministic conversation-unit segmentation, then a Claude extraction pass per unit. Multiple evidence records per unit is normal and expected. Do **not** regress to one-evidence-per-segment or word-count chunking (still prohibited — §"explicitly prohibited"). Current work hardens *where* each claim anchors (P0.5), not *whether* extraction is AI-driven.

### Segmentation algorithm (deterministic)

1. Parse transcript into raw speaker turns (regex on timestamp + speaker label patterns — this is correct use of regex)
2. Group turns into **conversation units**: an interviewer question with all customer response turns up to the next interviewer question, sharing the same `conversation_unit_id`
3. Decorate every segment: `source_id`, `speaker`, `start_time`, `end_time`, `char_start`, `char_end`, `segment_index`, `conversation_unit_id`
4. For non-conversational documents: split at paragraph/section boundaries, prefix with section heading
5. **Safety limit**: if a single turn exceeds 800 tokens, split at sentence boundaries within that turn, preserving speaker metadata. This is a safety guard for malformed exports — not the primary chunking logic. Semantic units come first; safety limits are the fallback.

### Evidence extraction (AI agent pass)

After segmentation, the Ingest Agent reads each conversation unit and extracts evidence records. The agent system prompt:

> *"You are a senior research analyst. Read this conversation unit. Extract every discrete citable claim. Preserve exact verbatim quotes. Classify each claim: insight = a conclusion the participant drew; verbatim = their exact words; data_point = a number or measurable fact; signal = a weak early indicator. Suggest themes using the existing org taxonomy before inventing new ones. One claim = one evidence record."*

Each evidence record produced:
- `content` — the direct quote or observation, exact not paraphrased
- `summary` — AI-generated one-sentence summary
- `classification` — `insight | verbatim | data_point | signal`
- `sentiment` — `positive | negative | neutral | mixed`
- `segment_id` — FK to the exact segment it came from (this is the citation anchor)
- `embedding` — pgvector for semantic search

Multiple evidence records per segment is normal and expected. A 3-minute customer answer about their workflow might yield 4-6 distinct citable claims.

---

## 3b. Schema alignment — use these names consistently

The codebase and CLAUDE.md have drifted on naming. Use these exact names everywhere — in migrations, TypeScript types, API responses, and agent code:

```
Column/field name       Use this            Not this
----------------------  ------------------  ------------------
segment FK on evidence  segment_id          source_segment_id
skill prompt storage    skill_configs       agent_configs
trust scope values      trusted | pending   disputed already exists in DB
                        | excluded          and TS types — reconcile
                        | disputed          docs and UI to match
source kind values      transcript          interview (legacy)
                        document            call_recording (legacy)
                        note                internal (legacy)
                        web
                        slack
                        usability
                        monitoring
```

Reconcile these in the next schema migration before building new features on top of inconsistent column names.

Evidence entity relationships use **join tables**, not FK columns. One evidence record can involve multiple people, companies, products, and competitors. The PRD says no array columns — join tables are the consistent application of that rule:

```sql
-- DO NOT add person_id or company_id directly to evidence
-- USE join tables instead:
evidence_entities (evidence_id, entity_id, entity_type, relationship)
-- entity_type: 'person' | 'company' | 'competitor' | 'product'
```

---

## 4. Model abstraction — provider-agnostic, never hardcode model names

The agent layer is not locked to Anthropic. Anthropic (Claude) and OpenAI (GPT-4o, o3, etc.) are both valid providers. The abstraction layer in `src/lib/llm/` must support either. New providers can be added without changing product logic.

```
task_tier    | examples                                         | recommended default
-------------|--------------------------------------------------|---------------------------
cheap        | classify, theme_tag, entity_detect, pii_scan    | configured cheap tier (Anthropic default: claude-haiku-4-5-20251001)
standard     | ingest, segment, entity_enrich, session review  | Claude Sonnet 4.6
premium      | compose, synthesise, opportunity_detect         | Claude Sonnet 4.6 first; Opus/GPT-5.5 only for rare expensive jobs
eval         | claim_verify, citation_check, evidence grading  | GPT-5.4
```

`eval` is **not** a higher creative tier than `premium`. It is the strict reviewer lane: low-temperature, conservative, and sceptical. The preferred architecture is model diversity: Anthropic for most research/writing work, OpenAI for verification and challenge.

Model and provider assignments live in `src/lib/llm/models.ts`. Runtime routing is super-admin controlled per tier from `platform_settings`. The product code calls `llm(task_tier, prompt)` — it does not know or care which provider runs it. One config change swaps provider or model for each tier.

**Rules:**
- Never write a model name (`"claude-sonnet-4-6"`, `"gpt-4o"`, etc.) anywhere in product code outside `src/lib/llm/models.ts`
- Never write `anthropic.messages.create(...)` or `openai.chat.completions.create(...)` directly in route handlers or Inngest functions — always go through the abstraction layer
- The abstraction layer exposes: `llm(tier, messages, tools?)` and `embed(text)` — nothing else needs to be public

---

## 5. Project context in extraction — the agent is never context-blind

The Ingest Agent must receive full project and org context before it reads a single line of source material. Without this, evidence extraction is generic and untargeted. With it, the agent knows what it is looking for and why.

### What the agent receives before extracting

**Project Frame** (from `projects.frame`):
- The problem being investigated
- The hypothesis being tested
- The buyer personas in scope
- The research areas (what questions we are trying to answer)
- The success metrics (what a good outcome looks like)

**Existing org taxonomy** (from `evidence_themes` across the org):
- The themes and classifications already in use
- The agent should tag against these before inventing new ones
- New themes are acceptable but should be flagged as novel

**Existing problems for this project** (from the problems/opportunities already in the DB):
- The agent should check whether extracted evidence supports, contradicts, or is unrelated to known problems
- Evidence that strengthens a known problem should be linked; evidence that contradicts it should be flagged as tension

**Other active projects in this org** (titles and frames only — not their evidence):
- The agent should flag when a signal from this source is adjacent to a different project's frame
- Example: ingesting a procurement interview for Project A, but the participant mentions a scheduling problem that maps directly to Project B's frame — that signal should be extracted AND flagged for Project B

### The extraction context block (passed to Claude before each ingest)

```
PROJECT FRAME
Problem: {frame.problem}
Hypothesis: {frame.hypothesis}
Research areas: {frame.researchAreas[]}
Buyer personas: {frame.buyers[]}
Success metrics: {frame.successMetrics[]}

EXISTING THEMES IN THIS ORG
{list of theme names and descriptions}

KNOWN PROBLEMS IN THIS PROJECT
{list of problem titles already in the DB}

OTHER ACTIVE PROJECTS (for adjacency detection)
{list of project names + one-line frame summaries}

Your job: extract every discrete citable claim from the source material.
For each claim: classify it, quote it verbatim where possible, assign sentiment,
suggest themes from the existing list before creating new ones, and flag any
signal that appears adjacent to a different project's frame.
```

### Adjacent signal flagging

When the agent detects a signal outside the current project's frame but relevant to another project:
- Still extract it as evidence for the current project (it happened in this source)
- Add `adjacent_project_ids: [uuid]` to the evidence metadata
- The UI surfaces these as "signals for other projects" — a PM can route them with one click

This is how org-level intelligence emerges: not from a separate analysis pass, but from every ingest being aware of the full project landscape.

---

## 6. Agent jobs run in Inngest — not in Vercel serverless functions

Major AI workflows must run as Inngest durable functions. Each step is small and resumable. Do not run ingest, synthesis, claim verification, or compose pipelines directly in a Next.js Route Handler. The Route Handler fires the Inngest event; Inngest does the work.

The seven agents and their Inngest event triggers:

| Agent | Event | Responsibility |
|---|---|---|
| Evidence Ingest | `source/ingest.requested` | Segment + extract evidence from raw source |
| Entity Extraction | `source/ingest.completed` | Build entity profiles from evidence |
| Synthesis | `project/synthesis.requested` | Pattern detection across evidence |
| Gap Detection | `project/synthesis.completed` | What evidence is missing |
| Opportunity Detection | `project/synthesis.completed` | What to build next |
| Compose | `artifact/compose.requested` | Draft documents from evidence |
| Claim Verification | `artifact/claim.verification.requested` | Verify artifact claims against evidence |

---

## 6. Security and privacy — Phase 1 requirements, not Phase 5

This product ingests highly confidential data: sales call recordings, internal strategy sessions, customer interviews.

- **PII redaction runs before any LLM call.** `raw_content` is never sent to any external API. Only `redacted_content` is passed to Claude or embedding models.
- **Always `WHERE org_id = ?`** — never trust `project_id` alone. RLS enforces this at the DB layer. Application code enforces it too.
- **Entity names (people, companies) are NOT redacted** — they are the primary entity extraction signal. Redact high-risk PII tokens only (phone numbers, emails, ID numbers).

---

## 7. Schema rules

- All tables have `org_id` as the RLS anchor.
- No `uuid[]` array columns for relationships. Use join tables. This enables claim-level citation lineage.
- Join tables: `evidence_themes`, `evidence_entities`, `artifact_claim_evidence`.
- `source_segments` is the layer between `sources` and `evidence`. Never skip it.
- HNSW index on `evidence.embedding`. Always include `org_id` in vector search queries to prevent cross-tenant scan.

---

## 8. UI rules

- The UI renders what agents produce. It does not do intelligence work itself.
- Adaptive to user persona (`pm | cs | sales | exec | researcher | designer`) stored in `users.preferences`.
- Dark mode first (the app uses `dark` class on `<html>`).
- CSS variables for all colours — never hardcode hex values in components.
- Every evidence-backed claim in an artifact must be visually traceable — a citation that links to the source segment.

---

## 9. The phase model — a guide, not a gatekeeper

DiscOS reflects an 11-phase discovery-to-market journey. The phases are guidance, not hard blocks. Users can work in any order they choose. The system's job is to show them where they are, how confident the evidence base is at each stage, and what would make it stronger — not to stop them doing anything.

```
Phase 0 — System Foundation
  Global entity registry, skill configs in DB, kernel schemas and taxonomy.
  Set up once, shared across all projects.

Phase 1 — Project Setup
  Project context (frame), first stakeholders, initial strategy notes.

Phase 2 — Evidence Gathering
  Ingest sources, extract evidence, build entity records.
  The earlier this runs and the richer it gets, the better everything downstream becomes.

Phase 3 — Problem Discovery & Synthesis
  Problems emerge from evidence clusters. Synthesis runs across all evidence.
  Segments (persona groups with validated problems) are defined here.

Phase 4 — Research & Strategy
  Competitive landscape, market position, strategic thesis, risk records.

Phase 5 — Ideas & Prototyping
  Concepts linked to problems. Prototypes linked to concepts and test hypotheses.

Phase 6 — Testing & Feedback
  Validation sessions, usability results, prototype feedback, test records.

Phase 7 — Go/No-Go Decision
  Formal decision record. The system shows evidence confidence at this point
  and surfaces what's still uncertain — but the user decides when they're ready.

Phase 8 — Go-To-Market Pack  (typically parallel with Phase 9)
  GTM Contract → Positioning, Messaging Matrix, Proof Library,
  Sales Playbook, Launch Ops, Customer Success.

Phase 9 — PRD & Build  (typically parallel with Phase 8)
  PRD, requirements, stakeholder deck, artifact registry.

Phase 10 — Launch
  Beta program, feedback collection, QBR cycle, health scoring.

Phase 11 — Post-Launch Monitoring
  Usage signals route back into discovery. New evidence feeds Phase 2.
  The loop closes and the system compounds.
```

### Evidence confidence — show don't block

Instead of hard gates, the UI shows a confidence indicator on the project overview that reflects the current state of the evidence base. This is calculated from:

- **Volume** — how many trusted evidence records exist
- **Coverage** — how many of the project's research areas have evidence against them
- **Source diversity** — how many distinct sources (one person saying something ≠ a pattern)
- **Recency** — when the last evidence was ingested
- **Synthesis freshness** — whether synthesis has run on the latest evidence

Display as a simple progress signal (e.g. Green / Amber / Red, or a percentage with a label) with a one-line explanation: "3 sources, 14 evidence records. Research areas 2 and 4 have no evidence yet. Last synthesis 6 days ago."

The user decides what to do with that information. The system never blocks — it informs.

Artifacts generated from thin evidence still work, but they surface a confidence label: "This draft is based on 4 evidence records across 2 sources. Add more interviews to strengthen the claims."

---

## 10. Project context — lightweight, AI-drafted, always editable

Project context (the Frame) is the lens the extraction agent uses when reading source material. It should be useful without being a burden. The design principle: **the system tries to write it for you; you just correct it.**

### What the frame contains

Stored in `projects.frame`. Currently `text | null` in the app — the schema reconciliation migration should convert this to `jsonb` with the structure below. Until that migration runs, treat it as a text field containing JSON. Kept deliberately minimal:

```json
{
  "problem":        "One sentence — what problem are we investigating?",
  "hypothesis":     "One sentence — what do we believe is true?",
  "buyers":         ["job title or persona", "..."],
  "researchAreas":  ["question we're trying to answer", "..."],
  "successMetrics": ["how we'll know we've learned enough", "..."]
}
```

Nothing else. No lengthy briefs. No mandatory fields. An empty frame is valid — the agent will work with whatever is present and flag what's missing.

### Frame draft columns (migration 0015)

`projects.frame_draft` (jsonb, nullable) — AI-proposed draft, shape:
```json
{ "problem": "...", "hypothesis": "...", "buyers": "...", "research_areas": ["..."] }
```
`projects.frame_draft_generated_at` (timestamptz, nullable) — when the draft was last written.

The draft does **not** overwrite `projects.frame`. Jimmy accepts, edits, or discards it via UI. Once accepted, the UI writes to `projects.frame` (and optionally clears `frame_draft`).

### How the frame gets populated

**Option 1 — AI-drafted automatically after first ingest (built).**
The `draft-frame` Inngest function fires `project/frame.requested` from `ingest-source` whenever `projects.frame` is null after an ingest. It reads the session's evidence (min 3 records), calls Claude with the `frame-draft-v1` prompt, and writes the result to `projects.frame_draft`. Skips gracefully if the frame was set between queue and execution. Prompt outputs structured JSON: `{ problem, hypothesis, buyers, research_areas[] }`. Fails silently — never surfaces to the user.

**Option 2 — User writes it directly.**
A simple form in project settings. Each field is a single text input, no rich text needed.

**Option 3 — Stays empty.**
Totally valid. The agent notes in each evidence record that it ran without a frame and extraction was broader/less targeted as a result.

### How it behaves over time

- **Early in the project:** The frame is prominent on the project overview — a card that says "Your project frame" with an edit button. The extraction agent references it heavily and flags when evidence contradicts the hypothesis.
- **Mid-project:** The frame card collapses to a single line with an edit link. It's still there, still informing the agent, but it's not demanding attention.
- **Late project / GTM phase:** The frame moves to project settings entirely. The agent has enough evidence that it's less reliant on the frame for context — the evidence itself provides the direction.

The frame is always accessible. It never disappears. It just gets out of the way as the evidence base grows and speaks for itself.

### Frame updates from evidence

After each synthesis run, the agent compares the current frame to the evidence clusters. If evidence consistently points somewhere different from the stated hypothesis, the agent surfaces this: "Your hypothesis says X, but 8 of your 12 evidence records suggest Y. Want to update the frame?" The user can accept the suggestion, edit it, or dismiss it. The frame is never auto-updated without user confirmation.

---

## 11. Global entity model — people and orgs live outside projects

This is one of the most important architectural decisions in the system and it is not yet reflected in the cloud app schema.

**People and organisations are global, not project-scoped.** A person interviewed for Project A who then appears in Project B is the same person — one canonical record, two participation records. This enables cross-project intelligence: who has been spoken to, across how many projects, what their status is in the product lifecycle.

### Two-layer entity model

```
Global canonical layer (_entities/)
  _entities/people/      — PERS-* records. One per person, ever.
  _entities/orgs/        — ORG-* records. One per organisation, ever.
  _entities/competitors/ — COMP-* records. Slug IDs (COMP-ACME not COMP-001).

Project participation layer (per project)
  02_entities/people/    — thin stub with global_id + project + status in this project
  02_entities/orgs/      — thin stub with global_id + project
  02_entities/competitors/ — thin stub with global_id pointing to canonical
  02_entities/sites/     — project-local (sites don't have global records)
```

### What a canonical person record contains

```
PERS-[NAME-SLUG].md
  name, role, org_id (FK to ORG-*), email
  status: prospect | interviewed | concept-shown | beta-candidate | beta-participant | customer
  projects: [list of projects they've appeared in]
  sessions: [list of SRC-* records where they spoke]
  evidence_ids: [EVD records where they are cited]
  notes: [running context about this person]
```

The person's status moves forward as the relationship develops. The system should surface: "This person has been interviewed in 3 projects. They are currently a beta candidate." That visibility lives at the org level, not inside any single project.

### What this means for the cloud app schema

The current schema has no global entity tables. This needs to be added:

```sql
people
  id, org_id (tenant), name, role, email, company_id, status, affiliation, notes
  -- status: prospect | interviewed | concept-shown | demo-shown | beta-candidate | beta-participant | customer
  -- affiliation: internal | external | unknown (default: unknown)
  --   'internal' = team member (sales, research, eng). Their speech is CONTEXT, not evidence.
  --   The ingest agent receives the list of internal people before extraction and skips their
  --   turns as evidence sources. Flag people here once and every future ingest handles them correctly.

companies  (equivalent of _entities/organisations/)
  id, org_id (tenant), name, domain, size, industry, notes

company_projects  (join — which companies appear in which projects)
  company_id, project_id, first_seen, context

person_projects  (join — which people appear in which projects)
  person_id, project_id, status_at_time, first_seen

competitors  (global to org, not project-scoped)
  id, org_id (tenant), name, slug (unique within org), website, notes,
  positioning text, known_strengths text, known_gaps text, last_researched date
```

Evidence links to people and companies via the `evidence_entities` join table — not direct FKs on the evidence row. One evidence record can involve multiple people, companies, and competitors. This enables: "Show me all evidence from operations directors" or "Show me everything said by people at AECOM."

---

## 12. Competitive intelligence — a first-class system

Competitive intelligence is evidence work, not note-taking. Every competitive research pass must produce cited sources, atomic evidence records, an updated competitor record, and one reusable learning.

### COMP-* records (global to the org)

Each competitor has a canonical record containing:
- Positioning (what they claim, how they present themselves)
- Known strengths (with sources — never assert without evidence)
- Known gaps (with sources — confirmed by users or documentation, not inferred)
- Mentions: which projects, which organisations mentioned them
- Win/loss record: when the org won or lost deals against this competitor and why
- Battle card: the sales counter-script

### Evidence standards for competitive claims — three types only

Every competitive claim must be one of:
- ✅ **EVIDENCED** — directly sourced to an EVD record, screenshot, or documentation page
- ⚠️ **ASSUMPTION** — reasonable inference from evidence; always labelled as such
- ❓ **UNKNOWN** — we don't know; never guess; add to intelligence gaps

Rules:
- Never assert how a competitor's integration works unless documentation or a demo confirms it. A logo on an integration page confirms the integration exists — nothing more.
- Never state competitor team size, pricing, or contract terms without a source.
- Never use the absence of information as evidence. "We couldn't find X" ≠ "They don't have X."
- Battle cards will be used in live sales conversations. If a claim is wrong and a prospect knows it, the org loses credibility. Every claim must be defensible.

### Battle cards

Every competitor with active competitive risk gets a battle card:
```
Their Pitch          — what they claim (sourced)
Where They Win       — genuine strengths with named customer evidence
Their Gap            — 1-3 structural weaknesses (sourced to EVD records)
Your Counter         — specific talk tracks: "If they say X → say Y"
One Proof Point      — the strongest cited claim to have ready
```

Battle cards are governed by the GTM Contract. They live in the artifact registry with freshness review dates.

### Win/loss tracking

After any deal where a competitor was involved, a win/loss record is created:
- Which competitor
- Why won or why lost
- Which gap or strength was decisive
- Whether the gap should become a PROB record
- Update to competitor's record and battle card

---

## 13. Action extraction and external sync

After every interview or session, two categories of item need to be captured:

**Personal commitments** — things the interviewer said they'd do:
- "I'll send you...", "Let me get back to you on...", "I'll connect you with..."
- These become personal action records
- Route to Linear (personal task management) when connector is available

**Product backlog requests** — features or capabilities the participant asked for:
- These become product request records linked to the evidence
- Route to Jira Product Discovery (JPD) when connector is available — not Linear
- JPD is the single source of truth for the product backlog; Linear is for personal to-dos

External sync is additive. If connectors are unavailable, save locally and surface an "External Sync Pending" notice. Never block local record creation on external tooling availability.

---

## 14. GTM cascade — ingest must propagate to live GTM artifacts

After every ingest, new contacts and beta signals must propagate to live GTM artifacts. Without this step, a person exists in the discovery system but is invisible to outreach workflows.

After each ingest run, the Ingest Agent checks:

1. **Beta candidate signals** — any POS-type evidence where the participant expressed interest in trialling or moving forward → check beta criteria list, add if missing, update status if changed
2. **Outreach gap** — any new beta candidate without a personalised outreach draft → draft one anchored in specific things they said, not generic pain points
3. **External tracker sync** — if Confluence, Notion, or CRM connectors are available, sync the beta candidate table

This is the bridge between discovery and sales motion. Without it, research and outreach are disconnected.

---

## 15. Operating rhythms — what agents run and when

### After every customer interview
1. `session-review` — readable session brief (what was discussed, key quotes, prototype reactions, what they want)
2. `extract-actions` — personal commitments + product backlog requests
3. `ingest` or `triage-feedback` — structured evidence extraction
4. `entity-resolver` — resolve new people/orgs against global registry
5. GTM cascade check (see §14)

### Weekly
1. ~~`synthesise` — problem landscape refresh, cluster analysis, confidence scoring~~
2. `review-registry` — problem registry health check (stale, duplicates, low-confidence)
3. `monitor-signals` — if post-launch: pull usage data, route back into discovery

Synthesis is on-demand only (Run synthesis button). The weekly scheduled-synthesis cron was removed 2026-06-22 for cost governance; auto-scheduling is deferred to a future opt-in, paid 'always-current' tier.

### Monthly
1. `meta-review` — reads operation logs, surfaces correction patterns, proposes kernel improvements
2. `propagate-updates` — pushes approved kernel changes to all active projects

### On demand
- `competitive-intel` — when a competitor is mentioned, a deal is won/lost, or new intel is available
- `query-project` — natural language questions across any project's records
- `orchestrate-artifacts` — generate or refresh any artifact

---

## 16. Session review vs evidence extraction — two distinct outputs

These are separate and both matter:

**Session review** (`session-review` skill) produces a human-readable brief:
- What was discussed, narrative form
- Key quotes preserved verbatim
- The participant's world: their tools, workflow, pressures, context
- What they thought of the prototype (if shown)
- What they want that doesn't exist yet
- Designed to be read by a human — not a data record

**Evidence extraction** (`ingest` / Ingest Agent) produces structured records:
- Atomic, citable EVD records
- Classification, sentiment, confidence
- Linked to source segments with exact character positions
- Designed to be queried by agents — not read by humans

Both run after every session. Session review first (fast, narrative), then ingest (structured, slower, agent-powered).

---

## 17. The self-improvement loop — meta-review

The system learns from its own mistakes. Every agent run appends to an operation log. The `meta-review` skill reads those logs monthly and surfaces:
- Where the agent got things wrong and a human corrected them
- Vocabulary or taxonomy gaps (new concepts appearing that have no classification)
- Cross-project patterns (same problem appearing in 2+ projects — should it be in the global kernel?)
- Skill improvement proposals

Proposed improvements go to the user for approval. Nothing is auto-applied. Only after user confirmation do kernel changes propagate. This is what makes the system compound in value over time — it gets smarter with each project.

In the cloud app, this means:
- `agent_runs` table logs every agent call with inputs, outputs, and any human corrections
- A monthly scheduled Inngest job surfaces correction patterns
- `skill_configs` in the DB can be updated (with approval) from the meta-review findings

---

## 18. The controlled taxonomy

Use these exact values. Do not invent new ones without a meta-review update.

**Evidence classification:** `insight | verbatim | data_point | signal`
**Evidence sentiment:** `positive | negative | neutral | mixed`
**Evidence trust scope:** `trusted | pending | excluded | disputed`
**Source kind:** `transcript | document | note | web | slack | usability | monitoring`
**Person status:** `prospect | interviewed | concept-shown | demo-shown | beta-candidate | beta-participant | customer`
**Problem status:** `surfaced | acknowledged | active | resolved | dismissed`
  *(surfaced = AI-discovered, not yet human-reviewed; acknowledged = PM has seen it; active = being worked; resolved = addressed; dismissed = not valid)*
**Prototype status:** `concept | designing | built | testing | validated | deprecated`
**Confidence:** `high | medium | low`
**Decision outcome:** `go | conditional-go | no-go | approved | deferred | rejected`

---

## 19. The three project dashboards

Every project surfaces three views. These are distinct — not tabs within one page:

1. **Discovery dashboard** — evidence, problems, sessions, people, prototypes, beta candidates, query interface. The working surface during research.
2. **Business dashboard** — market model, TAM/SAM/SOM, segments, competitors, risks, strategic thesis. The commercial layer.
3. **Artifacts dashboard** — all generated documents with source basis, freshness dates, and staleness warnings. The output registry.

Agents write to the underlying data. The dashboards render it. No content is authored directly in the dashboard — it is always derived from records.

---

## 20. Record types, the skill system, and the evidence gate

Every record type in the system. Agents must use these exact prefixes and never invent new ones.

```
SRC-*    Source — raw interview, file, Slack export, email
EVD-*    Evidence — atomic unit: quote, finding, signal. Traced to SRC.
PROB-*   Problem — derived from ≥2 EVD records. Never invented.
PERS-*   Person — global canonical record
ORG-*    Organisation — global canonical record
COMP-*   Competitor — slug IDs (COMP-ACME not COMP-001), global registry
IDEA-*   Idea/Concept — linked to PROB records they address
PRTO-*   Prototype — linked to IDEAs and TSTs
TST-*    Test — hypothesis + result
SEG-*    Segment — validated persona group
DEC-*    Decision — formal record with evidence cited
RSK-*    Risk — open, accepted, or closed
FEED-*   Feedback — post-launch signal loop
ART-*    Artifact — generated document, deck, or GTM asset
```

---

### The skill taxonomy

The creation system has four tiers. Higher-tier skills call lower-tier skills; lower-tier skills never call up.

```
Tier 1 — Orchestration
  orchestrate-artifacts   Master skill. Receives a request, decides which
                          specialist skills to invoke, and registers all outputs
                          in the artifact registry.
  request-output          User-facing pick list. Shows available artifact types,
                          checks what already exists, calls orchestrate-artifacts.

Tier 2 — Synthesis (on-demand; inform artifact creation)
  synthesise              Clusters all evidence into problem landscape, heatmaps,
                          and pattern analysis. Run only from explicit user action.
  synthesise-market-strategy  Market sizing, competitive position, strategic thesis.
  competitive-intel       Competitor research and win/loss analysis.

Tier 3 — Artifact specialists (called by Tier 1 or directly by user)
  generate-prd            PRD — traces every requirement to evidence.
  build-gtm               GTM pack — launch readiness, positioning, sales materials.
  generate-deck           Stakeholder deck or alignment pre-read (calls pptx skill).
  session-review          Human-readable brief for a single interview or call.
  extract-actions         Action items, follow-ups, and backlog items from calls.
  build-demo-script       Live demo narrative and screen-by-screen walkthrough.

Tier 4 — Data and entity (run during or after ingest)
  ingest                  Raw source → segments → evidence.
  triage-feedback         Special ingest for sessions where a prototype was shown.
                          Calls ingest for problem signals AND creates FBK records.
  entity-resolver         Deduplicates and merges entity records across projects.
```

### How skills chain together

```
User uploads transcript
  → ingest
    → entity-resolver (if new entities detected)
    → mark project synthesis_stale = true
    → user explicitly clicks Run synthesis when ready

User requests an artifact
  → request-output (shows pick list, checks existing)
    → orchestrate-artifacts (decides which specialist to call)
      → brand (always — brand consistency check on every artifact)
      → generate-prd | build-gtm | generate-deck | session-review
        → docx skill | pptx skill (format output)
        → orchestrate-artifacts (register output in artifact registry)
          → propagate-updates (refresh any related artifacts that are now stale)
```

Skill chaining is event-driven in the app: each Inngest function fires the next event when it completes. No skill polls or waits for another — it fires and the next picks up.

### The evidence gate — non-negotiable for every artifact

**Before writing any customer claim, quote, or statistic in any artifact, the Compose Agent must:**

1. List every `evidence_id` it intends to cite — explicitly, before generating any content
2. Fetch each evidence record from the DB and read the `content` field
3. Quote only from what it has actually retrieved in this run — never from memory
4. Attribute correctly using `source_id` and `segment_id` from the record — not from inference
5. If no evidence exists for a claim, choose one only:
   - Remove the claim entirely, OR
   - Label it `[INTERNAL OBSERVATION — not customer-sourced]`, OR
   - Label it `[PATTERN — across N evidence records, no single direct quote]` and list the IDs

**This gate applies to:**
- Any sentence attributing behaviour to a named company or person
- Any direct quote in quotation marks
- Any statistic claimed to come from customer interviews
- Any "multiple users described..." claiming specific behaviour

**This gate does not apply to:**
- Problem statements already grounded in the evidence layer
- General market observations clearly labelled as such
- Product positioning language not attributed to specific customers

The UI must make citation visible: every evidence-backed claim in a rendered artifact shows a citation chip that links to the exact source segment. Traceability is the product.

### Skills stored in the database — with versioned code defaults

Agent prompts live in two places: versioned defaults in code (or migrations), and org-level overrides in the database. Pure DB-only prompts are hard to review, diff, deploy, roll back, and reproduce across environments.

```sql
skill_configs
  id              uuid PK
  org_id          uuid FK organisations (nullable — null = system default)
  skill_type      text     -- 'ingest' | 'synthesise' | 'compose_prd' | etc.
  system_prompt   text     -- org override; null = use code default
  output_schema   jsonb    -- expected structure of agent output
  model_tier      text     -- 'cheap' | 'standard' | 'premium' | 'eval'
  prompt_version  text     -- tracks which version of the default this overrides
  active          bool
  updated_at      timestamptz
```

The resolution order:
1. `skill_configs` row for this `org_id` + `skill_type` where `active = true` → use `system_prompt` from DB
2. No org override → use the versioned default prompt from `src/lib/llm/prompts/[skill_type].ts`

This means: default prompts ship with the code and are reviewable in git. Orgs can customise without a deploy. When the code default changes, the `prompt_version` field flags which org overrides are now stale.

### Synthesis — when and why

Synthesis is not optional and not a one-time event, but it is never automatic. It runs:
- On demand when a user explicitly requests it (for example, the Run synthesis button)
- After ingest only as a stale state: ingest sets `projects.synthesis_stale = true`; it does not run synthesis

What synthesis produces:
- Problem clusters (groups of evidence that point to the same underlying problem)
- Confidence levels per cluster (based on evidence count, recency, source diversity)
- Tension flags (evidence that contradicts other evidence on the same topic)
- Gap signals (research areas in the project frame with little or no evidence yet)
- Opportunity candidates (problem clusters with high confidence and no current solution)

These outputs live in the DB and are surfaced in the project overview. The Compose Agent reads them when drafting any artifact — it does not re-derive patterns from raw evidence at compose time.

---

## 21. What is built and what is not yet built

> **Status as of 2026-06-10.** Verified against `supabase/migrations/` and the registered Inngest functions in `src/app/api/inngest/route.ts`. This section was badly stale before this date — most of the old "not yet built" list had already shipped. **If you're about to "build" something here that's marked built, read the code first.**

### Built and live
- **Auth, org/project structure, RLS, team invites** — incl. the `accept_invite(p_token)` RPC (0027).
- **Source ingest *with* AI evidence extraction** — `ingest-source.ts` does deterministic conversation-unit segmentation **then a Claude extraction pass per unit** (`buildConversationUnits` → `callLLM` → classified, sentiment-tagged, verbatim claims). The mechanical one-evidence-per-segment chunker is **gone**. Citation anchoring (`segment_id` + `anchor_method`) is being hardened by the P0.5 initiative — see "In flight" below.
- **The full agent set runs as registered Inngest functions** (not orphaned files — all wired in the serve route): ingest, extract-entities, synthesise-project (on-demand only), discover-problems, verify-claims, detect-gaps, session-review, compose-artifact, grade-evidence, extract-actions, draft-frame, and person/company/competitor digests.
- **Global entity model** — `people`, `companies`, `competitors` + the `evidence_entities` join all exist (0006/0007/0014/0016/0018) and `extract-entities` populates them. Evidence links entities via the join, never FK columns.
- **skill_configs** table exists (0006/0025) — org prompt overrides + versioned code defaults per §20.
- **Compose runs in Inngest** (`compose-artifact`) — no longer a Route Handler.
- **Evidence trust review** (trust/exclude/trust-all), source management (`/sources`), artifact library (`/documents`), project settings, and **semantic search via pgvector** (`/api/query`).
- **Source kinds** — canonical values incl. `customer_interview | sales_call | usability_study | internal_meeting` added in 0013 (preferred for new ingests).
- **Evidence segment FK is `segment_id`** — it always was; there is no `source_segment_id` column to "reconcile."

### In flight — research-ontology / P0.5 (branch `codex/spec-research-ontology`, NOT yet on `main`)
Pipeline-integrity fixes; **no schema change in P0.5.** Grounding: `docs/PIPELINE_DEEP_DIVE_2026-06-09.md`, decisions in `OPUS_CODEX_CHANNEL.md`.
- **F1 re-anchoring** — claims were anchored to `unit.segments[0]` (the interviewer's question). The shared matcher `src/lib/evidence/anchor.mjs` (used by **both** live ingest and the backfill) now anchors to the best segment and stamps `anchor_method` (exact/normalised/fuzzy/speaker/fallback) + `original_segment_id`. Backfill `backfill-evidence-anchors.mjs` is dry-run-default; `--apply` is **gated on Opus review** of the weakness-stratified re-run sample, per `docs/ops/BACKFILL_AGENT_CHANGE_PROTOCOL.md`.
- **F2 theme linkage** — workspace chart links `?theme_id=<uuid>`; evidence page resolves it org/project-scoped (legacy `?theme=` is the text-array topic filter).
- **C3 problem-status preservation** — `discover-problems` no longer clobbers human-set status: writes `status` on insert only, updates rows only while `status = surfaced`.
- Ahead: P1 problem-detail drawer (design approved, `docs/briefs/design/SONNET_DESIGN_PROBLEM_INTELLIGENCE_P1.md`) → P2 evidence multi-lens → **P3 the hard-gated schema migration** → P4 operational loop.

### Genuinely open / verify before relying on it
- **`projects.frame`** is still `text` (0001) alongside `frame_data`/`frame_draft` jsonb companions (0015) and a `suggested_frame`. The full text→jsonb consolidation is unfinished — **confirm the live column shape before building on the frame.**
- **`trust_scope`** — `disputed` exists in the DB + TS types alongside `trusted | pending | excluded`; docs/UI reconciliation (§18) may still be partial.

---

## 22. Things that are explicitly prohibited

- ❌ Word-count or character-count chunking of transcripts
- ❌ Hardcoded model names in product code
- ❌ Running major AI workflows in Vercel Route Handlers (use Inngest)
- ❌ Sending `raw_content` to any LLM or embedding API
- ❌ Querying without `org_id` filter
- ❌ `uuid[]` array columns for relationships (use join tables)
- ❌ Collapsing Source → Segment → Evidence into fewer levels
- ❌ Creating evidence records without a `segment_id` FK

---

## 23. File locations

```
src/app/(auth)/          — Login, auth callback
src/app/(app)/           — Protected app routes
src/app/api/             — Route handlers (fire events, don't do AI work)
src/lib/inngest/         — Inngest client + all agent functions
src/lib/llm/             — Model abstraction, PII redaction, embed
src/lib/compose/         — Compose pipeline
src/lib/query/           — Evidence retrieval
supabase/migrations/     — All schema changes go here as numbered .sql files
```

Sidebar component: `src/app/(app)/projects/[projectId]/project-sidebar.tsx`
Auth helper: `getProjectForUser` — use this in every route handler.
Service client: `createServiceClient()` — Inngest functions only. Use `createClient()` everywhere else.

---

*This file is the ground truth for every agent working on this codebase. If a phase brief contradicts this file, this file wins. If you are uncertain whether something is in scope or meets the quality bar, read the full PRD at `../Discovery-OS-v2-PRD-final.docx` before proceeding.*
