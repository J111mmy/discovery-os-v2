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

- [ ] Run migration SQL in Supabase SQL Editor: `0012_fix_org_members_rls.sql` — fixes "infinite recursion" error blocking document saves
- [ ] `rm .git/HEAD.lock` then `git add -A && git push` — pushes several pending bug fixes (gap_signals resilience, pdf-parse fix, entity extraction graceful failure, sources page UX)
- [ ] In Supabase Table Editor: confirm `gap_signals` and `gaps_detected_at` columns exist on the `projects` table (from migration 0011). If not, run `0011_gap_signals.sql`

---

## Now — active build

### 🔄 Internal speaker flagging (backend)
**Why:** Jake from sales shouldn't produce customer evidence. Internal speakers should be flagged once globally so every future ingest across every project treats their speech correctly — as context, not evidence.
**What:** `affiliation` field on the `people` table (`internal | external | unknown`). When set to `internal`, Claude receives a list of known internal speakers before extraction and treats their turns as context-setting rather than evidence.
**Size:** S

### 🔜 Internal speaker flagging (UI) — Codex
**Why:** Same as above — the backend is only useful if Jimmy can actually flag people.
**What:** Affiliation badge on people list and detail pages. One-click toggle to mark someone as internal. Shows "Internal" pill in yellow on the person card. No migration needed (backend handles schema).
**Size:** S

### 🔜 Source type extension — Codex
**Why:** "transcript", "document", "other" aren't meaningful categories. A usability study is different from a sales call — Claude should know.
**What:** Extend `source_type` enum to: `customer_interview | sales_call | usability_study | internal_meeting | document | note | survey | support_ticket | other`. Update the ingest form dropdown. Pass source type to the extraction prompt so Claude frames its reading correctly.
**Size:** S

---

## Next — high priority

### 🔜 Rich people profiles
**Why:** A stream of evidence isn't digestible. Jimmy needs to look at Jake Chen and understand at a glance: who he is, his company, his status (prospect → interviewed → beta candidate), every project he's appeared in, and a synthesised digest of what he's said.
**What:**
- Person detail page: header (name, role, company, affiliation, status), cross-project involvement, AI-generated digest of their key perspectives, all linked evidence records
- Synthesis agent run per person on demand (or after each ingest that involves them)
- Status progression visible: prospect → interviewed → concept-shown → beta-candidate → customer
**Size:** M

### 🔜 Rich company profiles
**Why:** "AECOM" is just a name right now. The company page should show every person spoken to from that org, a summary of their collective feedback, their involvement across projects, and their overall relationship signal.
**What:**
- Company detail page: header (name, domain, industry), people roster from that company, cross-project involvement, synthesised perspective digest, linked evidence
**Size:** M

### 🔜 Rich competitor profiles + battle cards
**Why:** Competitors are mentioned in interviews. That intelligence should accumulate into actionable competitor profiles and eventually battle cards.
**What:**
- Competitor detail page: positioning (sourced), where they win (with evidence), their known gaps (with evidence), which customers mentioned them and what they said
- Battle card format: Their Pitch / Where They Win / Their Gap / Your Counter / One Proof Point
- Win/loss records: after a deal involving a competitor, log why you won or lost and which gap was decisive
**Size:** M

### 🔜 Compose via Inngest
**Why:** Compose currently runs in a Vercel Route Handler. On large evidence sets (50+ records) it will hit the 60-second timeout limit. Moving it to Inngest makes it durable — the same pattern as ingest.
**What:** `artifact/compose.requested` Inngest event. Route handler fires event, returns `artifact_id`. UI polls `/api/artifacts/[id]/status`. Compose function runs as Inngest steps: fetch-evidence → draft → save.
**Size:** M

### 🔜 Session review skill
**Why:** After every interview, you want a human-readable brief — not just evidence records. "What was discussed, key quotes, what they want, what they thought of the prototype." Designed to be read by a human, shareable.
**What:** Inngest function triggered after ingest. One Claude call that reads all evidence from a source and writes a structured narrative brief. Saved as an artifact linked to the source.
**Size:** S

---

## Medium priority

### 💡 Action extraction
**Why:** Every interview contains personal commitments ("I'll send you X") and product backlog requests ("I wish it could do Y"). These should be captured automatically, not lost in the transcript.
**What:** Inngest function after ingest. Claude reads evidence and extracts: (a) interviewer commitments → personal action records, (b) participant feature requests → product request records linked to evidence. Optional sync to Jira Product Discovery or Linear.
**Size:** S

### 💡 Frame auto-generation from first transcript
**Why:** The project frame (problem, hypothesis, buyers, research areas) is currently blank until Jimmy writes it. After the first ingest, Claude has enough to propose a draft.
**What:** After first ingest, if `projects.frame` is null, fire a frame-draft event. Claude reads the evidence and proposes: "Based on this interview, it sounds like you're investigating X with Y personas. Here's a draft frame — edit anything wrong." User accepts, edits, or ignores.
**Size:** S

### 💡 Adjacent signal routing UI
**Why:** When Claude detects that a signal from one transcript is relevant to a different project, it sets `adjacent_project_hint` in the evidence metadata. But there's no UI to surface or act on this.
**What:** On the evidence detail page and workspace overview, show "Signal relevant to: [Project Name] →" with a one-click route button that copies the evidence reference to the other project.
**Size:** S

### 💡 Claim citations in composed artifacts
**Why:** Traceability is the product. Every customer quote in a composed document should show a citation chip that links back to the exact source segment. Currently artifacts are plain text.
**What:** Artifact render component parses citation markers in Claude output. Each citation renders as a chip: "[EVD-001]" → hover/click shows the quote, source title, speaker, and timestamp. Links through to the evidence detail page.
**Size:** M

### 💡 Evidence confidence scoring improvements
**Why:** The current confidence bar uses simple counts (20 trusted records = full score). It should reflect source diversity, coverage of research areas, and recency — not just volume.
**What:** Update the confidence calculation in the project overview to weight source diversity (3 sources > 30 records from 1 source), research area coverage (which frame areas have evidence), and recency (evidence older than 90 days decays slightly).
**Size:** S

### 💡 Ask / query interface improvements
**Why:** The `/ask` page exists but the query pipeline isn't sophisticated. Natural language questions should produce sourced answers with cited evidence, not just retrieved records.
**What:** Improve the RAG pipeline — retrieve semantically relevant evidence, pass to Claude with the question, get a sourced narrative answer with inline citations. Show sources as collapsible evidence cards below the answer.
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
