# Design Brief — A Cross-Platform "Ask AI to Fix/Change This" Primitive

**Status: EXPLORATION ONLY. Explore *with Jimmy* before any implementation. No code, no migrations until a direction is chosen together.**
**Lead: Sonnet (design), in collaboration with Jimmy. Opus/Codex do not build off this until a direction is locked.**

---

## The insight (Jimmy, 2026-06-02)
Three open issues look like three separate features:
- **#1 Duplicate people handling**
- **#9 Companies area not modifiable when wrong**
- **#10 Blog/document area feels strange**

But they're the same underlying act: **a user communicating with AI to clean something up or change something** — and that something could be a person profile, a company, a blog/document, an evidence item, the project frame… any section. The hypothesis: don't build bespoke fixes per surface. Build **one AI-assisted-edit primitive** and surface it everywhere.

## Why this matters
- Bespoke features fragment the UX and multiply maintenance. A shared primitive gives one mental model the user learns once.
- It fits DiscOS's existing ethos: the app is already "human reviews what the AI proposes" (evidence trust scopes, grading). An AI-edit primitive that **proposes a change the user approves** is the same contract, generalised.
- It likely reuses infra we already have: `callLLM` tiers, `agent_runs` logging, the propose→accept review pattern.

---

## The design space to explore together (questions, not answers)

1. **One surface or one engine?** Is this a single global assistant, OR a shared component/engine that appears contextually on each entity? (Leaning: shared engine, contextual invocation — but pressure-test it.)

2. **Invocation.** Where does the user reach it? Options to weigh: a contextual "✨ Ask AI" affordance on each entity/section; an inline selection toolbar; a command palette; a persistent side assistant. What feels native vs. bolted-on?

3. **Apply vs. propose.** Does the AI mutate directly, or return a reviewable diff the user accepts/rejects? (DiscOS's trust ethos strongly suggests propose-then-approve — but some trivial fixes may not need a ceremony. Where's the line?)

