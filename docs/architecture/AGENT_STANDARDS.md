# Agent Standards — DiscOS LLM agents

> **Status: canonical and enforced.** These rules govern every Inngest function that makes an LLM call (`src/lib/inngest/functions/*.ts`). They are referenced from `CLAUDE.md` (cost-safety law) and enforced mechanically by the agent-standards CI guard (see [Enforcement](#enforcement)). A doc nobody enforces is worthless — that is why every rule here maps to a check that breaks the build, not to a reviewer's memory.
>
> **Why this exists:** on 2026-06-28, three premium agents shipped the same cost/latency landmine (16k `maxTokens` default + no cap + `retries: 2` + a timeout longer than the platform cap). One of them burned ~$2 on a single *failed* run. The bug passed human review twice. Memory and review are not a control. Standards must be enforced by code.

---

## The platform constraint

The app runs on **Vercel Hobby: a hard 60-second cap per function invocation.** Every Inngest step runs as its own invocation. So **no single step may contain an LLM call that can take 60s or longer.** This is the constraint every rule below serves.

## Model tiers (`src/lib/llm/models.ts`)

| Tier | Default model | Default `maxTokens` | Use for |
|---|---|---|---|
| `cheap` | Haiku 4.5 | 1024 | classify, tag, grade, small extraction |
| `standard` | Sonnet 4.6 | 2048 | ingest, entities, summaries, frame drafts |
| `premium` | Sonnet 4.6 (or env `ANTHROPIC_PREMIUM_MODEL`) | **16000** | final prose, synthesis, problem/opportunity generation |
| `eval` | Sonnet 4.6 | 2048 | claim verification, scoring |

> ⚠️ The premium default of **16000** output tokens is the single biggest footgun. A premium call allowed to emit 16k tokens **cannot reliably finish inside 60s**, and bills up to 16k output tokens whether or not you use them. Premium calls **must** override `maxTokens` down to what the output actually needs. See R2.

---

## The rules

Each rule states the requirement, the reason, and how it is enforced.

### R1 — One LLM call per step must fit under 60s
Heavy generation MUST be chunked into multiple sub-60s `step.run` calls. Bound the unit of work in **every** dimension that affects latency — input size, **output token budget**, and model speed — not just the obvious one. (The 2026-06-28 miss: we chunked *input* themes but left *output* at 16k, so it still timed out.)
**Enforced by:** CI guard rejects a premium-tier LLM call whose effective `maxTokens` (override or tier default) could not plausibly complete in 60s; golden smoke eval fails on any `FUNCTION_INVOCATION_TIMEOUT`.
**Reference pattern:** `generate-opportunities.ts` / `discover-problems.ts` batch loops.

### R2 — Premium calls MUST cap `maxTokens` to the real output need
Never inherit the 16k premium default. Pass an explicit `maxTokens` sized to the payload (e.g. ~3000–4000 for a batch of 1–4 JSON problems). This makes generation fit under 60s **and** caps worst-case cost per call.
**Enforced by:** CI guard fails the build if a `tier: "premium"` call has no `maxTokens` override.

### R3 — Timeout must be below the platform cap
Any `timeoutMs` ≥ 60_000 is a defect: the platform kills the invocation at 60s first, so the budget is fiction and only adds retry-billed waste. Use ≤ ~50_000.
**Enforced by:** CI guard fails the build on `timeoutMs >= 60_000` in an Inngest LLM function.

### R4 — Never retry a timeout at full premium cost
`callLLM` is non-streaming: on a client timeout the model still completes server-side and **bills full input + output** — we just discard it. With `retries: 2` a single timed-out step bills **three** full generations for zero result. LLM-spend functions use **`retries: 1`** (sometimes 0). A timeout is rarely transient; retrying it identically just re-burns the spend.
**Enforced by:** CI guard fails the build if a function that makes premium LLM calls sets `retries > 1`.

### R5 — User-triggered spend agents need a double-spend guard
Every agent reachable by a user click MUST have BOTH:
(a) `concurrency: { limit: 1, key: "event.data.project_id" }` on the Inngest function, AND
(b) an in-flight guard in its trigger action — query `agent_runs` for a `running` run of that `agent_type` for the project and no-op if one exists.
A single doc/op must never cost two runs.
**Enforced by:** CI guard fails the build if a function with a matching `run*Action` trigger lacks the concurrency block. Reference: `runProjectOutcomeAssessmentAction`.

### R6 — Right tier for the job
Cheap/mechanical work (classify, tag, grade, extract) routes to `cheap`. `premium` is only for final prose/judgement/synthesis. Do not reach for premium by default.
**Enforced by:** review + the compliance matrix below (not mechanically gated, but audited).

### R7 — Every call is cost-instrumented
Every `callLLM`/`streamLLM` passes `telemetry` (orgId required) so spend lands in `llm_cost_events`. No silent spend.
**Enforced by:** CI guard fails the build on an LLM call with no `telemetry` argument.

### R8 — No background or scheduled LLM spend
LLM spend happens only on explicit user action (intake, generation, on-demand click). No cron/timer/automatic fan-out. (Ref: 2026-06-22 weekly-synthesis incident — 172 runs, blew the cap, zero user action.)
**Enforced by:** review + the cost ceiling (R9) as backstop.

### R9 — Runtime cost ceiling
Each run accumulates `estimated_usd` across its steps and **aborts** if it crosses the per-`agent_type` budget. A single failed run can never spend more than its ceiling.
**Enforced by:** the shared agent run-loop (cost-ceiling helper); anomaly alert on `/admin/costs` when a run exceeds N× its agent_type median.

### R10 — SDK auto-retry must be OFF (added 2026-06-28, #118)
The Anthropic and OpenAI SDK clients default to `maxRetries: 2`. On a timeout the SDK silently re-issues the request twice more (~timeout each), so one logical call becomes **three billed generations** and ~3× the wall-clock — beneath both the Inngest retry layer and our explicit retry logic, invisible unless you read the client config. Both shared clients MUST set `maxRetries: 0` (`client.ts`). We control retries deliberately at the Inngest layer (R4); the SDK must not add a hidden third layer, least of all on timeouts we refuse to retry.
**Enforced by:** CI guard asserts both `new Anthropic(...)` / `new OpenAI(...)` set `maxRetries: 0` (#114).

---

## Map the WHOLE call path — the six surfaces

The cost/timeout class recurred three times on 2026-06-28 (#110 → #112 → #118), each via a *different* surface that the previous fix didn't touch. Reviewing one layer at a time is the root cause of the recurrence. A spend agent is safe only when **all six** of these are bounded together — check them as a set, never one at a time:

1. **Inngest function `retries`** — ≤ 1 for premium spend (R4). Default is 4.
2. **Our explicit retry / NonRetriable logic** — timeouts are NonRetriable; don't re-issue a paid call that already failed.
3. **SDK `maxRetries`** — must be 0 (R10). Default is 2. This is the one that hides.
4. **Per-call `timeoutMs`** — < 60s, Hobby cap (R3). Default (unset) is 120_000.
5. **`maxTokens`** — bounded to real output need, never the 16k premium default (R2).
6. **Work-per-call** — themes/evidence per batch sized so ONE bounded unit completes well under the timeout. Bound the unit, do not raise the ceiling — batching is scale-invariant; buying a bigger timeout (e.g. Vercel Pro 300s) just moves the wall and breaks on the next large project (decided 2026-06-28: stay on the bounded-unit architecture).

Reference: `discover-problems.ts` after #118 — 2 themes × 4 ranked evidence/batch, 3500 maxTokens, 50s timeout, slowest batch ~32s, full 39-theme run ~$0.56 with no retry waste.

> **Surface 6 must be MEASURED per agent, never inherited.** Config caps (maxTokens / timeout / retries / concurrency) are not the same as a bounded *unit of work*. On 2026-06-29, `generate-opportunities` had all the config caps from the #113 sweep but its batch size (5 problems) was never load-tested — at 42 real problems its batches ran 40–51s and one blew the cap, discarding the whole run for 0 output (#122). This was the **second** same-shape agent to slip through after #118 fixed only `discover-problems`. **Rule: when you fix this bug class in one agent, sweep EVERY same-shape agent (premium, batched, user-triggered) in the same pass and dry-run each one to a measured per-batch duration with real headroom under the timeout (target < ~35s of a 50s cap). A config cap with an unmeasured batch size is an untested agent.** Also note: a single end-of-run write step makes the whole run all-or-nothing — one batch timeout discards every completed batch — so headroom is not optional.

---

## The safe path

Agents must not call `callLLM` with ad-hoc params. They go through **`callAgentLLM()`** (to be built, #113 Pillar 1): a thin wrapper that **requires** `maxTokens` and `timeoutMs` as explicit arguments (no defaults to inherit), bakes in telemetry and the cost-ceiling check, and is the only sanctioned agent entry point. A new agent physically cannot inherit the 16k footgun because the unsafe default does not exist on this path.

## Enforcement

`npm run test` (or a dedicated `agent-standards` test) runs a guard that statically scans `src/lib/inngest/functions/*.ts` and **fails the build** on any violation of R2, R3, R4, R5, R7 (R10 client-config check pending, #114). This is the guarantee. Human review already failed twice; the test will not. The guard and this doc are kept in lockstep: a rule here without a check is a gap to close, not a suggestion.

## Detection (catch silent breaks before users do)

The theme→evidence break, the problems timeout, and the empty chain on 2026-06-28 were all **silent** until a human noticed. Two always-on layers:

- **Structural invariants (cheap SQL, no LLM cost), run continuously:** e.g. `project has trusted evidence + themes but 0 theme_evidence links`; `synthesis completed but 0 themes`; `problem-discovery completed with 0 problems while themes > 0`. Each is an anomaly surfaced on an internal health view.
- **Golden smoke eval (#113 Pillar 4):** the bots project is the fixture — known input, known output shape. Run the full chain on deploy and assert: synthesis ≥ 1 theme; themes have evidence links; problems > 0 when themes > 0; opportunities > 0 when problems > 0; total chain cost < budget. Fails in CI before a user is affected.

---

## Agent author checklist

Before shipping any new or edited Inngest LLM function, confirm:

- [ ] Uses `callAgentLLM()` (the safe path), not raw `callLLM` with ad-hoc params.
- [ ] Explicit `maxTokens`, sized to the actual output (R2).
- [ ] `timeoutMs` < 60_000 (R3).
- [ ] Heavy generation chunked into sub-60s steps, bounding input AND output (R1).
- [ ] `retries: 1` (or 0) if it makes premium calls (R4).
- [ ] If user-triggered: function `concurrency` guard + trigger-action in-flight guard (R5).
- [ ] Right tier — premium only for prose/judgement (R6).
- [ ] `telemetry` on every call (R7).
- [ ] No background/scheduled trigger (R8).
- [ ] The agent-standards CI guard passes locally.

## Compliance matrix (keep current)

Audited 2026-06-28. Update whenever an agent is added or changed.

| Agent | tier | maxTokens capped | timeout < 60s | retries | concurrency guard | status |
|---|---|---|---|---|---|---|
| assess-outcome | standard | yes | — | 1 | yes | ✅ compliant |
| discover-problems | premium | being fixed (#112) | 50s | 1 | yes | 🟡 in fix |
| generate-opportunities | premium | **no** | 50s | 2 | **no** | 🔴 #112 sweep |
| synthesise-project | premium | **no** | **180s** | 2 | **no** | 🔴 #112 sweep |
| ingest-source | (mixed) | yes | — | 3 | yes | 🟡 review retries |
| grade-evidence | cheap | default 1024 ok | — | 2 | n/a (chain) | 🟢 cheap, low risk |
| extract-entities | standard | yes | — | 2 | no | 🟢 standard-bounded |
| detect-gaps | standard | no | — | 1 | no | 🟢 standard-bounded |
| draft-frame | standard | no | — | 2 | no | 🟢 standard-bounded |
| extract-actions | cheap | no | — | 2 | n/a | 🟢 cheap |
| session-review | standard | no | — | 2 | n/a | 🟢 standard-bounded |
| synthesise-company / -competitor / -person | standard | no | — | 2 | no | 🟢 standard-bounded |
| verify-claims | eval | yes | — | 2 | n/a | 🟢 eval-bounded |

> `standard`/`cheap`/`eval` tiers default to small `maxTokens` (≤2048), so they are not the 16k cost landmine — but R3/R4/R5 still apply and the CI guard checks them. Premium agents are the priority.
