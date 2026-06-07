# Codex task brief — post security assessment (2026-05-31)

**Author:** Opus 4.8 (independent security reviewer).
**Division of duties (important):** Opus *finds and verifies*; Codex *implements (authors SQL/code)*; **Jimmy runs all SQL in the Supabase SQL Editor and pastes results back.** Codex authored the backend, so Codex does NOT sign off on its own security work — Opus reviews the before/after of every change before it counts as done. Opus's DB credential was rotated after the assessment, so neither AI applies migrations directly: Codex writes the exact SQL (migrations + dump queries), Jimmy runs them in Supabase, Opus reviews the output.

**Access:** uncertain which live accounts Codex can reach (Vercel/Inngest/DB). **First action: declare your access in `OPUS_CODEX_CHANNEL.md`** so tasks route correctly. Until then, assume Jimmy runs anything requiring Supabase/Vercel/Inngest.

## Context you need
- A blocker was found and already fixed live: invite acceptance failed with `infinite recursion detected in policy for relation "org_members"`. Root cause: `org_members` INSERT → `"invited users can join orgs"` WITH CHECK subqueries `org_invites` → the `org_invites` `"owners and admins can manage invites"` policy used an inline `SELECT ... FROM org_members` subquery → cycle. Fix = `supabase/migrations/0023_fix_org_invites_recursion.sql` (rewrote that policy to use `auth_user_org_role()`).
- `0023` was applied LIVE via a raw SQL connection that is now retired. It was **not** recorded in `supabase_migrations.schema_migrations`. The file uses `drop policy if exists ... ; create policy ...`, so re-applying it via `supabase db push` is safe and idempotent (clean drop+recreate) and will reconcile the tracking.

---

## TASK A — Vercel env audit (do now; no impact on Jimmy's testing)
Run `vercel env ls` (production) and confirm:
1. `INNGEST_SIGNING_KEY` and `INNGEST_EVENT_KEY` are present in production.
2. `SUPABASE_SERVICE_ROLE_KEY`, `INNGEST_SIGNING_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` are **server-only** — i.e. NONE of them are duplicated under a `NEXT_PUBLIC_*` name (which would ship them in the client bundle).
3. Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (and other intentionally-public vars) carry the `NEXT_PUBLIC_` prefix.
**Report:** the variable NAMES only (never values) and a pass/fail on each check.

## TASK B — Inngest signing key confirmation (do now)
The serve handler (`src/app/api/inngest/route.ts`) uses stock `inngest/next` `serve()`, which enforces signature verification automatically *when the signing key is set*. Confirm in the Inngest dashboard that the production app has the signing key configured and that requests are being signed/verified (no "unsigned request" warnings).
**Report:** confirmed / not confirmed.

## TASK C — Reconcile migrations + apply 0024 (do now; harmless to testing)
1. `supabase db push` to apply `0023` (reconciles tracking — safe, idempotent) and `0024_security_hardening.sql`.
2. `0024` does two defense-in-depth things, zero behavioral change for normal users: `REVOKE ALL` on `super_admins`/`platform_settings` from `anon`/`authenticated`, and pins `search_path = ''` on the `auth_user_org_ids()` / `auth_user_org_role()` SECURITY DEFINER helpers.
3. After push, confirm `schema_migrations` lists `0023` and `0024`.
**Report:** push output + confirmation the two helpers still return correct results (quick check: as an existing member, `select auth_user_org_ids()` returns their org(s)).

## TASK D — Author SEC-RLS-2 standardization migration `0025` (prepare now; APPLY ONLY after Opus review AND after Jimmy's UI invite test)
**Goal:** eliminate the latent recursion footgun by making every membership check use the SECURITY DEFINER helpers, exactly as migration `0012` did for `org_members`. This is a **semantics-preserving** refactor — it must NOT change which rows any user can read/write.

**Transformation rules** (apply per policy, matching the existing command + role scope):
- "any member" check `org_id in (select org_members.org_id from org_members where org_members.user_id = auth.uid())` → `org_id in (select auth_user_org_ids())`
- "owner/admin" check `... where user_id = auth.uid() and role = any(array['owner','admin'])` → `auth_user_org_role(org_id) = any(array['owner','admin']::org_role[])`
- "owner only" check → `auth_user_org_role(org_id) = 'owner'`
- Read each policy's LIVE definition first (`select policyname, cmd, qual, with_check from pg_policies where ...`) and preserve its exact command and role scope. Do not guess — if a policy's scope is ambiguous, leave it and flag it for Opus.

**Policies to convert** (from the assessment; `org_invites` is already done in 0023 — exclude it):
- actions: insert/update/delete
- artifact_versions: insert
- artifacts: insert/update/delete
- companies: insert/update
- competitors: insert/update
- evidence: delete, "update evidence trust"
- ingest_jobs: insert/update
- people: insert/update
- problems: select/insert/update
- product_requests: insert/update/delete
- project_opportunities: insert/update
- project_opportunity_evidence: insert
- project_opportunity_projects: insert
- projects: insert/update
- skill_configs: "org owners can manage skill configs" (ALL)
- source_segments: delete
- sources: insert/update/delete

**Deliverables for Opus review (do NOT apply until Opus signs off):**
1. `supabase/migrations/0025_standardize_membership_policies.sql` (drop+recreate each policy with the helper form).
2. A `BEFORE` dump: `pg_policies` (policyname, cmd, qual, with_check) for every affected table.
3. After Opus approves, apply via `supabase db push`, then produce an `AFTER` dump + a smoke test: as a real member, confirm read + insert still work on `projects` and `evidence`; as an orgless throwaway user (anon key + JWT), confirm reads still return 0 rows and an `org_members` self-insert is still cleanly rejected (not recursion). Reuse the approach in the assessment's isolation test.

**Sequencing:** A, B, C now. D authored now, applied only after (1) Opus reviews the BEFORE dump + migration SQL and (2) Jimmy has run his UI invite test on the current baseline — so we never stack a 33-policy change on top of the first real end-to-end test.
