# DiscOS Roadmap

Live working document. Move items up or down freely — this is the conversation surface, not a contract.

Each item has a rough size: **S** (one session), **M** (2–3 sessions), **L** (week+).

---

## Status key

| Symbol | Meaning |
|---|---|
| ✅ | Done |
| 🔄 | In progress |
| 🔜 | Next up |
| 💡 | Idea / not yet scoped |
| ⏸ | Parked — good idea, low priority right now |

---

## Immediate actions required from Jimmy

These are not build work — they are operational steps needed right now before the system works fully.

- [ ] Run migration SQL: `0017_actions_and_requests.sql` — creates `actions` and `product_requests` tables with RLS
- [ ] Run migration SQL: `0018_competitor_digest.sql` — adds `digest`, `digest_updated_at`, `battle_card` to competitors table
- [ ] `git add -A && git commit -m "feat: competitor profiles backend" && git push`
- [ ] Hand `CODEX_BRIEF_COMPETITOR_UI.md` to Codex

---

## Now — active build

### ✅ Internal speaker flagging (backend)
**What was built:** `affiliation` field on people table, ingest pipeline now queries internal people before extraction and passes them to Claude so their turns are treated as context, not evidence. New source types (`customer_interview`, `sales_call`, `usability_study`, `internal_meeting`) parse as conversations. Ingest API route updated to accept new values.

### ✅ Internal speaker flagging (UI) + source type dropdown
**What was built (Codex, 31cc401):** Affiliation badge on people list, one-click affiliation toggle on person detail page, source type dropdown updated to human labels (`Customer interview`, `Sales call`, etc.), `PATCH /api/people/[personId]/affiliation` with org_id guard.

---

## Next — high priority

### 🔜 Architecture, reliability, and security hardening
**Why:** The 3-layer model (database → AI agents → UI) is the right architecture for DiscOS and reusable for other stateful intelligence products, but the implementation now has enough agents and data surfaces that product quality depends on making it observable, secure, and boringly reliable.
**What:** Run a full cross-system sanity check covering data flow, agent event graph, idempotency, Supabase RLS, service-role usage, Inngest signing, LLM payload/redaction boundaries, route/server action auth guards, and end-to-end failure states. Turn the results into fixes, not just notes.
**Key concerns to sort:**
- Agent sprawl: document every event, trigger, downstream job, read/write table, idempotency rule, and retry/replay behavior.
- Observability: expose `agent_runs` in the app so a user can see whether ingest, synthesis, actions, digests, compose, and verification are queued, running, skipped, failed, or done.
- Security: audit every query for `org_id`, every RLS policy, every service-role use, every invite/team path, and every Inngest/API boundary.
- LLM data safety: prove PII redaction and raw-source boundaries before every model call; map what each agent sends to external providers.
- Regression tests: build golden transcript fixtures so evidence quality, entity extraction, session review, action extraction, and synthesis cannot silently degrade.
- Shared query helpers: consolidate repeated project/source/person/company/evidence queries so auth and `org_id` filtering stay consistent.
**Reference:** See [ARCHITECTURE_SECURITY_HARDENING.md](ARCHITECTURE_SECURITY_HARDENING.md).
**Size:** L

### ✅ Rich people profiles
**What was built:** `synthesise-person.ts` Inngest function, `person-digest-v1` prompt, migration 0014, `POST /api/people/[personId]/synthesise`. UI shipped by Codex (8b19ede): "Intelligence brief" section on person detail page, `DigestRefreshButton` client component, date of last generation shown.

### ✅ Rich company profiles
**What was built:** `synthesise-company.ts` Inngest function, `company-digest-v1` prompt, migration 0016. UI shipped by Codex (a0e2e4b + 139da19): company detail page with digest, people roster, project links, evidence mentions, Refresh digest button. Person detail pages now link company names through to the company profile.
**Architecture note:** Company detail page fetches via `GET /api/companies/[companyId]` (API route + server component both query the same shape). Fine for now; worth consolidating into a shared server helper once this layer settles.

### 🔄 Rich competitor profiles + battle cards
**Backend done:** `synthesise-competitor.ts` Inngest function, `competitor-digest-v1` prompt, migration 0018, `POST /api/competitors/[competitorId]/synthesise`. Auto-triggered from `extract-entities` after each ingest. Battle card AI-fills `their_pitch`, `where_they_win`, `their_gap`; user fills `your_counter` and `one_proof_point` in the UI.
**UI brief written:** `CODEX_BRIEF_COMPETITOR_UI.md`
**Remaining:**
- Competitor detail page (digest, battle card with editable counter/proof fields, evidence list, customers who mentioned them)
- Win/loss records: after a deal involving a competitor, log why you won or lost and which gap was decisive
**Size:** M

