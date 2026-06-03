# Milestone 0 Checklist — Veyor as first design-partner org (unpaid)

**Goal:** The Veyor team all log into the *same* Veyor org, see every project in it, securely, with real confidential GC research loaded.
**Gate:** Independent security assessment (run by Opus 4.8, NOT Codex — Codex authored the backend).
**Billing:** Explicitly out of scope for this milestone. "Unpaid" = no entitlement/Stripe work needed.
**Source of truth for priorities:** `ROADMAP.md`. This file tracks execution of Milestone 0 only.

How to use: tick `[x]` as each item lands. Codex ticks off any **fix** items it implements; Opus ticks off **assessment** items as each area is reviewed and written up.

---

## A. Milestone critical path (0 → 1 → 2 → 3 → 4)

- [x] **0. Super admin active** — Jimmy has `/admin` access (migration 0020 applied, grant in place)
- [x] **1. Security assessment complete** — Done. Tenant isolation proven (static + dynamic), auth/org-scoping pattern verified, ORG-1/2/3 cleared, LLM redaction + file-upload verified, Inngest signature + service-client usage audited. **1 BLOCKER found and FIXED live: SEC-BLOCKER-1 (invite-acceptance recursion → migration 0023).** Residual: 3 low-severity hardening items (DEF-1, SEC-RLS-2, SEC-FN-1) logged for follow-up; none block inviting the team.
- [x] **2. Active org context cleanup** — DONE (commit `f2b8b97`). `getActiveOrgId()` helper (impersonation → cookie → deterministic `joined_at` fallback) in `src/lib/auth/org.ts`, used across projects/people/companies/competitors pages; `setActiveOrgId` fires on accept-invite + org creation. **Opus audit 2026-06-02:** no remaining ad-hoc "first-row" org lookups — every other `org_members` read is legitimate (member list scoped to a `getProjectForUser`-verified `project.org_id`; owner/admin authz check; the invite flow). **Known gap (non-blocking, deferred):** no in-app org-switcher UI for multi-org users; irrelevant for single-org Veyor.
- [x] **3. All blocker-severity findings resolved** — SEC-BLOCKER-1 fixed & verified live (migration 0023 applied). No other blocker-severity findings outstanding.
- [ ] **4. Team invited + verified** — ✅ **UNBLOCKED** (invite acceptance now works in prod). Next: invite each Veyor teammate (INVITE ONLY — see runbook below) and confirm they land in the Veyor org and see all projects.

> **Onboarding runbook — INVITE ONLY.** Never tell a teammate to "just sign up." Self-signup + creating a first project auto-provisions a *new isolated org* (`ensureUserOrg`, `projects/new/actions.ts:29`). Invites correctly attach to the existing org (`accept-invite/page.tsx:77`).

---

## B. Security assessment — coverage checklist
Reference: `SECURITY_TECHNICAL_ASSESSMENT_PLAN.md`. Every claim needs a code/policy reference or an explicit "not verified" note.