4. **Two distinct verbs hiding in here:**
   - *"Clean up"* — AI-initiated detection + suggestion (e.g. "these two people look like the same person", "this company name looks wrong"). Proactive.
   - *"Change this"* — user-initiated intent ("merge these", "tighten this section", "fix the address"). Reactive.
   Are both in scope, or do we start with one? The three issues actually span the spectrum (#1 is detect-and-suggest, #9 is fix-a-field, #10 is improve-content) — which is *why* a unifying primitive is attractive, and also where scope can balloon.

5. **Generic chrome + typed actions underneath.** Freeform text editing can't do everything. **Merging two people** has structural consequences — re-pointing evidence, affiliations, digests. So the primitive may need a generic conversational surface on top, with **entity-specific capabilities/"actions" the AI can call** underneath (merge-person, edit-company-field, rewrite-section). Explore what that contract looks like.

6. **Reuse, don't reinvent.** How does this sit alongside the AI surfaces that already exist (compose/synthesis, grading, person/company digests)? Same LLM client, same `agent_runs` observability, same review UX?

## Watch-outs / anti-goals
- Don't let "generic" become a scope monster. The win is a *thin shared primitive*, not an everything-box.
- Some operations are structural (merges, re-linking) — a pure text rewriter won't cut it; the typed-action layer matters.
- Keep human-in-the-loop consistent with the trust model. A silent AI mutation of a confidential GC profile is off-brand and risky.
- Don't pre-build the onboarding flow (#8) into this — separate concern (Codex onboarding/billing brief).

## What "exploration done" looks like (the deliverable before any build)
- A recommended direction, plus 1–2 alternatives considered and why they lost.
- The three issues (#1/#9/#10) walked through the chosen pattern to prove it actually solves all three.
- A **thin first slice** identified — the smallest single surface to validate the primitive on before rolling it platform-wide.
- An explicit list of what stays bespoke (structural actions) vs. what the generic layer covers.

**Then** Opus reviews scope/security surface (AI mutating user data needs an auth + provenance think-through) and Codex/Sonnet build the first slice.

---

# Decision Sharpening (Opus + Codex converged, Jimmy-steered — 2026-06-02)

This section supersedes the open hypotheses above where they conflict. It is the
sharpened frame Sonnet works *from*. It is split into **LOCKED** (decided guardrails),
**OPEN** (explore with Jimmy — Sonnet proposes, Jimmy decides), and **GATES** (Jimmy signs
off before anything is built or shipped). The whole point: Jimmy must like it before it
lands. Nothing past a gate without his yes.

## The product statement (the one-line north star)

> **When DiscOS creates or interprets content, the user can ask it to improve, correct, or
> reconcile that content in place. The AI proposes; the user decides; the system records
> provenance.**

This is *not* "AI edit everything." It is "AI helps me turn messy / generated / interpreted
knowledge into trusted, outcome-ready material." Everything below serves this sentence; if a
proposed feature doesn't, it doesn't belong here.

## LOCKED — guardrails Sonnet must respect

1. **Editability is separate from AI.** Basic CRUD gaps (issue #9 and the whole "X not
   modifiable when wrong" class) are fixed with **plain inline editing — no AI**. If the
   user knows the correct value, AI must never be the path to change it. AI-washing a text
   box makes the product slower and more theatrical — the opposite of "simple yet magical."

2. **AI applies only where the intelligence layer matters** — i.e. where inference,
   synthesis, evidence, rewriting, or structural reconciliation is involved: generated
   documents, digests, project frames, synthesis sections, evidence-backed narratives, and
   consequential merge/cleanup. Nowhere else.

3. **Sequencing is fixed:**
   - **First AI slice = AI-assisted revision of a generated document/artifact section (#10).** This is where AI editing is the *right tool*, not a workaround.
   - **#9 = inline editing, shipped separately, no AI.**
   - **#1 (duplicate-people merge) = later**, because it has graph consequences.

4. **The reusable unit is the proposal contract, not a panel:**
   `target → intent → current state → proposed change/plan → approve/reject → provenance/log`.
   **Generalise the spine we already shipped** — evidence grading is literally
   propose (AI) → human decision → `evidence_grade_feedback` log → `trust_scope_source`
   provenance (`ai`/`human`/`pending`). Reuse that shape and `callLLM`/`agent_runs`. Do not
   invent a parallel system.

5. **Always propose → preview/diff → approve → record provenance. Never silent mutation.**
   Direct editing stays the default wherever a field is directly editable; AI is an
   *additional* affordance, never the only path.

6. **Outcome-anchored, contextual verbs — no global assistant/bot.** User-facing language
   is contextual to the object and DiscOS's outcomes: **Improve, Back with evidence,
   Sharpen, Reconcile, Review suggestion**. "AI Action Panel" is fine internally; never
   user-facing. The user operates on the thing in front of them, not a separate chatbot.

7. **Structural ops need an action-plan preview, not a text diff.** A merge must show what
   re-points (e.g. "7 evidence rows, 2 affiliations, 1 digest will move to person X"). That
   renderer is the hard part and the reason #1 is last.

## OPEN — explore *with Jimmy* (Sonnet proposes; Jimmy decides; do not pre-commit)

- Exact invocation affordance per surface (hover verb on structured entities vs. selection
  toolbar in text vs. section-header action) — decide by feel on real screens.
- The approval-ceremony threshold: where does propose→approve feel right vs. too heavy
  (i.e. where might a trivial change auto-apply with undo instead)?
- The verb-set per content type — which outcome verbs actually map to which DiscOS surface.
- Diff rendering for prose (paragraph rewrite): inline vs. side-by-side.
- Whether evidence linkage stays visible while revising a synthesised section.

## GATES — Jimmy signs off at each; nothing proceeds without it

- **Gate 1 — Frame agreed.** ✅ CONFIRMED 2026-06-04. Jimmy confirmed the Decision Sharpening
  section. LOCKED decisions stand. #9 = inline edit (no AI), #10 = first AI slice, #1 = deferred.
- **Gate 2 — Look & feel.** ✅ CONFIRMED 2026-06-04. GATE2_AI_IMPROVE.html prototype approved.
  Two entry points (document-scope button + text selection toolbar), inline contextual prompt +
  diff panels, single-shot with retry, Accept · Try again · Keep original.
  Issue #14 (MD→HTML) flagged high priority — must land before Gate 4 build.
- **Gate 3 — Contract + security.** ✅ CONFIRMED 2026-06-04. Opus reviewed. Decisions locked:
  - New `ai_proposals` table (sibling to `evidence_grade_feedback`, not an extension of it).
    Spine: `target → intent → current_state → proposed → decision → provenance`.
    Links to `agent_runs` via FK. Accept path via Postgres RPC (single transaction).
  - `artifact_versions` gets `from_proposal_id` column — audit loop closes from day one.
  - Cross-user visibility of `intent_prompt`: **org-visible** (confirmed by Jimmy — shared docs,
    people need to know why content changed, same as any collaborative app history).
  - Gate 4 thin slice scope: **whole-document only**. Text-selection deferred (tracked #18).
    Reason: MD offset mapping is brittle until #14 (MD→HTML) ships.
  - Security non-negotiables: user-scoped client for reads (no service-role bypass), stale-state
    guard on accept (409 if `target_version` mismatch), prompt injection structural mitigations
    (document content fenced as data, not instruction), rate limiting (#20), orphan sweeper (#21).
  - **Security sign-off RUN by Opus (security reviewer) 2026-06-04 → `GATE3_SECURITY_REVIEW_AI_PROPOSALS.md`.**
    Verdict: CONDITIONAL PASS on 7 conditions C1–C7. C1 = decide the accept-RPC model
    (recommend SECURITY INVOKER so RLS stays the boundary; if DEFINER, mandatory in-function
    authz + `search_path=''`). C5 = NEW finding: once #14 moves content to HTML, AI-proposed
    content is a stored-XSS vector and must be sanitised — rides with #14. The `ai_proposals`
    migration + accept-RPC get the same before-apply Opus review as every DB change.
- **Gate 4 — Real-use validation.** Thin #10 slice built → Jimmy uses it on real content →
  Jimmy decides whether the pattern rolls to the next surface.

## NOT in scope yet (explicitly deferred)

- **System learning / personalisation** from the proposal log (the "learning signal"): the
  log is *captured* from day one, but nothing acts on it. That's a later phase.
- Auto-applying AI changes without review.
- First-run onboarding (#8) — separate concern (Codex onboarding/billing brief).
