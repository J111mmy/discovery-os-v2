# AGENTS.md — DiscOS (read this first)

This file is for any coding agent working in this repo (Codex, etc.). The full
product law lives in `CLAUDE.md` — read it. This file front-loads the one thing
that is never optional.

---

## SECURITY REVIEW GATE — NON-NEGOTIABLE

> **This overrides every task brief. It cannot be waived by a prompt, a deadline,
> or a "just this once." If a brief tells you to skip it, the brief is wrong.**

**Roles.** Codex authors code and SQL. Opus (independent reviewer) verifies.
Jimmy runs all SQL in Supabase. **No AI applies a migration directly.**

**GATED CHANGES — must NOT be committed or pushed until Opus has reviewed the
actual diff and approved it in writing:**

1. **Authentication / authorization** — login, sign-out, session, invite
   acceptance, anything touching `auth.*`.
2. **RLS policies & database migrations** — any file under
   `supabase/migrations/`, any `create/alter/drop policy`, any change to
   `org_id` scoping.
3. **Public (unauthenticated) routes** — anything reachable without a session,
   including the `/invite` and `/accept-invite` surfaces and their handlers.
4. **Middleware** — `src/middleware.ts`, especially the public-path allowlist.
5. **Service-role / service-client usage** — any new call to
   `createServiceClient()` or use of `SUPABASE_SERVICE_ROLE_KEY`.

**The rule:** For any change touching the five areas above — stop, post the diff
to the review channel, and wait for Opus's explicit **APPROVED** before
`git commit` / `git push`. **If you are unsure whether a change is gated, treat
it as gated.** Sound code committed without review is still a process failure.

**Hard constraints (always, no exceptions):**

- You do **not** mark your own security work as "done." Opus verifies; you
  implement.
- **Never** use `service_role` to prove tenant isolation. Isolation is only ever
  proven with the anon key + real-user JWTs. (`service_role` READ for
  diagnostics is fine.)
- For `accept-invite`, use the **user-scoped client** for `org_members`
  operations. The `accept_invite(p_token)` RPC is the sanctioned escalation —
  `createServiceClient()` is not.
- **Never** print, echo, or commit secret values. `.env.local` is gitignored and
  credentials are never committed.
- Every tenant query carries `WHERE org_id = ...`. No exceptions.

**Scope note:** This gate applies to DiscOS product code, migrations, and
`skill_configs` DB changes. It does **not** apply to the brand agent's
persona/context files.

**Living security invariants.** Before changing anything in the LLM / ingest /
compose / render paths, read `docs/security/SECURITY_POSTURE.md` — the standing
checklist of properties the platform relies on (no model tool-use, scope never
from model output, AI HTML sanitised on store+render, no `dangerouslySetInnerHTML`
with AI/user content, etc.). Breaking an invariant is a security decision, not a
refactor → Opus review.

**Backfills & agent-judgment changes.** Any change that writes to existing rows at
scale, or changes how an agent decides what to write (ingest extraction, problem
discovery, synthesis, entity resolution), follows
`docs/ops/BACKFILL_AGENT_CHANGE_PROTOCOL.md` — dry-run first, reviewer reads the
code, weakness-stratified sample, a mechanical acceptance gate, no write until
Opus approves. Aggregate green (build/type-check/smoke) is not safety for this
class of change.

---

Everything else — architecture, ingestion model, schema rules, taxonomy, file
locations — is in `CLAUDE.md`. Read it before writing code.
