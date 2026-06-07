# PRD — Competitive Intelligence: Automated Watch / Scan / SWOT Layer

**Status:** Backlog / deferred (logged as GitHub issue — see below)
**Author:** Assessor (Sonnet)
**Date:** 2026-06-04
**For:** Opus-Build (prioritisation + sequencing)
**Decision origin:** Jimmy, 2026-06-04 — "hold off on the competition stuff and make a solid PRD for down the line… weekly scans online, SWOT analyses, etc."

> This PRD captures a *proven* desktop capability so it isn't lost while we defer it. Nothing here is being built now. It is reversible: pulling it forward is a prioritisation call, not a re-discovery effort.

---

## 1. One-liner

Give the Vercel app the desktop's **active competitive-research engine**: scheduled + trigger-driven competitor sweeps that pull fresh external signal, regenerate SWOTs / battle cards / landscape views, and keep a per-competitor watch register current — all under the propose→approve→provenance contract.

## 2. Why defer, why capture now

**Why defer (the call is correct):**
- It is the **heaviest** missing capability — it needs scheduled jobs, *external web research*, a watch-register data model, multi-mode cadence, and SWOT/landscape generators.
- It is the **least blocking** for the near-term goal (validate the proposal-contract spine on #10/#18, ship artifact governance, recruit design partners). You do not need automated competitor scanning to land design partners.
- Its hardest prerequisite — **external web-research connectors** — does not exist in Vercel yet and shouldn't sit on the critical path.

**Why capture now:**
- This is the desktop's most *proven* cascade: ~14 populated competitor profiles + a live watch register with real scheduled sweeps. There is a concrete spec to port, not a hypothesis.
- Deferring without a PRD is how capabilities silently disappear (cf. the ingest Step 17 GTM cascade, which sat as a pending amendment and never landed).

## 3. What ALREADY exists in Vercel (do NOT rebuild)

`src/lib/inngest/functions/synthesise-competitor.ts` already provides:
- On-demand competitor **digest** + 5-field **battle card** (3 AI-generated fields).
- Org-wide evidence pull (competitor evidence across all projects).
- `positioning`, `known_strengths`, `known_gaps`, `last_researched` fields.
- Fires from `extract-entities` or on demand; follows the propose pattern; logs to `agent_runs`.

**So the foundation — competitor entity, digest, battle card — ships today.** What's missing is the *active-research and cadence layer* on top.

## 4. Desktop reference (the proven spec to port)

Source of truth: `_skills/competitive-intel/SKILL.md`, `_learnings/competitor-profiles/` (~14 profiles), `_learnings/competitor-profiles/competitive-watch-register.md` (live, with dated weekly sweeps).

**Five research modes:**
1. **Web Research** — official + third-party source pack → `site-analysis`, `feature-analysis`, `linkedin-analysis`, `swot`, and (for important competitors) `complete-analysis-YYYYMMDD`.
2. **Product Surface Audit** — legacy pages, stale pricing, name mismatches, app-store seller names, product-lineage clues. (Highest-value insight mode.)
3. **Customer Mentions** — competitor named in an interview → strengths/weaknesses/switch-triggers as EVD. *(Largely already covered by Vercel ingest evidence extraction — see Non-goals.)*
4. **Win/Loss** — stated vs. assessed reason; recurring patterns promote to a PROB. *(Partially covered by existing evidence/problem flow.)*
5. **Competitive Landscape Snapshot** — group by category/workflow; who's strongest where; tied to evidence.

**Cadence (multi-mode — this is the corrected picture):**
- Threat-tiered re-research: `CRITICAL`→30d, `HIGH`→90d, `MEDIUM`→180d, `LOW`→365d.
- A **weekly sweep heartbeat** (observed in the live watch register).
- **8 immediate-escalation triggers:** new funding, new customer announcement, new marketplace listing, significant hiring change, app-store launch, sudden review-volume appearance, customer mention in a live deal, major contradiction / public-surface cleanup.

**Evidence discipline:** 6-tier source hierarchy; every claim labelled `EVIDENCED` / `INFERENCE` / `SECOND-HAND`; contradictions recorded and dated, not smoothed. Closes the learning loop into the watch register + operation logs.

## 5. Scope — IN

- **(A) Watch-register data model** — per-competitor `threat_level`, `next_review_date`, `last_researched_at`, `watch_signals`, contradiction log.
- **(B) Scheduled sweeps** — Inngest cron: weekly heartbeat + per-competitor threat-tiered scheduling. (Precedent exists: `weeklyProjectSynthesis`.)
- **(C) Immediate-trigger escalation** — event-driven re-research on the 8 triggers.
- **(D) Active external web research** — Modes 1 & 2. **The hard dependency** (see §7).
- **(E) SWOT generation** — `swot` as an artifact type, on cadence + on demand.
- **(F) Battle-card refresh on cadence** — generator exists; add scheduling + staleness flag.
- **(G) Competitive landscape snapshot** — Mode 5, as a project-strategy artifact.
- **(H) Source-hierarchy + EVIDENCED/INFERENCE/SECOND-HAND labelling** preserved through to any downstream surface; provenance via the proposal contract.

## 6. Scope — OUT / non-goals

- **Rebuilding competitor digests / battle cards** — already shipped (§3).
- **Customer-mention & win/loss capture (Modes 3/4)** — largely covered by existing Vercel ingest evidence extraction + problem flow; revisit only for gaps, don't duplicate.
- **Product telemetry monitoring** (`monitor-signals`: Datadog/FullStory/Sentry → SIG records → weekly digest) — a *separate* deferred capability (V2 §6 P2-2). Not part of this PRD despite the "weekly digest" surface similarity.

## 7. Hard dependencies / prerequisites (the reason this is deferred)

1. **External web-research capability** — connectors / web-fetch / search. Vercel has none today. **This is the blocker.** (V2 §6 P2-3.)
2. **Scheduled-jobs infra** — Inngest cron exists ✓ (`weeklyProjectSynthesis` precedent).
3. **Proposal-contract spine** — in flight (#18). Needed so AI-generated competitive claims are propose→approve→provenance, never silent writes.
4. **Cost ceiling / run policy** — web research × N competitors × cadence = real recurring LLM + fetch spend. A per-sweep cost cap is mandatory before enabling. (V2 P2-1 `skill_configs`.)

## 8. Data-model sketch (for Codex, later — not final)

- `competitors` additions: `threat_level` (enum), `next_review_date`, `last_researched_at`, `watch_signals` (jsonb).
- Reuse `agent_runs` / future `workflow_runs` for sweep observability (don't invent a parallel log).
- New artifact types: `swot`, `competitive_landscape`.
- Contradiction log table or jsonb on the competitor record (dated entries).

## 9. Cadence rules (configurable)

Defaults as §4; all tunable via `skill_configs` (V2 P2-1). Weekly heartbeat + threat-tiered scheduling + 8 immediate triggers should be independently toggle-able. Design must support configurable cadence, not hard-code one interval.

## 10. Open questions (for Build / Jimmy)

- Which web-research connector(s)? (Search API, headless fetch, a managed research provider?)
- Cost ceiling per sweep, and global monthly cap?
- Auto-research-then-propose, or propose-then-research-on-approve?
- How much of Modes 3/4 is *already* covered by current ingest — confirm before scoping any new capture.
- Auto-escalation: fully automatic re-research, or queue a suggestion for the user?

## 11. Build-sequencing recommendation

**After** the proposal-contract spine + artifact governance + external connectors land. **Not** milestone-0. Sensible order once picked up: connectors (P2-3) → watch-register model + cron scheduling → web-research modes → SWOT/landscape generators → cadence config + triggers.

## 12. Provenance / security note

External-sourced claims must carry `EVIDENCED` / `INFERENCE` / `SECOND-HAND` labels end-to-end. Any automatic web-fetch + auto-write path needs an **Opus security review** (per DESIGN_BRIEF Gate 3 — AI mutating user data needs auth + provenance review). Codex authors; Opus reviews; Jimmy steers.

---

*Maps to: V2 capability assessment §6 P1-5 (competitive intel cascade) + P2-3 (connectors). Supersedes the thin treatment there with a full spec.*