### ✅ Compose via Inngest
**What was built:** `compose-artifact.ts` Inngest function. Route handler creates stub artifact, fires `artifact/compose.requested`, returns `artifact_id` immediately. Editor polls `/api/artifacts/[id]/status` every 2 seconds until done or failed. No timeout risk on large evidence sets.
**Size:** M

### ✅ Session review skill
**What was built:** `session-review.ts` Inngest function, `session-review-v1` prompt, chained from ingest. 6-section narrative brief: Summary / What they want / Product reactions / Friction / Notable quotes / Follow-up. UI shipped by Codex (852f6ff): session brief card on source detail page, artifact detail page with markdown rendering.

---

## Medium priority

### 🔄 Action extraction
**Why:** Every interview contains personal commitments ("I'll send you X") and product backlog requests ("I wish it could do Y"). These should be captured automatically, not lost in the transcript.
**Backend done:** `extract-actions.ts` Inngest function, `action-extraction-v1` prompt, migration 0017 (`actions` + `product_requests` tables with RLS). Chained from ingest — fires `source/actions.requested` after every ingest with evidence. Idempotent (deletes existing rows for source before re-inserting). Uses `cheap` LLM tier.
**UI brief:** `CODEX_BRIEF_ACTION_EXTRACTION_UI.md` — actions checklist on source detail page + product requests list on project overview.
**Size:** S (backend done)

