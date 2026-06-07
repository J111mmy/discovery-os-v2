# Assessor → Opus-Build — Handoff, 2026-06-04

**From:** Assessor (Sonnet) · **To:** Opus-Build · **Re:** competition deferral + V2 assessment open items

This is the assessor's routing channel. I don't build; I assess, write these handoffs, and log anything we're consciously not building as a GitHub issue so it can't quietly disappear.

---

## 1. DECISION LOGGED — defer the competitive-intel automated layer

**Jimmy's call (2026-06-04):** hold off on "the competition stuff" (weekly online scans, SWOT analyses, the watch cadence) and capture it in a proper PRD for later.

**Actions taken:**
- GitHub issue **#19** created — `Backlog: competitive intelligence — automated watch/scan/SWOT cadence layer` (label: `enhancement`).
- Full spec written: **`PRD_COMPETITIVE_INTEL.md`** (repo root).

**Scope clarity (important — don't over-read the deferral):**
- **Deferred:** the *active-research + cadence* layer — scheduled sweeps, external web research, SWOT/landscape generation, threat-tiered re-research + immediate triggers, the watch register.
- **Stays (already shipped):** `synthesise-competitor.ts` — on-demand competitor digest + battle card. Not touched.
- **Separate item, also deferred:** `monitor-signals` (product telemetry: Datadog/FullStory → SIG → weekly digest). Maps to V2 P2-2. Not part of #19.
- **NOT deferred:** the **GTM asset cascade / "GTM contract" governing-doc pattern** (V2 P1-4) — Jimmy explicitly values this (central contract → downstream sales-enablement/CS/support/marketing, with staleness propagation). Keep it on the table; it is a different thing from competitive intel.

**Why the deferral is sound:** heaviest capability, least near-term-blocking, and its hard prerequisite (external web-research connectors) doesn't exist yet and shouldn't sit on the critical path. Fully reversible — pulling it forward is a prioritisation call, not a re-discovery effort.

---

## 2. V2 ASSESSMENT — open items needing your direction

`DESKTOP_VS_VERCEL_CAPABILITY_ASSESSMENT_V2.md` has two buckets of pending changes.

### 2a. Four verified factual corrections (undisputed — verified against ground truth)
These are wrong in the current V2 and should be patched regardless of build order:
1. **verify-claims is a post-hoc AUDITOR, not a blocking gate.** (`verify-claims.ts:142–146`; runs *after* content is saved, no preflight/distribution block.) V2 overstates it as an "automated Evidence Gate / stronger than desktop."
2. **Ingest Step 17 (GTM cascade) is NOT built** — it's `status: pending-incorporation` and absent from the canonical `ingest/SKILL.md`. V2 says "built." Correct to "specified, not built — on neither side."
3. **Competitive cadence is multi-mode, not "quarterly."** (`competitive-intel/SKILL.md:238–254` + live watch register: weekly heartbeat + threat-tiered 30/90/180/365 + 8 immediate triggers.) V2 over-corrected to quarterly.
4. **GTM catalogue count inconsistency:** catalogue says "27 asset types," `gtm_asset_types.csv` has 25 rows. Flag + clean before productising.

### 2b. Structural changes pending build-order lock (Codex review in flight)
- Promote the **proposal contract** to **P0A** — it's already LOCKED in `DESIGN_BRIEF_AI_ASSISTED_EDIT.md` and, per the issue tracker, **already in flight** (#18 "AI Improve", plus #14–#17 document surface). V2 currently buries it under P2.
- Add **`workflow_runs`** as the product-facing parent of `agent_runs` ("this upload created 18 evidence, 4 actions, 2 problems…").
- **Unbundle** typed output recipes from DOCX/PPTX export.
- Thicken **evidence-packs** to immutable snapshots (query/filter, trust-scope-at-generation, excluded count, version/hash, created_by).
- Define a **`skill_configs`** PRD.
- One open disagreement with Codex (#9): bind GTM gating to **`distribution_scope`** (public/prospect assets gate on validation; internal/sales-1:1 run in parallel), not a global phase order.

### Decision I need from you
How do you want V2 reconciled?
- **(a)** I apply the four factual corrections now; hold 2b until the build order is locked with Codex.
- **(b)** Full V2 rewrite now incorporating 2a + 2b (except the open #9).
- **(c)** Hold all V2 edits until Codex replies, then one consolidated pass.

My recommendation: **(a) now, (b) after Codex confirms** — stop V2 being factually wrong immediately, but don't re-sequence the proposal-contract spine twice.

---

## 3. Standing process (assessor)

- I route decisions and findings to you via `ASSESSOR_TO_BUILD_*.md` handoffs.
- Anything we decide not to build now → a GitHub issue (Backlog-prefixed) + a PRD if it's a real capability, so it survives.
- Security reviews go to **Opus**, not Codex (Codex authored the backend; can't sign off its own work). Per DESIGN_BRIEF Gate 3, the proposal-contract + any auto-write/web-fetch path needs Opus sign-off.
