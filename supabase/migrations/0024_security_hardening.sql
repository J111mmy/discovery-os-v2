-- Security hardening from the 2026-05-31 assessment (Opus 4.8, independent review).
-- Two low-severity, defense-in-depth changes. Neither is a blocker; neither
-- changes runtime authorization behavior for normal users.
--
-- APPLY VIA: Supabase Dashboard -> SQL Editor (paste + run), or `supabase db push`.
-- (The direct-connection credential used during the assessment was rotated, so
--  this is applied through the normal migration path.)
--
-- NOT included here: SEC-RLS-2 (standardizing the ~33 policies that still use
-- inline `SELECT ... FROM org_members` subqueries onto the auth_user_org_ids()/
-- auth_user_org_role() helpers). That is a larger, mechanical change that should
-- be done as its own migration with read/write verification afterward — see the
-- assessment notes. Only the org_invites policy formed a recursion cycle, and
-- that was already fixed in 0023.

-- ============================================================
-- DEF-1 (Low, defense-in-depth): drop excess table grants on sensitive tables.
-- These tables are deny-all today (RLS enabled + 0 policies), so anon/
-- authenticated already cannot read them. But they carry full table GRANTs by
-- Supabase default; if RLS were ever disabled the super-admin list and platform
-- settings would be fully exposed. Revoke so RLS is not the *only* gate.
-- service_role and postgres retain their grants (unaffected).
-- ============================================================
revoke all on public.super_admins      from anon, authenticated;
revoke all on public.platform_settings from anon, authenticated;

-- ============================================================
-- SEC-FN-1 (Low): pin search_path on the SECURITY DEFINER helpers.
-- Supabase linter flag `function_search_path_mutable`. With search_path = ''
-- every object reference must be schema-qualified (public.org_members,
-- public.org_role, auth.uid()). Behavior is identical; this just removes the
-- search_path-injection surface on a definer-privileged function.
-- ============================================================
create or replace function public.auth_user_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select org_id from public.org_members where user_id = auth.uid()
$$;

create or replace function public.auth_user_org_role(p_org_id uuid)
returns public.org_role
language sql
stable
security definer
set search_path = ''
as $$
  select role
  from   public.org_members
  where  user_id = auth.uid()
  and    org_id  = p_org_id
  limit  1
$$;
