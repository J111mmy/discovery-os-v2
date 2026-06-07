# Milestone 0 — Independent Security Assessment

**Author:** Opus 4.8 — independent security reviewer (NOT the backend author; Codex authored the backend).
**Date:** 2026-06-03 (assessment work 2026-05-31 → 2026-06-02).
**Scope:** Multi-tenant isolation, auth/org-scoping, RLS, service-role usage, Inngest event boundaries, LLM payload boundaries, file upload, super-admin/impersonation.
**Question this answers:** *Is it safe to invite the Veyor team (and future external design-partner users) into the live app?*

---

## 1. Executive summary

**Overall risk rating: LOW. Verdict: YES — safe to invite the Veyor team, invite-only.**

The application enforces tenant isolation at the database layer (Postgres RLS) rather than relying on application code alone. Every core table restricts reads to the caller's organizations via the `auth_user_org_ids()` SECURITY DEFINER helper, and writes are gated by membership + role. I proved isolation **dynamically** — not just by reading policy text — using the anon key plus real user JWTs (never the service-role key): a throwaway org-less user sees **zero rows** across every tenant table and cannot self-join an org.

One **blocker** was found and **fixed live** during the assessment:

- **SEC-BLOCKER-1** — invite acceptance was completely broken by an RLS recursion cycle (`org_members → org_invites → org_members`). Fixed in `0023_fix_org_invites_recursion.sql`, applied live, and verified end-to-end. Invite acceptance now works.

All other findings are **low severity**. Two (DEF-1, SEC-FN-1) were hardened in `0024_security_hardening.sql`, applied live 2026-06-02. One (SEC-RLS-2) is a **latent footgun, not an active hole** — ~33 policies still use inline `org_members` subqueries; only the `org_invites` one ever formed a recursion cycle (now fixed). The remaining policies query `org_members` once and do not recurse today. They are being standardized onto the helpers in a dedicated migration (`0025`, authored, apply-gated). This does **not** block inviting the team.

**Conditions / residual items (none blocking):**
1. **Invite-only onboarding is mandatory.** Self-signup + first-project creation auto-provisions a *new isolated org*. Never tell a teammate to "just sign up" — send invites so they attach to the existing Veyor org.
2. **Two environment confirmations still pending** (low risk, dashboard-only): Vercel env audit (secrets server-only, not in client bundle) and Inngest signing-key enforcement. The serve handler enforces signature verification automatically when the key is set; we need a one-time confirmation the key is present in prod.
3. **"Redaction" means PII-scrubbed, not anonymized.** Names and confidential business content reach the LLM by design. This is expected for the product, but should be stated plainly to design-partner orgs handling confidential GC material.

---

## 2. Findings table

| ID | Severity | Status | Files / policy | Exploit scenario | Evidence | Fix | Verification |
|----|----------|--------|----------------|------------------|----------|-----|--------------|
| **SEC-BLOCKER-1** | **BLOCKER** | **RESOLVED (live 2026-05-31)** | `org_invites` policy *"owners and admins can manage invites"*; `org_members` *"invited users can join orgs"* | Invite acceptance fails for every user: `org_members` INSERT → invited-users WITH CHECK subqueries `org_invites` → org_invites policy ran inline `SELECT … FROM org_members` → cycle → Postgres recursion guard trips. No one can join an org → team cannot be onboarded. | `infinite recursion detected in policy for relation "org_members"` on bare insert at `accept-invite/page.tsx:77`. | `0023_fix_org_invites_recursion.sql` — rewrites the org_invites policy to use `auth_user_org_role()` (same remedy 0012 applied to org_members). | `invite-path-test.js`: real user + valid invite → insert SUCCEEDS, member added; insert into a different org with no invite still cleanly REJECTED (ORG-1 intact); org-less self-join → clean RLS denial, no recursion. Applied live + committed (`58ee4a3`). |
| **ORG-1** | High | RESOLVED (no hole) | `org_members` INSERT policies | Self-join an arbitrary org / escalate role / insert membership for another user. | Two OR-gated INSERT policies; neither permits self-join. | Pre-existing design correct. | Dynamic: org-less user self-insert REJECTED. |
| **ORG-2** | Med | RESOLVED (no leak) | `org_invites` SELECT policy | Read invites addressed to others using only a token. | SELECT requires `lower(email)=lower(jwt email)`. Token alone useless. | Pre-existing design correct. | App "wrong account" branch is unreachable (RLS returns 0 rows) — UX quirk, not security. |
| **ORG-3** | Med | RESOLVED (effectively) | `super-admin.ts`, `/api/admin/impersonate` | Forge impersonation cookie / read admin tables. | Cookie never trusted without `super_admins` table verification; POST+DELETE re-verify via server `auth.getUser()`; HttpOnly/SameSite-Lax/session cookie. | Pre-existing design correct. | `super_admins` is service-role-only; isolation test returns 0 rows for authenticated. |
| **DEF-1** | Low (defense-in-depth) | **RESOLVED (live 2026-06-02)** | `super_admins`, `platform_settings` | Tables were deny-all via RLS but still carried default table GRANTs to `anon`/`authenticated`. | Isolation test already showed 0 rows; GRANTs were a latent surface only. | `0024_security_hardening.sql` — `REVOKE ALL … FROM anon, authenticated`. | Applied live, committed (`58ee4a3`); isolation test still 0 rows. |
| **SEC-FN-1** | Low | **RESOLVED (live 2026-06-02)** | `auth_user_org_ids()`, `auth_user_org_role()` | SECURITY DEFINER functions with no pinned `search_path` → theoretical search-path hijack. | Both were `SECURITY DEFINER` without `set search_path`. | `0024_security_hardening.sql` — `set search_path = ''` + schema-qualified bodies. | Applied live, committed (`58ee4a3`); helpers still return correct org(s) for a real member. NOT the cause of SEC-BLOCKER-1 (tested). |
| **SEC-RLS-2** | Low→Med | OPEN (latent, non-blocking; migration `0025` authored, apply-gated) | ~33 policies across actions/artifacts/companies/competitors/evidence/people/problems/projects/sources/etc. | Inline `SELECT … FROM org_members` subqueries instead of helpers. Each is a latent recursion footgun if another policy ever references it in a cycle. | Only the `org_invites` instance formed a cycle (→ SEC-BLOCKER-1, fixed). The rest query `org_members` once → no recursion today. | `0025_standardize_membership_policies.sql` — semantics-preserving conversion onto `auth_user_org_ids()` / `auth_user_org_role()`. | **Apply-gated:** Opus reviews BEFORE/AFTER `pg_policies` dump + Jimmy runs UI invite test before apply. Does NOT block inviting the team. |

