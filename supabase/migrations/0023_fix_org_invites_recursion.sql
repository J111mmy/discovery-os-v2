-- Fix infinite recursion that blocks invite acceptance.
--
-- Root cause (regression of the 0012 bug via a side door):
-- Inserting into org_members evaluates the "invited users can join orgs"
-- WITH CHECK, which subqueries org_invites. That subquery is evaluated under
-- org_invites' own RLS, and the "owners and admins can manage invites" policy
-- (0003) still uses an INLINE subquery on org_members. Because org_members is
-- already mid-evaluation, Postgres' RLS recursion guard trips:
--   org_members (INSERT) -> org_invites -> org_members  => "infinite recursion
--   detected in policy for relation org_members".
--
-- Effect: EVERY org_members INSERT made through a normal (non-service-role)
-- client fails, so accept-invite (src/app/accept-invite/page.tsx) cannot add a
-- member. New orgs only exist because ensureUserOrg() uses the service client,
-- which bypasses RLS.
--
-- Fix: same remedy 0012 applied to org_members — replace the inline org_members
-- subquery with the SECURITY DEFINER helper auth_user_org_role(), which queries
-- org_members without re-entering its RLS. This is the LAST policy still using
-- the inline pattern in a way that forms a cycle back to org_members.
--
-- Verified non-destructively (BEGIN/ROLLBACK) against production on 2026-05-31:
--   before -> org_members INSERT errors with "infinite recursion ..."
--   after  -> org_members INSERT returns a clean RLS decision (no recursion).

drop policy if exists "owners and admins can manage invites" on org_invites;

create policy "owners and admins can manage invites"
  on org_invites for all
  using      (auth_user_org_role(org_id) in ('owner', 'admin'))
  with check (auth_user_org_role(org_id) in ('owner', 'admin'));
