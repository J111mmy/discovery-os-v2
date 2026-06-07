# Claude Code Handoff — Discovery OS (DiscOS)

**For:** Claude Code (CLI), Codex  
**Written by:** Jimmy Keogh via Cowork session, May 2026  
**Purpose:** Full context transfer so Claude Code can pick up all ongoing work without needing to re-derive anything from scratch.

---

## What this product is

**DiscOS** is a cloud-native product discovery platform. It ingests raw customer research — transcripts, Slack exports, research docs, emails — and transforms them into evidence-grounded knowledge using autonomous AI agents. Every claim in every output traces back to an exact customer quote, in an exact source, with a segment ID.

The north star: **traceability is the product.** An insight in a stakeholder deck should link to the sentence a customer said.

The product is live in production. Jimmy is the sole operator. It is heading toward self-serve SaaS with Stripe billing.

**Stack:**
- Next.js 14, TypeScript, Tailwind CSS
- Supabase (Postgres + pgvector + Auth + RLS)
- Inngest (all async AI work — never in Route Handlers)
- Anthropic Claude API (all intelligence — no other LLM)
- Vercel (deployment)

**Repo location:** `Discovery OS/discovery-os-v2/` in the mounted folder.

**Always read `CLAUDE.md` in full before touching any code.** It is the law of the codebase. This handoff gives you context; CLAUDE.md gives you rules.

---

## The three-layer model (non-negotiable)

```
UI Layer        Next.js 14, TypeScript, Tailwind
                Renders state. Surfaces agent output.

Agent Layer     Anthropic Claude API + Inngest
                Does ALL intelligence work: ingest, extract,
                classify, synthesise, verify, draft.

Data Layer      Supabase — Postgres + pgvector + Auth
                Single source of truth. RLS on every table.
```

Route handlers fire events. Inngest functions do AI work. Never run AI in a Route Handler — Vercel will time it out on large inputs.

---

## Current state of the build

### Shipped and working

| Feature | Notes |
|---|---|
| Auth + org/project structure + RLS | All 18 tables have RLS; all policies use `auth_user_org_ids()` |
| Source ingest pipeline (Inngest) | Steps 1–7 work. **Evidence extraction is wrong** — see priority issue below |
| Evidence trust review | trust / exclude / trust-all |
| Source management | `/sources`, delete, retry |
| Artifact library | `/documents`, compose via Inngest |
| Claim citations in artifacts | `[N]` superscript chips linking to exact evidence records |
| Project settings | Frame, operating style, GTM context, research focus |
| Session review | Auto-generated brief after every ingest |
| Action extraction | Personal commitments + product requests from transcripts |
| Frame auto-draft | Drafted from first transcript, Accept/Discard UI |
| Rich people profiles + digests | Synthesised intelligence brief per person |
| Rich company profiles | Same for orgs |
| Rich competitor profiles + battle cards | AI-drafted with human-editable counter field |
| Evidence confidence scoring | 4-signal weighted model in `src/lib/confidence.ts` |
| AI evidence grading (auto-trust) | Grades evidence against research context; auto-trusts 'trusted' grade |
| Ask / query interface | pgvector semantic search + Claude answer with inline citations |
| Intelligence processing UI | `agent_runs` surfaced on source detail pages |
| Super admin system | Cross-org dashboard + impersonation (migration 0020, needs applying) |
| Internal speaker flagging | `affiliation` field; internal turns excluded from evidence |
| Source type dropdown | Human labels: Customer interview, Sales call, etc. |

### ~~What is broken / highest priority fix~~ — RESOLVED (verified 2026-05-31)

> **This section is stale. The evidence-extraction bug it describes is already fixed in the code.** `src/lib/inngest/functions/ingest-source.ts` now does exactly what `CLAUDE.md §3` mandates: deterministic conversation-unit segmentation (`segmentText` → `assignConversationUnits`, with the 800-token safety split), then an **AI extraction pass per conversation unit** (`extract-evidence-NNNN` steps → multiple discrete claims each), plus internal-speaker exclusion, adjacent-project detection, and downstream chaining. Confirmed by reading the file, not the doc.
>
> **Residual refinement (not a blocker):** every claim from a unit is anchored to `unit.segments[0].id` (`ingest-source.ts:955`), not the precise segment it came from. `CLAUDE.md §3` wants `segment_id` to be the exact citation anchor. Track as a citation-precision improvement.
>
> **The real "now" is the security assessment** — see `ROADMAP.md`, which is the source of truth for current priorities.

