# Codex Brief — Evidence Grading Quality Signal (Phase 0 + Phase 1)

> ⛔ **SECURITY GATE APPLIES (non-negotiable).** Before committing/pushing any change to auth, RLS/migrations, public routes, middleware, or service-role usage, post the diff and wait for Opus's written **APPROVED**. See `AGENTS.md` → "SECURITY REVIEW GATE". This overrides anything below.

**Author:** Opus (PM + reviewer) · **Status:** spec for Codex to implement · **Date:** 2026-06-01

## Why

We just shipped auto-exclude (weak → `trust_scope = 'excluded'`) in `grade-evidence.ts`.
The grader now makes **silent, automated decisions** that remove evidence from synthesis
and drafts. We have **zero measurement** of whether those decisions are correct.

The dangerous failure is the **false exclude**: the model marks genuinely on-topic
evidence as weak, it auto-excludes, and it never reaches a draft — invisibly. This brief
adds the minimum instrumentation to make that rate observable and to start a learning loop,
without over-building.

## Design decisions (locked — do not redesign these)

1. **Correctness is project-scoped.** The grader conditions on each project's
   `research_context`, so "relevant vs weak" is defined relative to one project. Accuracy is
   measured **per project**, rolled up to org/global only as a trend. Never pool accuracy
   across projects as a single number.
2. **Capture richly, decide later.** Every human override event is stamped with
   `org_id`, `project_id`, **and** `user_id`. We do NOT commit to a learning unit yet.
3. **Person is a diagnostic, not a personalization axis.** `user_id` is captured to detect
   reviewer disagreement (a signal that `research_context` is ambiguous). The shared evidence
   base must NOT be personalized per reviewer.
4. **Org is the hard ceiling.** Never pool labels, examples, or metrics across orgs. Cross-org
   learning is a flat no (tenant isolation).
5. **No automatic few-shot / fine-tuning in this phase.** Out of scope. Near-term "learning"
   is human-driven: Opus reads per-project override patterns and either tunes the global
   prompt or flags that a project's context needs sharpening.

---

## Phase 0 — Fix the grade-count telemetry (cheap, do first)

**Bug:** in `src/lib/inngest/functions/grade-evidence.ts`, the counters
(`totalTrusted/totalUncertain/totalWeak/totalAutoExcluded`) are mutated **inside**
`step.run('grade-batch-N', ...)` callbacks. On Inngest replay, a completed `step.run`
returns its memoized result without re-executing the callback, so those outer-scope
mutations are lost → `agent_runs.output` shows all zeros even though the DB grades are
correct.

**Fix (correct Inngest pattern):** return the per-batch counts FROM each `step.run` and
accumulate from the returned (persisted) value, outside the step:

```ts
const batchCounts = await step.run(`grade-batch-${batchIdx}`, async () => {
  let trusted = 0, uncertain = 0, weak = 0, autoExcluded = 0;
  // ... existing per-record grading + DB writes ...
  //     increment locals here
  return { trusted, uncertain, weak, autoExcluded };
});
totalTrusted     += batchCounts.trusted;
totalUncertain   += batchCounts.uncertain;
totalWeak        += batchCounts.weak;
totalAutoExcluded += batchCounts.autoExcluded;
```

Because `step.run` return values are persisted and replayed deterministically, the
accumulation outside the step survives replay.

**Acceptance:** after a real ingest, `agent_runs.output` for the grading run shows non-zero
`trusted/uncertain/weak/auto_excluded` that sum to the records graded. Verify against a
direct `count(*) group by ai_trust_grade` on the affected source.

---

## Phase 1 — Override capture + per-project quality metric

### Problem to solve
To compute the false-exclude rate we must know, when a human moves a record, whether the
record's prior `trust_scope` was set **by the AI** (auto-trust/auto-exclude) or **by a human**.
Today `trust_scope = 'excluded'` is ambiguous (could be AI-auto or a human exclude).

### Schema (Codex to author migration; Opus reviews; Jimmy runs SQL)

Two additions — propose exact SQL in `supabase/migrations/00XX_evidence_grade_feedback.sql`:

1. **`evidence.trust_scope_source`** — text/enum, tracks provenance of the current scope:
   - `'ai'` — set by the grader's auto-trust/auto-exclude path
   - `'human'` — set by a manual Trust/Exclude/Move action
   - `'pending'` / null — never decided
   Set `'ai'` in `grade-evidence.ts` wherever it writes `trust_scope`; set `'human'` in the
   evidence server actions (`updateEvidenceTrustAction`, `setEvidenceTrustBulkAction`).
   Must respect RLS (org-scoped) like all evidence columns.

2. **`evidence_grade_feedback`** — append-only event log. One row per human override:
   | column | notes |
   |---|---|
   | `id` | uuid pk |
   | `org_id` | RLS scope (FK orgs) |
   | `project_id` | FK projects |
   | `user_id` | who made the decision |
   | `evidence_id` | FK evidence |
   | `model_grade` | snapshot of `ai_trust_grade` at override time (trusted/uncertain/weak/null) |
   | `from_scope` | prior `trust_scope` |
   | `to_scope` | new `trust_scope` |
   | `from_source` | prior `trust_scope_source` (`ai`/`human`/`pending`) — tells us if we're overriding an AI decision |
   | `created_at` | timestamptz default now() |

   RLS: same org-membership policy pattern as `evidence` (use the `auth_user_org_ids()`
   helper — do NOT inline an `org_members` subquery; see the recursion fix in 0023).

### Wiring
- In both evidence trust-write actions, after the update succeeds, insert one
  `evidence_grade_feedback` row capturing the BEFORE state (read `ai_trust_grade`,
  `trust_scope`, `trust_scope_source` before the update). Bulk actions insert one row per id.
- Keep it fire-and-forget relative to the user action (don't fail the UI write if the log
  insert fails — log and continue).

### Metric (no dashboard yet — just a documented query)
Provide SQL, scoped to one `project_id`:

- **Auto-exclude restore rate** = rows where `from_source='ai' AND from_scope='excluded' AND
  to_scope IN ('trusted','pending')` ÷ total currently/historically auto-excluded. **This is
  the false-exclude proxy — the number we care about most.**
- **Auto-trust override rate** = rows where `from_source='ai' AND from_scope='trusted' AND
  to_scope IN ('excluded','pending')` ÷ total auto-trusted.
- **Reviewer disagreement** (diagnostic): for a project, group feedback by `user_id` and look
  for systematically opposite decisions on similar grades.

---

## Out of scope (explicitly NOT now)
- Automatic few-shot injection of past corrections into the grading prompt.
- Any cross-org aggregation.
- Per-person personalization of grading.
- A golden-set regression harness — that's **Phase 2**, deferred until enough corrected
  examples exist (Veyor usage will produce them). Phase 2 will draw its fixtures from the
  `evidence_grade_feedback` table built here.
- UI dashboard for the metrics — queries only for now.

## Verification (Opus reviews before anything is applied)
1. Migration SQL reviewed by Opus; RLS uses helper functions, no inline `org_members` subquery.
2. Jimmy runs the migration in Supabase and pastes the result.
3. Phase 0 counter fix verified against a real grading run (`agent_runs.output` non-zero).
4. A manual Trust/Exclude in the UI produces exactly one `evidence_grade_feedback` row with
   correct `from_source`/`from_scope`/`model_grade`.
5. The two metric queries return sane numbers on the Veyor project.
