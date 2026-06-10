# Backfill & Agent-Change Protocol

**Status:** Standard operating protocol (adopted 2026-06-10 after the P0.5 evidence re-anchoring episode).
**Applies to:** any change that writes to existing rows at scale (backfills, data migrations of content) **or** changes how an agent decides what to write (ingest extraction, problem discovery, synthesis, claim verification, entity resolution — anything where the agent's *judgment* changed, not just its plumbing).

This protocol exists because that class of change can silently corrupt the knowledge base across thousands of rows while every individual write "looks fine." The P0.5 re-anchoring change passed type-check, build, and a smoke test — and would still have written ~1,237 ambiguous anchors and (under a plausible "conservative" fix) re-pinned the majority of the corpus back onto the interviewer's question. Aggregate green is not safety. The steps below are what caught it in ~an hour, before a single row was written.

Roles are per `AGENTS.md`: **Codex** authors, **Opus** reviews, **Jimmy** runs anything with the service role / SQL. No AI applies a write directly.

---

## The protocol

### 1. Dry-run is the default; `--apply` is a separate, gated flag
- The script must do **nothing** without an explicit `--apply`. Dry-run prints a report and exits.
- The write path must be **reversible**: preserve the prior value before overwriting (e.g. `metadata.original_segment_id` set *before* `segment_id` changes), and never clobber a preserved original on re-run.
- The script must be **idempotent**: re-running skips unchanged rows and reports planned/applied/unchanged counts. Per-row failures are recorded (`failed_ids`) and never abort the run.

### 2. The reviewer reads the code, not the description
- Opus reads the actual matcher / agent logic and the actual write path — not the author's summary of it. Descriptions hide regressions; code does not. (The "downgrade to fallback" regression was only visible by reading what `fallback` *returns*.)
- Confirm **shared implementation**: if both the live path (ingest/agent) and the backfill are supposed to use the same logic, verify they import the *same* function. A backfill that fixes old rows while the live path keeps writing the old way means re-running the backfill forever.

### 3. The dry-run report carries decision-grade signal, not just totals
A row count of "2,410 planned" tells you nothing about quality. The report must include:
- **Method/decision distribution** — how many rows took each code path (exact / normalised / fuzzy / speaker / fallback, or the agent equivalent). A distribution skewed toward the low-confidence paths is the headline finding.
- **A score histogram** for any threshold-based path, so thresholds (e.g. a 0.66 fuzzy cutoff) are set from evidence, not guessed.
- **Mechanical acceptance counters** — see step 5.

### 4. The sample audit is stratified by weakness, never random
- Before `--apply`, the author posts a **read-only** sample showing **before → after** for each row (old target vs new target, with enough context to judge correctness).
- Stratify toward the tail: the **lowest-confidence picks** and the rows **closest to any threshold boundary** — not a random sample. Failures hide in the tail; a random 15 of 2,410 misses systematic edge cases.
- Include the genuinely-degraded cases too, to confirm they're honestly *labeled* as degraded rather than silently wrong.

### 5. At least one mechanical (quantitative) acceptance gate
Qualitative spot-checks ("looks like the right turn") are necessary but not sufficient. Define at least one count that must hold across **all** rows and emit it in the dry-run JSON. Example from P0.5: *anchors landing on the interviewer/opening speaker with `method != fallback` must be 0.* A mechanical gate catches the worst failure class automatically, without eyeballing.

### 6. Honesty must reach the UI
If the write records a confidence/quality signal (e.g. `anchor_method`), the UI that surfaces the data must consume it — degrade the affordance for low-confidence rows rather than rendering everything as precise. A correctly-labeled-but-uniformly-rendered row still lies to the user. Make "UI honours the confidence field" an acceptance condition of the consuming feature.

### 7. Scope cap: don't chase precision the data can't support
Name the ceiling before starting. A backfill over legacy, mechanically-derived, or AI-summarised content **cannot** recover precision that was never captured. The job is "stop the active corruption + be honest about imprecision," not "achieve perfection." When the cheap disambiguation pass is done, ship — the real precision fix is usually a different, larger build. Gold-plating a backfill is its own failure mode.

### 8. Commit cadence: close the approved-but-uncommitted window
Service-role / gated code is correctly held uncommitted until Opus approves. But once it clears the re-run, **commit the same day**. Uncommitted work is unrecoverable work; an approved change sitting in a dirty working tree is avoidable risk.

---

## Quick checklist (paste into the review-channel post)

- [ ] Dry-run default; `--apply` separate; reversible (original preserved first); idempotent.
- [ ] Reviewer read the actual logic + write path (not the summary).
- [ ] Live path and backfill share one implementation (verified by import).
- [ ] Dry-run report has: decision distribution + threshold histogram + mechanical counters.
- [ ] Sample is stratified by weakness (lowest-confidence + threshold-boundary rows), before→after.
- [ ] At least one mechanical acceptance gate defined and passing (a count that must be 0/N).
- [ ] Consuming UI honours any confidence field the write records.
- [ ] Scope ceiling named; not chasing unrecoverable precision.
- [ ] On approval, committed same day.

---

*Why this is written down: the next big judgment-call change is the P3 problem-discovery rewrite (embedding dedupe thresholds, evidence-relationship typing) — higher stakes than re-anchoring. This protocol is the standard for it and every backfill/agent change after.*