### Immediate action items

- [x] Apply migration `0020_super_admins.sql` + grant super admin — **done** (Jimmy has `/admin` access as of 2026-05-31)
- [ ] Set Anthropic monthly spend limit at console.anthropic.com → Settings → Limits (2-minute task; needed before *billing*, not before the unpaid Veyor milestone)

---

## Active roadmap items

> **The roadmap lives in `ROADMAP.md` — that is the single source of truth.** This handoff used to duplicate it; the copy has been removed to prevent drift. Read `ROADMAP.md` for current priorities. As of 2026-05-31 the top of it is **Milestone 0 — Veyor as first design-partner org (unpaid)**, gated on an independent Opus-run security assessment, with the entire billing epic deferred until after that milestone.

---

## Discovery data (separate from the app)

The `Discovery OS/` folder (parent of `discovery-os-v2/`) is a separate Obsidian-based knowledge system for Jimmy's product research. It is **not** the app source code. It contains:

- `projects/procurement-tracking/` — the primary active research project
- `_entities/` — competitor and org profiles
- `_kernel/` — taxonomy, operating style, schemas
- `_template/` — project starter template
- `_skills/` — skills for Cowork/Claude Code research workflows

This data layer and the app (`discovery-os-v2/`) are parallel systems. The app ingests research materials; the Obsidian folder is where raw research lives before ingestion.

---

## The procurement tracking project (Jimmy's current research focus)

This is the subject matter Jimmy is researching — a potential product that Veyor (his company) might build.

**Hypothesis:** A procurement tracking product for construction teams — a connected control layer that sits on top of Procore and schedule systems, making long-lead item status, submittal-to-delivery reconciliation, and procurement risk legible without replacing ERP.

**Evidence state (as of May 2026):**
- 9 confirmed problems, 78 evidence records, multiple prototype feedback sessions
- Top problems (high confidence): PROB-001 (manual post-approval tracking in spreadsheets), PROB-006 (manual reconciliation across Procore, P6, submittals)
- Key orgs interviewed: Skanska, JE Dunn, Layton, Turner, HITT, Yates, DataBank
- Two live prototypes: Vercel MVP + Figma market intelligence dashboard
- Strategy thesis: start with enterprise GC PM/director workflow as the wedge; expand to centralised buyer persona once proven

**Active decisions still open:**
- Is the centralised buyer persona (Yates, DataBank) a real secondary wedge or niche?
- Which early adopter profile to target first?
- TAM/SAM/SOM still TBD — needs external sizing research

---

## Key files quick reference

| File | Purpose |
|---|---|
| `discovery-os-v2/CLAUDE.md` | Law of the codebase. Read before anything. |
| `discovery-os-v2/ROADMAP.md` | Live working roadmap. Update when things ship. |
| `discovery-os-v2/CODEX_BRIEF_*.md` | Task-specific build briefs for each major feature |
| `discovery-os-v2/MONETIZATION_REQUIREMENTS.md` | Full billing model spec |
| `discovery-os-v2/SAAS_BILLING_ONBOARDING_REQUIREMENTS.md` | Onboarding + billing UX spec |
| `discovery-os-v2/SECURITY_TECHNICAL_ASSESSMENT_PLAN.md` | Security audit plan (1,381 lines) |
| `discovery-os-v2/ARCHITECTURE_SECURITY_HARDENING.md` | Completed architecture audit results |
| `discovery-os-v2/CODEX_BRIEF_PROJECT_SETTINGS_UX.md` | Settings page UX fixes (new — May 2026) |
| `discovery-os-v2/src/lib/inngest/functions/` | All Inngest agent functions |
| `discovery-os-v2/src/lib/llm/prompts/` | All Claude prompts (versioned) |
| `discovery-os-v2/src/app/api/` | All API Route Handlers |
| `discovery-os-v2/supabase/migrations/` | All schema migrations (numbered) |
| `Discovery OS/projects/procurement-tracking/PROJECT.md` | Research project brief |
| `Discovery OS/projects/procurement-tracking/04_problems/problem_clusters.md` | Synthesised problem landscape |
| `Discovery OS/projects/procurement-tracking/12_strategy/strategy_thesis.md` | Strategic thesis |
| `Discovery OS/_kernel/OPERATING_STYLE.md` | Voice, evidence standards, product principles |

