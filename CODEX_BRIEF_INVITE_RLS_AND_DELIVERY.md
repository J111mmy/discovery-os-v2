# Codex brief — Invite acceptance: RLS authz path + magic-link delivery

**Author:** Opus 4.8 (security reviewer / PM gate)
**Date:** 2026-06-04
**Status:** APPROVED TO BUILD — Opus reviews the migration SQL and the route refactor BEFORE Jimmy applies/merges. Codex does NOT self-clear security work.

## Why (verified root cause, from live test)

Logged in as a real invitee (`onetendegrees+member2@gmail.com`, invite token `d982c67c-…`, `accepted_at` null, not expired, confirmed via service-role query), visiting `/accept-invite?token=…` returns the **"Invite not found"** status page. The invite demonstrably exists. Two RLS walls, both confirmed in the migration set, block an invitee from accepting their own invite through the user-scoped client:

1. **`org_invites` SELECT** — `0023_fix_org_invites_recursion.sql`:
   `"owners and admins can manage invites" … using (auth_user_org_role(org_id) in ('owner','admin'))`.
   The invitee has no role in the org → cannot SELECT their own invite → route's lookup returns null → `not-found`.

2. **`org_members` INSERT** — `0012_fix_org_members_rls.sql:44`:
   `"owners and admins can add members" … with check (auth_user_org_role(org_id) in ('owner','admin'))`.
   The invitee isn't a member → cannot insert their own membership → would be `insert-failed` even if Wall 1 were fixed.

`0025_standardize_membership_policies.sql` does **not** touch `org_invites` and does not address either wall. Do not rely on it for this.

## The fix — two parts. Both required for email invites to work end-to-end.

### PART A (blocker): `SECURITY DEFINER` RPC `public.accept_invite(p_token text)`

A single DB function that runs as definer (clearing both RLS walls in one controlled place) but **authorizes the caller internally**. New migration (next number, e.g. `0027_accept_invite_rpc.sql`).

**Non-negotiable security requirements (I will check each in review):**
- **Pin `search_path`**: `SET search_path = public, pg_temp` on the function. Mandatory for SECURITY DEFINER — prevents search-path hijacking. Reject without it.
- **Authorize by caller email, server-side**: inside the function, compare `lower(invite.email) = lower(auth.jwt() ->> 'email')`. `auth.jwt()` inside a definer function returns the CALLER's claims (from `request.jwt.claims`), which is what we want. Never trust a client-passed email/org_id — derive everything from the token row + the JWT.
- **Reject mismatched caller**: if the authenticated email ≠ invite email → return status `wrong-account` (do not insert/stamp).
- **Validate state**: missing/unknown token → `not-found`; `expires_at < now()` → `expired`.
- **Idempotent**: if the caller is already a member of `invite.org_id`, do not error — stamp `accepted_at` if still null and return a success status. Re-clicks must be graceful, not `insert-failed`.
- **Atomic**: membership insert + `accepted_at` update in one function body (one transaction).
- **Least privilege on the grant**: `revoke all on function public.accept_invite(text) from public, anon;` then `grant execute … to authenticated;`. anon must not be able to call it.
- **Return a typed result** the route can map to the existing friendly status pages — e.g. an enum/text status (`accepted`, `already-member`, `not-found`, `expired`, `wrong-account`) plus `org_id` on success. Preserve the current UX states.
- **Do NOT** widen `org_invites` / `org_members` RLS for invitees. The RPC is the only acceptance path. No broad invitee INSERT/UPDATE policies.
- Ship a non-destructive `BEGIN; … ROLLBACK;` verification block (like 0023 did) proving: before = invitee blocked, after = invitee can accept exactly their own valid invite and is rejected for a mismatched-email/expired/unknown token.

**Route refactor (`src/app/accept-invite/route.ts`):** replace the four user-scoped queries (org_invites select, member lookup, org_members insert, org_invites update) with a single `supabase.rpc('accept_invite', { p_token: token })` call, and map the returned status to the existing redirects. **Keep the M1 work intact** — on success, `projectsRedirect(req, org_id)` must still write `disco_active_org` onto the returned response (do not regress that). Keep the user-scoped client for the RPC call (the function does the controlled escalation, not the app).

### PART B (delivery): stop depending on Supabase preserving a custom query param

Even with Part A, real invitees never reach `/accept-invite`. `api/org-invites/route.ts:63-74` sends a Supabase magic link with
`emailRedirectTo = ${appOrigin}/auth/callback?next=${encodeURIComponent("/accept-invite?token=…")}`.
Empirically the `next` param (carrying the token) is **dropped** on the Supabase round trip: member2 landed on `/projects` (the callback default) with the invite still pending, never having hit `/accept-invite`.

**Fix principle:** never rely on a *custom* query param surviving Supabase's redirect. Carry the invite token in the redirect URL's **path** (paths survive; Supabase only appends its own `code` param, which also survives). Suggested shape — Codex may choose the cleanest:
- `emailRedirectTo = ${appOrigin}/auth/callback/<token>` with a dynamic `/auth/callback/[token]/route.ts` that exchanges the Supabase-appended `?code` (reuse the shared `handleAuthCallback` logic), then server-side redirects to `/accept-invite?token=<token>` (an internal redirect — our own query string, not Supabase's, so it survives), which then calls the Part A RPC.
- Single code-exchange point preserved; no custom query param crosses the Supabase boundary.

Do not "fix" this by trying to coax the Supabase allowlist into preserving the nested `?next=…?token=…` — remove the dependency instead.

## Out of scope (do not touch)
- Don't apply or modify 0025; it's unrelated to this bug.
- Don't switch any app-code client to `createServiceClient()` to "fix" the RLS failure — the RPC is the sanctioned escalation.
- The `org_members` member-list showing a raw UUID instead of an email (when `display_name` is null) is a separate cosmetic issue — note it, don't bundle it here.

## Test gate (Jimmy, after Opus clears the SQL + route)
1. Apply `0027` (Jimmy runs SQL; Opus reviews the BEFORE/AFTER policy + function dump first).
2. **Part A check:** still logged in as member2 (invite still pending), visit `/accept-invite?token=d982c67c-…` → expect land on `/projects` with the project visible. Re-run the member2 query → `accepted_at` now non-null, `memberships = 1`. (This is also the long-pending **M2** verification.)
3. **Part B check:** send a fresh invite to a new `+test` address, click the actual email link end-to-end → lands accepted in the right org, no manual URL typing.
4. Negative checks: wrong-account (sign in as a different email and hit the token), expired, unknown token → correct friendly status pages, no membership created.
