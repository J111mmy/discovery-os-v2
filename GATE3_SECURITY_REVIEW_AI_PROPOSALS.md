# Gate 3 — Security Review of the `ai_proposals` Contract (AI Improve / #10)

**Reviewer:** Opus 4.8 — security reviewer (the lane the original brief reserved: *"AI mutating user data needs an auth + provenance think-through"*).
**Date:** 2026-06-04.
**Scope:** The security surface of the AI-Improve proposal contract only — NOT the look & feel (Gate 2, approved) and NOT the architectural shape (Opus-Build authored the `ai_proposals` schema/RPC). This is the auth + provenance + injection sign-off that gates Codex starting the build.
**Inputs read:** `DESIGN_BRIEF_AI_ASSISTED_EDIT.md` (Gate 3 decisions, lines 120–140); `0026_evidence_grade_feedback.sql` (the spine being copied); `artifacts` + `artifact_versions` schema (`0001`); RLS pattern (`0005`, `0026`).

---

## Verdict: **CONDITIONAL PASS.**

The design is fundamentally sound and *safer than most AI-edit features* for one structural reason: **propose → human approve → record provenance means there is no silent write.** Even a fully successful prompt injection can, at worst, produce a bad *suggestion* the user rejects — it cannot mutate the document on its own. That human-in-the-loop is the strongest control in the whole design, and it's baked into the contract. Reusing the proven `evidence_grade_feedback` spine (org-scoped RLS, `user_id = auth.uid()`, cross-table existence checks) is the right call.

**It passes subject to the 7 conditions below.** None require redesign; they are "build it this way" constraints Codex must implement, plus **one genuine architectural decision** (C1) that must be made before the accept path is written.

---

## Threat model (what we're defending against)

The actors who can reach this surface are **authenticated org members** (including invited external design-partner users). The assets are: (a) other orgs' data, (b) the integrity of a document's content + version history, (c) the trustworthiness of the provenance log, (d) LLM cost. The novel surface vs. everything assessed in Milestone 0: **a user-triggered LLM call whose output is written back into a versioned artifact.**

---

## Conditions (must be satisfied before the slice ships)

### C1 — [ARCHITECTURE DECISION] The accept RPC is the entire security boundary. Pick its model deliberately.
The contract says accept is a single-transaction Postgres RPC that updates the proposal + writes `artifact_versions` + bumps `artifacts.version`. **How that function is declared decides whether RLS still protects us:**

- **Preferred: `SECURITY INVOKER`** — RLS stays in force; the caller can only touch rows their policies already allow. Requires UPDATE policy on `ai_proposals`, INSERT on `artifact_versions`, UPDATE on `artifacts` — all of which the member write-policies already grant (post-0025, via `auth_user_org_role`). Simplest to reason about; RLS is the backstop.
- **If `SECURITY DEFINER` is used** (to guarantee atomicity regardless of caller grants), then RLS is bypassed *inside the function* and the function MUST do its own authz, in this exact order, trusting nothing from the client but `auth.uid()`:
  1. Resolve caller = `auth.uid()`; reject if null.
  2. Load the proposal by id; derive `org_id`/`project_id`/`artifact_id` **from the stored row, never from RPC arguments.**
  3. Assert `auth_user_org_role(proposal.org_id) in ('owner','admin','member')`.
  4. Assert `proposal.status = 'pending'` (idempotency — blocks double-apply on retry/double-click).
  5. Assert `proposal.target_version = artifacts.version` (stale guard → raise an exception the API maps to **409**).
  6. Apply the transaction; set `status='accepted'`, `decided_by=auth.uid()`, `decided_at=now()`.
  7. **`set search_path = ''`** on the function + schema-qualify every object (this is the exact SEC-FN-1 lesson from 0024 — a SECURITY DEFINER function without a pinned search_path is a privilege-escalation footgun).

**My recommendation: SECURITY INVOKER.** Keep RLS as the enforcement layer; only drop to DEFINER if a concrete atomicity requirement forces it, and if so, implement all of 1–7.