### ✅ Frame auto-generation from first transcript
**What was built:** `draft-frame.ts` Inngest function, `frame-draft-v1` prompt, migration 0015 (`frame_draft` jsonb + `frame_draft_generated_at` on projects), chained from `ingest-source`. UI shipped by Codex (8b19ede): draft banner in project settings (the app's frame surface) with Accept/Discard controls. `PATCH /api/projects/[projectId]` updated to accept partial updates safely, fixing a latent bug where omitted fields could null settings.
**Size:** S

### 💡 Adjacent signal routing UI
**Why:** When Claude detects that a signal from one transcript is relevant to a different project, it sets `adjacent_project_hint` in the evidence metadata. But there's no UI to surface or act on this.
**What:** On the evidence detail page and workspace overview, show "Signal relevant to: [Project Name] →" with a one-click route button that copies the evidence reference to the other project.
**Size:** S

### 💡 Claim citations in composed artifacts
**Why:** Traceability is the product. Every customer quote in a composed document should show a citation chip that links back to the exact source segment. Currently artifacts are plain text.
**What:** Artifact render component parses citation markers in Claude output. Each citation renders as a chip: "[EVD-001]" → hover/click shows the quote, source title, speaker, and timestamp. Links through to the evidence detail page.
**Size:** M

### ✅ Evidence confidence scoring improvements
**What was built:** `src/lib/confidence.ts` utility with four weighted signals: evidence depth (30pts), source diversity (30pts — 4 sources from different sessions > 30 records from 1 source), recency (20pts — decays from 30→60→90→180 days), synthesis breadth (20pts — themes + problems). Project overview updated to use the new model. Weakest signal drives the "Next:" coaching hint.

### 💡 Ask / query interface improvements
**Why:** The `/ask` page exists but the query pipeline isn't sophisticated. Natural language questions should produce sourced answers with cited evidence, not just retrieved records.
**What:** Improve the RAG pipeline — retrieve semantically relevant evidence, pass to Claude with the question, get a sourced narrative answer with inline citations. Show sources as collapsible evidence cards below the answer.
**Size:** M

### 💡 Org settings — output preferences and compliance controls
**Why:** Different orgs have different house styles and legal obligations. A B2B SaaS team may want em-dash-free output. An org handling EU customer data may need GDPR-compliant anonymisation. These should be configurable per org, not hardcoded.
**What:** `org_settings` table (jsonb blob, keyed by setting name). Settings UI at `/settings/org` accessible to owners/admins. Initial settings:
- **Writing style** — "No em dashes in AI output", preferred punctuation style, tone (formal / neutral / conversational)
- **GDPR / compliance mode** — when enabled: (a) all new evidence is anonymised before storage (speaker names replaced with roles, e.g. "Participant A"), (b) people records cannot store real names without explicit consent flag, (c) exports include a data-subject disclaimer
- **Participant anonymisation** — manual toggle per person: replaces their name in all rendered evidence with "Participant [N]" without altering the underlying record (display-layer only, reversible)
- **Data residency reminder** — informational flag noting which Supabase region the org's data is in (read-only, no enforcement needed yet)

Settings are read by the LLM prompt builder at compose and ingest time. Writing style prefs go into the system prompt. Compliance mode triggers a separate anonymisation pass before evidence is stored.
**Size:** M

---

## Lower priority / future

### ⏸ GTM cascade
**Why:** After each ingest, beta candidate signals and outreach gaps should propagate automatically to GTM artifacts. Important for closing the loop from discovery to sales motion.
**What:** After ingest, check for positive evidence with beta interest signals → update beta candidate table → flag missing outreach drafts → optionally sync to CRM/Confluence.
**Size:** L

### ⏸ Skill configs in database
**Why:** Agent prompts should be overridable per org without a code deploy. Currently all prompts are hardcoded in `src/lib/llm/prompts/`.
**What:** `skill_configs` table. Resolution order: org override in DB → code default. UI for prompt editing (admin only). Prompt version tracking so stale overrides are flagged when the code default changes.
**Size:** M

### ⏸ Meta-review / self-improvement loop
**Why:** The system should learn from corrections. If Jimmy consistently edits Claude's output in a certain way, that pattern should surface as a proposed prompt improvement.
**What:** Monthly scheduled Inngest job reads `agent_runs` logs, clusters correction patterns, surfaces proposals to the user. Approved changes update `skill_configs`. Nothing auto-applies.
**Size:** L

### ⏸ Agent observability dashboard
**Why:** When a workflow feels stuck, users should not have to inspect terminal output or Inngest manually. The app should explain what happened.
**What:** Project/source-level processing timeline backed by `agent_runs`: job name, status, started/completed times, output counts, errors, skipped reasons, and safe retry buttons. This should cover ingest, session review, action extraction, synthesis, gap detection, compose, verification, and profile digests.
**Size:** M

### ⏸ Schema reconciliation migration
**Why:** CLAUDE.md flags several naming inconsistencies: `source_segment_id` vs `segment_id`, legacy source kind values, `frame` still as text not jsonb. These don't break anything yet but will cause confusion as the schema grows.
**What:** Migration that aligns column names with the canonical spec. Requires coordinated update of all TypeScript types, API routes, and Inngest functions that reference the changed columns.
**Size:** M (careful — touching many files)

### ⏸ Prototype and testing tracking
**Why:** Phases 5–6 of the discovery loop (Ideas → Prototyping → Testing) have no schema yet. Concepts, prototypes, and test results need to live somewhere.
**What:** `prototypes`, `concepts`, `test_sessions` tables. Prototype feedback ingest variant that captures both evidence AND test result records from the same session.
**Size:** L

### ⏸ Linear and Jira connectors
**Why:** Action extraction is useful standalone, but the real value is when personal commitments route to Linear and product requests route to Jira Product Discovery automatically.
**What:** Plugin/MCP connector for both. Sync is additive — if connectors unavailable, save locally and show "External Sync Pending."
**Size:** L

### ⏸ Post-launch monitoring loop
**Why:** Usage signals from live products should route back into discovery automatically. Phase 11 in the spec — closes the loop.
**What:** Monitoring source type ingestion. Usage data pulled from product analytics tools and treated as evidence with its own classification. Feeds back into synthesis alongside interview evidence.
**Size:** L

---

## Decisions and open questions

| Question | Status |
|---|---|
| Should internal meeting evidence be stored at all, or excluded entirely? | Open — currently excluded from evidence but could be stored as `classification: internal_signal` |
| Should the session review brief replace the evidence count on source cards, or sit alongside it? | Open |
| Prototype and concept tracking: build now or wait until evidence quality is solid? | Parked — evidence quality first |
| Should competitor battle cards be manually authored, AI-drafted, or both? | Open — leaning AI-drafted with human review |
| Should `frame` be converted from text to jsonb now or wait for schema reconciliation? | Open — doing it mid-project is risky; lean toward waiting |

---

*Last updated: May 2026. Maintained alongside CLAUDE.md — if a feature is built, mark it ✅ here.*