### Seeded findings (from initial code review, 2026-05-31)
- [x] **ORG-1 (High) — RESOLVED, no hole.** `org_members` INSERT is OR-gated by two policies, neither of which allows self-joining an arbitrary org: *"invited users can join orgs"* requires a valid unexpired invite to the user's own email with a matching role (`with_check` cross-checks `org_invites` + `user_id = auth.uid()` + `invite.role = member.role`); *"owners and admins can add members"* requires existing owner/admin. No self-join, no role escalation, no inserting for others.
- [x] **ORG-2 (Med) — RESOLVED, no leak.** `org_invites` SELECT requires `lower(email) = lower(jwt email)`. A token alone is useless; you can only read an invite addressed to your authenticated email. (App's "Wrong account" branch is unreachable — RLS returns zero rows instead. UX quirk, not security.)
- [x] **ORG-3 (Med) — effectively RESOLVED.** `isSuperAdmin` reads `super_admins` via service client (table is service-role-only). `getImpersonatedOrgId` verifies super-admin BEFORE trusting the cookie. `/api/admin/impersonate` uses server-verified `auth.getUser()`, re-checks on POST+DELETE, validates org, HttpOnly/SameSite-Lax/session cookie. **Follow-up:** confirm every read-only `/admin` *page* guards with `isSuperAdmin` (grep was empty — chase the admin layout).

### New findings from this pass
- [x] **SEC-BLOCKER-1 (BLOCKER) — RESOLVED in production 2026-05-31.** Invite acceptance was broken: every `org_members` INSERT through a normal (non-service-role) client failed with `infinite recursion detected in policy for relation "org_members"`. **Root cause:** regression of the 0012 bug via a side door — `org_members` INSERT → `"invited users can join orgs"` WITH CHECK subqueries `org_invites` → `org_invites` `"owners and admins can manage invites"` policy used an inline `SELECT ... FROM org_members` subquery → cycle `org_members → org_invites → org_members` → Postgres recursion guard trips. **Fix applied: `0023_fix_org_invites_recursion.sql`** (rewrites the `org_invites` policy to use `auth_user_org_role()`, the same remedy 0012 applied to `org_members`). **Verified live end-to-end** (`invite-path-test.js`): real user + valid invite → bare insert at `accept-invite/page.tsx:77` SUCCEEDS, member added; insert into a different org with no invite still cleanly rejected (ORG-1 intact); orgless self-join now a clean RLS denial instead of recursion. Migration file committed to `supabase/migrations/`.
- [x] **SEC-FN-1 (Low) — RESOLVED 2026-06-02.** `auth_user_org_ids()` and `auth_user_org_role()` are `SECURITY DEFINER` with no pinned `search_path`. **Fixed in `0024_security_hardening.sql`** (search_path = '' + schema-qualified bodies); APPLIED live by Jimmy 2026-06-02. Migration committed to git (`58ee4a3`). (Note: NOT the cause of SEC-BLOCKER-1 — a plpgsql/search_path rewrite was tested and did NOT stop the recursion; the org_invites policy was the real cause.)
- [~] **SEC-RLS-2 (Low→Med) — migration authored + Opus-reviewed; apply-gated on Jimmy's UI invite test.** 34 policies use the inline `SELECT ... FROM org_members` check instead of the helpers. Only the `org_invites` one formed a recursion cycle (→ fixed in 0023); the rest query `org_members` once so they don't recurse today — each is a latent footgun. **`0025_standardize_membership_policies.sql`** (Codex, `c3f0b58`) converts all 34 onto the helpers. **Opus reviewed 2026-06-03 against reconstructed migration-history ground truth: semantics-preserving, APPROVED** — command/role/WITH-CHECK preserved on all 34; `problems` correctly mapped to `auth_user_org_ids()` (any-role, not the member-and-above helper) avoiding a silent viewer-role regression. **NOT yet applied** — apply after Jimmy's UI invite test, then AFTER dump + smoke test. **Residual (non-defect):** `person_projects`/`company_projects` insert policies still use inline joins (no direct `org_id`) — out of scope, structurally different, don't recurse.
- [x] **DEF-1 (Low, defense-in-depth) — RESOLVED 2026-06-02.** `super_admins` + `platform_settings` are deny-all (RLS-on + 0 policies) — **confirmed not readable by `anon`/`authenticated` at runtime** (isolation test: 0 rows). Both carried full table GRANTs to `anon`/`authenticated` (Supabase default). **Fixed in `0024_security_hardening.sql`** (`REVOKE ALL ... FROM anon, authenticated`); APPLIED live by Jimmy 2026-06-02. Migration committed to git (`58ee4a3`).

### Systematic coverage (per the plan's scope)
- [x] **RLS enabled** — confirmed on all 30 public tables.
- [x] **Tenant isolation (static + DYNAMIC)** — Static: SELECT scoped to `auth_user_org_ids()`, writes membership+role gated across all core tables. **Dynamic PROVEN** (`isolation-test.js`, anon key + real JWT, never service_role): a throwaway orgless user sees **0 rows** across projects/evidence/sources/people/companies/artifacts/orgs/org_members/super_admins/platform_settings/org_invites, and cannot self-join an org. Test user created + deleted via service role; no real data touched. Org A ≠ Org B confirmed.
- [x] **API routes + layouts** — Verified consistent pattern on sampled routes (`ingest`, `query`): `auth.getUser()` → `getProjectForUser(user.id, project_id)` (returns null/404 if not a member) → `org_id` taken from the **verified project**, never from request body. Service client only used after this gate. `queryEvidence` filters every query by caller-supplied org_id/project_id and its only caller scopes first. The `artifacts/[id]/status` leak is already fixed.
- [~] **RLS policies** — all 30 tables enabled; core membership checks use the helpers, BUT ~33 policies still use inline `org_members` subqueries (SEC-RLS-2), one of which causes SEC-BLOCKER-1.
- [x] **Service-role vs regular client** — `createServiceClient` (RLS bypass) audited across the codebase. In API routes it appears only **after** `auth.getUser()` + `getProjectForUser` scoping (ingest, query, sources, compose, ingest/retry). Elsewhere it's in Inngest functions (trusted server context) and auth/super-admin helpers. No regular-client privilege-escalation path found.
- [x] **Inngest event boundaries** — serve handler is stock `inngest/next` `serve()` (signature verification automatic when `INNGEST_SIGNING_KEY` set — confirm key present in Vercel prod). Events (e.g. `source/ingest.requested`) carry `org_id` derived from the verified project, not user input.
- [x] **LLM payload boundaries** — VERIFIED. `redactPII` (`lib/llm/pii.ts`) applied at ingest (`ingest-source.ts:880`); `raw_content` stored in `source_segments` but never sent to a model; extraction prompt built only from `redacted_content` (`ingest-source.ts:744`); `evidence.content = claim.content` is derived purely from LLM output (`:1002`), so raw PII cannot reach evidence/synthesis. Prompt context is org_id-filtered (`:791+`) — no cross-org bleed. **Caveat:** redaction is regex-based (emails/phones/NI/cards/token-URLs only) — it does NOT anonymize names or confidential business content, which reaches the LLM by design. "Redacted" = PII-scrubbed, not anonymized.
- [x] **Super admin / impersonation** — cookie never trusted without `super_admins` table verification (`getImpersonatedOrgId` checks first); POST+DELETE on `/api/admin/impersonate` re-verify via server-side `auth.getUser()` + `isSuperAdmin`; HttpOnly/SameSite-Lax/session cookie. (ORG-3.)
- [ ] **Invite + accept-invite flow** — covered by ORG-1/ORG-2 above
- [x] **File upload + text extraction** — VERIFIED (`api/ingest/extract-text/route.ts`). Auth-first (401); 10MB cap (413); type ALLOWLIST (txt/md/markdown/pdf/docx, explicit reject of .doc + others); file read into in-memory buffer, `file.name` used only for regex extension check (no filesystem path → no path traversal); accepts only an uploaded File, never fetches a URL (no SSRF). Stateless transformer; DB write goes via `/api/ingest` (org-scoped). **Low notes:** 3rd-party parser (pdf-parse/mammoth) malformed-file risk bounded by 10MB cap; no rate-limiting (abuse/cost vector — see ROADMAP signup-backfill note).
- [ ] **Vercel env config** — secrets present and not exposed to client bundles; `NEXTAUTH`/Supabase keys server-only
- [ ] **Observability** — failures logged to `agent_runs`; no partial/poisoned data treated as trusted downstream

### Deliverables — WRITTEN 2026-06-03 → `SECURITY_ASSESSMENT_MILESTONE_0.md`
- [x] Executive summary (overall risk rating + "are external/team users safe to invite?") — **Rating LOW; verdict YES, invite-only.**
- [x] Findings table (ID, severity, files, exploit scenario, evidence, fix, verification test) — 7 rows; all blocker/high/med RESOLVED, SEC-RLS-2 latent/non-blocking.
- [x] Tenant isolation report (proof org A ≠ org B; documented exceptions incl. super admin) — dynamic proof (anon key + real JWT, never service_role); 0 rows for org-less user.

---

## C. Account access (provisioned for Opus assessment)
- [x] **Supabase** — session-pooler DB URL used for static review + dynamic isolation tests. **Credential ROTATED after assessment (2026-05-31) — access retired.** Future DB-level work goes through dashboard SQL Editor / `supabase db push`.
- [ ] **Vercel** — env var config review still outstanding: confirm `INNGEST_SIGNING_KEY`, `INNGEST_EVENT_KEY`, Supabase keys present + server-only (not exposed to client bundle). Low priority — paste `vercel env ls` when convenient.
- [ ] **Inngest** — one dashboard confirmation that the signing key is enforced (the serve handler enforces it automatically when the key is set).

## D. Apply queue (Codex owns application via `supabase db push`; Opus reviews. See `CODEX_TASKS.md`)
- [x] `0023_fix_org_invites_recursion.sql` — APPLIED + verified live (the blocker fix). NOTE: applied via raw SQL, not yet recorded in `schema_migrations` — Codex Task C reconciles via idempotent re-push.
- [x] `0024_security_hardening.sql` — DEF-1 (revoke grants) + SEC-FN-1 (pin search_path). APPLIED live by Jimmy 2026-06-02; committed to git (`58ee4a3`).
- [~] `0025_standardize_membership_policies.sql` — SEC-RLS-2 (34 policies → helpers). Authored (Codex `c3f0b58`); **Opus reviewed + APPROVED 2026-06-03.** APPLY only after Jimmy's UI invite test → then AFTER dump + smoke test → Opus diffs AFTER vs BEFORE.

## E. Delegated to Codex (account access Opus lacks)
- [ ] Vercel env audit — keys server-only, Inngest keys present (Codex Task A).
- [ ] Inngest signing-key enforcement confirmation (Codex Task B).

---

*Created 2026-05-31. Tracks Milestone 0 execution only. Update `ROADMAP.md` when the milestone ships.*