### C2 — RLS on `ai_proposals` must clone the 0026 spine exactly.
- `org_id`, `project_id`, `user_id` (creator) columns, all `not null`, FKs to orgs/projects/auth.users.
- `artifact_id` FK to `artifacts` **`on delete cascade`** (so deleting a doc doesn't leave orphaned content snapshots — also covers part of #21).
- RLS enabled. **SELECT**: `org_id in (select auth_user_org_ids())` (matches the org-visible-intent decision Jimmy confirmed).
- **INSERT** `with check`: `user_id = auth.uid()` AND `org_id in (select auth_user_org_ids())` AND an `exists` check that the target artifact is in the same org+project (mirror the evidence existence check in 0026 lines 69–82).

### C3 — Proposal rows are immutable except for the decision transition.
The provenance log is only trustworthy if a user can't rewrite history. `intent_prompt`, `current_state` snapshot, `proposed_content`, `created_by`, `target_version`, `agent_run_id` must be **write-once at insert**. The only permitted mutation is `pending → accepted|rejected` (+ `decided_by`/`decided_at`), and that should happen **only through the RPC** (accept) or a tightly-scoped reject path. Do **not** ship a general end-user UPDATE policy that allows editing the content/intent columns. If an UPDATE policy is needed for the reject button, scope it so it can only flip `status` from `pending` and cannot alter the immutable columns (enforce via a trigger or a column-restricted RPC, since RLS can't restrict *which columns* change).

### C4 — Prompt-injection: fence document content as data, and treat model output as untrusted.
The improve call sends `intent_prompt` (user) + the artifact's current content (which may itself be synthesised from ingested third-party sources an attacker could have seeded). Required:
- System prompt defines the edit task; the document content is wrapped in an explicit delimited block declared as **data to be edited, never instructions to follow**. Same posture as the existing extraction/compose prompts.
- Context assembly **reuses the existing org_id-filtered LLM context path** (verified clean in the Milestone 0 LLM-payload audit) — the improve call must never pull another org's content into the prompt.
- The human-approval step is the backstop: a successful injection yields a *proposal*, not a write. State this explicitly in the build so no one later "optimises" it into an auto-apply.

### C5 — [NEW FINDING, raised by #14] AI-proposed content must be sanitised before storage/render once we move to HTML.
Today `artifacts.content_md` is Markdown (relatively safe). Issue **#14** migrates to `content_html`. **The moment the model's `proposed_content` can be HTML that gets rendered, an unsanitised proposal is a stored-XSS vector** — and the source of that HTML is an LLM influenced by user intent + possibly-poisoned document content. Requirement: sanitise/allowlist AI-proposed HTML (server-side, on the way into `proposed_content` and/or at render) the same way any user-supplied HTML would be. This condition rides with #14; flag it on that issue so the two land together.

### C6 — The *propose* (generate) API route follows the standard auth gate.
`auth.getUser()` → `getProjectForUser(user.id, project_id)` (404 if not a member) → confirm the target artifact belongs to that verified project → **only then** call the LLM and insert the `pending` proposal. `org_id`/`project_id` come from the verified project, never the request body. Identical to the routes verified in the Milestone 0 API-route audit.

### C7 — Rate-limit the propose call before external orgs use it (#20).
This is the first *repeatable, user-triggered, unbounded-cost* LLM surface we expose. An authenticated member can spam "Improve" → cost-DoS. Not Milestone-0-blocking for Veyor (trusted single design partner), but a per-user/per-org throttle should land **before** the primitive rolls past Veyor. Keep #20 as a real pre-GA item, not an open-ended backlog wish.

---

## Explicitly fine — no action needed
- **Org-visible `intent_prompt`** (Jimmy confirmed) — within-org only, no cross-tenant exposure; intents are users' own free text.
- **FK to `agent_runs`** for cost/observability — good reuse of existing infra.
- **`artifact_versions.from_proposal_id`** closing the audit loop — correct; make it a nullable FK so pre-existing/manual versions stay valid.
- **Whole-document-only first slice** (text-selection deferred to #18) — reduces the offset-mapping attack/bug surface; good scoping.
- **Orphan sweeper (#21)** — hygiene, not security, once C2's `on delete cascade` is in place. Low priority.

---

## What Codex needs from this review (the build contract)
1. Decide C1 (recommend SECURITY INVOKER). 2. Author the `ai_proposals` migration per C2 + C3 — **author only, do not apply** (same gate as 0025: Opus reviews, Jimmy runs). 3. Implement the propose route per C6 and the prompt fencing per C4. 4. Add C5 to issue #14. 5. Keep #20 (C7) as pre-GA.

**Gate 3 security sign-off: GRANTED on implementation of C1–C7.** I will re-review the `ai_proposals` migration SQL + the accept-RPC definition before they are applied — the contract is approved, the implementation still gets the same before-apply review every DB change gets.
