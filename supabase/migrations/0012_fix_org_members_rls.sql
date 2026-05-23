-- Fix infinite recursion in org_members RLS policies.
--
-- Root cause: policies in 0003 used inline subqueries on org_members inside
-- policies *on* org_members, causing Postgres to recurse infinitely when
-- evaluating any read/write against that table.
--
-- Fix: replace every inline subquery with SECURITY DEFINER function calls.
-- auth_user_org_ids() already exists (0001) and bypasses RLS.
-- auth_user_org_role() is new here — returns the current user's role in a
-- given org without triggering RLS on org_members.

-- ============================================================
-- HELPER: role lookup (SECURITY DEFINER bypasses RLS)
-- ============================================================
create or replace function auth_user_org_role(p_org_id uuid)
returns org_role language sql security definer stable as $$
  select role
  from   org_members
  where  user_id = auth.uid()
  and    org_id  = p_org_id
  limit  1
$$;

-- ============================================================
-- DROP old recursive policies
-- ============================================================
drop policy if exists "org members can see each other"    on org_members;
drop policy if exists "owners and admins can add members" on org_members;
drop policy if exists "owners and admins can update members" on org_members;
drop policy if exists "owners can remove members"         on org_members;

-- "users can read own memberships" uses only auth.uid() — no recursion, keep it.

-- ============================================================
-- RECREATE policies using SECURITY DEFINER functions
-- ============================================================

-- Members can see all members in any org they belong to
create policy "org members can see each other"
  on org_members for select
  using (org_id in (select auth_user_org_ids()));

-- Only owners and admins can add new members
create policy "owners and admins can add members"
  on org_members for insert
  with check (auth_user_org_role(org_id) in ('owner', 'admin'));

-- Only owners and admins can update member roles
create policy "owners and admins can update members"
  on org_members for update
  using (auth_user_org_role(org_id) in ('owner', 'admin'));

-- Only owners can remove members
create policy "owners can remove members"
  on org_members for delete
  using (auth_user_org_role(org_id) = 'owner');