---

## Auth and query patterns

Every protected Route Handler must:
```ts
const { project, membership } = await getProjectForUser(params.projectId);
// throws 401/403/404 automatically if auth fails
```

Every Supabase query must include `org_id` scoping:
```ts
.eq('org_id', membership.org_id)
```

Inngest functions use the service client. API routes use the regular client. Never mix them.

RLS is the safety net, not the only guard. Always filter by `org_id` in queries even though RLS would catch a miss.

---

## Prohibited patterns (from CLAUDE.md — enforce strictly)

- ❌ Word-count or character-count chunking of transcripts
- ❌ Hardcoded model names in product code (use model tier abstraction)
- ❌ Running AI workflows in Vercel Route Handlers (use Inngest)
- ❌ Querying without `org_id` filter
- ❌ `uuid[]` array columns for relationships (use join tables)
- ❌ Collapsing Source → Segment → Evidence into fewer levels
- ❌ Creating evidence records without a `segment_id` FK
- ❌ Sending `raw_content` to any LLM or embedding API

---

## Model tier abstraction

Do not hardcode model names. Use the tier abstraction in `src/lib/llm/`:

| Tier | Use for |
|---|---|
| `cheap` | Classification, grading, short extraction (grade-evidence, action-extraction) |
| `standard` | Evidence extraction, session review, ask queries |
| `premium` | Synthesis, PRD generation, GTM packs, strategic artifacts |
| `eval` | Claim verification, meta-review |

---

## Naming conventions (schema alignment — from CLAUDE.md §3b)

Use these exact names everywhere:

| Use | Not |
|---|---|
| `segment_id` (FK on evidence) | `source_segment_id` |
| `skill_configs` | `agent_configs` |
| `trusted \| pending \| excluded \| disputed` | any other trust scope values |
| `transcript \| document \| note \| web` | `interview \| call_recording \| internal` (legacy) |

---

## How to start a session

1. Read `CLAUDE.md` fully — not optional
2. Check `ROADMAP.md` for current active items
3. Pick up the relevant `CODEX_BRIEF_*.md` for the task
4. Run `python3 scripts/check_discovery_integrity.py` if working on data/schema
5. Check `supabase/migrations/` for the highest migration number before creating a new one
6. Never create a migration without verifying the previous one was applied

---

## Research workflow (for Cowork/research tasks, not app builds)

The Discovery OS Obsidian skills live in `Discovery OS/_skills/`. The key ones:

| Skill | What it does |
|---|---|
| `ingest` | Raw source → evidence records |
| `synthesise` | Evidence → problem clusters |
| `synthesise-market-strategy` | Market model, competitive position, strategic thesis |
| `generate-prd` | PRD from problem registry |
| `build-gtm` | GTM pack from strategy layer |
| `competitive-intel` | Competitor research via web |
| `session-review` | Human-readable brief from a single interview |
| `extract-actions` | Action items and product requests from calls |

Run `/new-project [name]` to start a new research project. Fill `PROJECT.md` before ingesting any transcripts.

---

## Contact and access

- **Jimmy's email:** onetendegrees@gmail.com
- **Vercel MVP (prototype):** https://veyor-procurement-mvp-jimmyk-rgbs-projects.vercel.app/procurement
- **Figma market intelligence dashboard:** https://design-proof-42511936.figma.site/
- **Supabase:** Access credentials in `discovery-os-v2/.env` (not committed — local only)
- **Anthropic Console:** console.anthropic.com — Jimmy has access; set spend limit before billing goes live

---

## What Jimmy wants from Claude Code sessions

1. **App build work:** Pick up `CODEX_BRIEF_*.md` files and implement them cleanly. Follow CLAUDE.md. Write migrations before code. Run `check_discovery_integrity.py` on completion.
2. **Research work:** Use the `_skills/` layer to ingest transcripts, synthesise evidence, and generate artifacts for the procurement tracking project.
3. **Both simultaneously:** The app build and the research content are parallel workstreams. Jimmy will specify which he wants in each session.

The most important thing: **read evidence before making claims, write migrations before writing code, and mark ROADMAP.md when things ship.**

---

*Generated from Cowork session — May 2026. Update this file whenever the project state changes significantly.*