---

## 3. Tenant isolation report

**Claim proven: Org A cannot see or write Org B's data, and an org-less user sees nothing.**

### Method
- **Static:** read every RLS policy on the 30 public tables. SELECT scoped to `auth_user_org_ids()`; writes gated by membership + role via `auth_user_org_ids()` / `auth_user_org_role()`.
- **Dynamic (the real proof):** `isolation-test.js`, run with the **anon key + real user JWTs only — never the service-role key** (using service_role would defeat the purpose by bypassing RLS). A throwaway org-less user was created and deleted via service role (account lifecycle only; no real data touched).

### Results
- The org-less user returns **0 rows** across: `projects`, `evidence`, `sources`, `people`, `companies`, `artifacts`, `orgs`, `org_members`, `super_admins`, `platform_settings`, `org_invites`.
- The org-less user **cannot self-join** an org (`org_members` self-insert cleanly rejected — post-0023 this is a clean RLS denial, not a recursion error).
- Org A ≠ Org B confirmed: a member of one org sees only that org's rows.

### Application-layer reinforcement
RLS is the backstop; the app also scopes correctly. Sampled API routes (`ingest`, `query`) follow: `auth.getUser()` → `getProjectForUser(user.id, project_id)` (404 if not a member) → `org_id` taken from the **verified project**, never from request body. `createServiceClient` (RLS bypass) appears only **after** this gate in routes, and otherwise only in Inngest functions (trusted server context) and auth/super-admin helpers. No regular-client privilege-escalation path found.

### Documented exceptions
- **Super admin / impersonation** — intentional cross-org access, but cookie is never trusted without `super_admins` verification, and `/api/admin/impersonate` re-verifies on POST+DELETE. (ORG-3.)
- **Service role** in Inngest functions and auth helpers — trusted server context, never reachable from a regular authenticated client.

### LLM & file-upload boundaries (isolation-adjacent)
- **LLM:** `redactPII` applied at ingest; `raw_content` never sent to a model; extraction prompt built only from `redacted_content`; prompt context org_id-filtered (no cross-org bleed). **Caveat:** redaction is regex-based (emails/phones/NI/cards/token-URLs) — it does NOT anonymize names or confidential business content, which reach the LLM by design.
- **File upload** (`api/ingest/extract-text`): auth-first (401), 10MB cap (413), type allowlist, in-memory buffer (no filesystem path → no traversal), no URL fetch (no SSRF). Low notes: 3rd-party parser malformed-file risk bounded by the size cap; no rate-limiting (cost/abuse vector — tracked in ROADMAP).

---

## 4. What still needs doing (none block the invite)

1. **SEC-RLS-2 / migration `0025`** — author done by Codex; apply only after Opus before/after review + Jimmy's UI invite test. Latent hardening, not an active hole.
2. **Vercel env audit** — confirm `INNGEST_SIGNING_KEY`, `INNGEST_EVENT_KEY`, Supabase keys present and server-only (no `NEXT_PUBLIC_` duplication of secrets). Paste `vercel env ls` (names only).
3. **Inngest signing-key enforcement** — one dashboard confirmation the key is set in prod (handler enforces verification automatically when present).

---

*Closes the Milestone 0 security gate (checklist section B "Deliverables"). All blocker- and high-severity findings resolved; residual items are low-severity and tracked. Recommendation: proceed with invite-only onboarding of the Veyor team.*
