-- Migration 0040: close org_members role-escalation paths.
--
-- GitHub #144. Direct authenticated writes to org_members let an org admin
-- promote themselves or another user to owner by using the public Supabase key.
-- Membership role changes now go through narrow SECURITY DEFINER RPCs with an
-- explicit transition matrix. Invite creation is also constrained so admins
-- cannot create owner invites that later become owner memberships.
--
-- Do not apply until Opus reviews. Jimmy applies in Supabase.

-- Reassert the hardened SECURITY DEFINER role helper from 0012/0024 as part
-- of this migration. The empty search_path is required because 0040 increases
-- the number of policies that rely on this helper.
create or replace function public.auth_user_org_role(p_org_id uuid)
returns public.org_role
language sql
stable
security definer
set search_path = ''
as $$
  select role
  from public.org_members
  where user_id = auth.uid()
    and org_id = p_org_id
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- Pure transition helpers. These do not read data; the RPC supplies the actor
-- role, old role, and ownership facts after loading rows under the definer.
-- ---------------------------------------------------------------------------

create or replace function public.can_change_org_member_role(
  p_actor_role public.org_role,
  p_old_role public.org_role,
  p_new_role public.org_role,
  p_actor_is_self boolean,
  p_target_is_last_owner boolean
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_actor_role is null or p_old_role is null or p_new_role is null then false
    when p_new_role = 'owner'::public.org_role and p_actor_role <> 'owner'::public.org_role then false
    when p_old_role = 'owner'::public.org_role and p_actor_role <> 'owner'::public.org_role then false
    when p_old_role = 'owner'::public.org_role
      and p_new_role <> 'owner'::public.org_role
      and p_target_is_last_owner then false
    when p_actor_role = 'owner'::public.org_role then true
    when p_actor_role = 'admin'::public.org_role
      and p_old_role <> 'owner'::public.org_role
      and p_new_role <> 'owner'::public.org_role
      and not p_actor_is_self then true
    else false
  end
$$;

create or replace function public.can_remove_org_member(
  p_actor_role public.org_role,
  p_target_role public.org_role,
  p_actor_is_self boolean,
  p_target_is_last_owner boolean
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_actor_role is null or p_target_role is null then false
    when p_actor_is_self then false
    when p_target_role = 'owner'::public.org_role and p_actor_role <> 'owner'::public.org_role then false
    when p_target_role = 'owner'::public.org_role and p_target_is_last_owner then false
    when p_actor_role = 'owner'::public.org_role then true
    when p_actor_role = 'admin'::public.org_role and p_target_role <> 'owner'::public.org_role then true
    else false
  end
$$;

create or replace function public.can_create_org_invite_role(
  p_actor_role public.org_role,
  p_invite_role text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_actor_role is null or p_invite_role is null then false
    when p_actor_role = 'owner'::public.org_role
      then p_invite_role = any(array['owner', 'admin', 'member', 'viewer'])
    when p_actor_role = 'admin'::public.org_role
      then p_invite_role = any(array['admin', 'member', 'viewer'])
    else false
  end
$$;

revoke all on function public.can_change_org_member_role(
  public.org_role,
  public.org_role,
  public.org_role,
  boolean,
  boolean
) from public, anon;
grant execute on function public.can_change_org_member_role(
  public.org_role,
  public.org_role,
  public.org_role,
  boolean,
  boolean
) to authenticated;

revoke all on function public.can_remove_org_member(
  public.org_role,
  public.org_role,
  boolean,
  boolean
) from public, anon;
grant execute on function public.can_remove_org_member(
  public.org_role,
  public.org_role,
  boolean,
  boolean
) to authenticated;

revoke all on function public.can_create_org_invite_role(public.org_role, text) from public, anon;
grant execute on function public.can_create_org_invite_role(public.org_role, text) to authenticated;

-- Migration-time assertions: every actor/old/new role transition is checked
-- against the intended matrix. If the helper drifts, the migration fails.
do $$
declare
  v_actor public.org_role;
  v_old public.org_role;
  v_new public.org_role;
  v_roles public.org_role[] := array[
    'owner'::public.org_role,
    'admin'::public.org_role,
    'member'::public.org_role,
    'viewer'::public.org_role
  ];
  v_expected boolean;
  v_actual boolean;
begin
  foreach v_actor in array v_roles loop
    foreach v_old in array v_roles loop
      foreach v_new in array v_roles loop
        v_expected := case
          when v_new = 'owner'::public.org_role and v_actor <> 'owner'::public.org_role then false
          when v_old = 'owner'::public.org_role and v_actor <> 'owner'::public.org_role then false
          when v_actor = 'owner'::public.org_role then true
          when v_actor = 'admin'::public.org_role
            and v_old <> 'owner'::public.org_role
            and v_new <> 'owner'::public.org_role then true
          else false
        end;

        v_actual := public.can_change_org_member_role(v_actor, v_old, v_new, false, false);
        if v_actual is distinct from v_expected then
          raise exception 'role transition assertion failed: actor %, old %, new %, expected %, got %',
            v_actor, v_old, v_new, v_expected, v_actual;
        end if;
      end loop;
    end loop;
  end loop;

  foreach v_new in array array['admin'::public.org_role, 'member'::public.org_role, 'viewer'::public.org_role] loop
    if public.can_change_org_member_role('owner'::public.org_role, 'owner'::public.org_role, v_new, false, true) then
      raise exception 'last owner demotion must be blocked for new role %', v_new;
    end if;
  end loop;

  if public.can_change_org_member_role(
    'admin'::public.org_role,
    'admin'::public.org_role,
    'owner'::public.org_role,
    true,
    false
  ) then
    raise exception 'admin self-promotion to owner must be blocked';
  end if;

  if public.can_change_org_member_role(
    'admin'::public.org_role,
    'member'::public.org_role,
    'admin'::public.org_role,
    false,
    false
  ) is not true then
    raise exception 'admin should be able to promote a non-owner member to admin';
  end if;

  if public.can_create_org_invite_role('admin'::public.org_role, 'owner') then
    raise exception 'admin owner-invite creation must be blocked';
  end if;

  if public.can_create_org_invite_role('owner'::public.org_role, 'owner') is not true then
    raise exception 'owner owner-invite creation should be allowed';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Controlled role-change RPC.
-- ---------------------------------------------------------------------------

create or replace function public.update_org_member_role(
  p_member_id uuid,
  p_new_role public.org_role
)
returns table(
  status text,
  member_id uuid,
  org_id uuid,
  old_role public.org_role,
  new_role public.org_role
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_target public.org_members%rowtype;
  v_actor_role public.org_role;
  v_old_role public.org_role;
  v_target_is_last_owner boolean := false;
begin
  if v_actor_user_id is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if p_member_id is null or p_new_role is null then
    raise exception 'member id and new role are required' using errcode = '22023';
  end if;

  select *
  into v_target
  from public.org_members
  where id = p_member_id
  for update;

  if not found then
    raise exception 'member not found' using errcode = '02000';
  end if;
  v_old_role := v_target.role;

  select role
  into v_actor_role
  from public.org_members
  where org_id = v_target.org_id
    and user_id = v_actor_user_id
  limit 1;

  if v_target.role = 'owner'::public.org_role then
    select count(*) = 1
    into v_target_is_last_owner
    from public.org_members
    where org_id = v_target.org_id
      and role = 'owner'::public.org_role;
  end if;

  if not public.can_change_org_member_role(
    v_actor_role,
    v_target.role,
    p_new_role,
    v_target.user_id = v_actor_user_id,
    v_target_is_last_owner
  ) then
    raise exception 'role transition not allowed' using errcode = '42501';
  end if;

  if v_target.role = p_new_role then
    return query select
      'unchanged'::text,
      v_target.id,
      v_target.org_id,
      v_target.role,
      v_target.role;
    return;
  end if;

  update public.org_members
  set role = p_new_role
  where id = v_target.id
  returning role into v_target.role;

  return query select
    'updated'::text,
    v_target.id,
    v_target.org_id,
    v_old_role,
    v_target.role;
end;
$$;

create or replace function public.remove_org_member(p_member_id uuid)
returns table(
  status text,
  member_id uuid,
  org_id uuid,
  removed_role public.org_role
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_target public.org_members%rowtype;
  v_actor_role public.org_role;
  v_target_is_last_owner boolean := false;
begin
  if v_actor_user_id is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if p_member_id is null then
    raise exception 'member id is required' using errcode = '22023';
  end if;

  select *
  into v_target
  from public.org_members
  where id = p_member_id
  for update;

  if not found then
    raise exception 'member not found' using errcode = '02000';
  end if;

  select role
  into v_actor_role
  from public.org_members
  where org_id = v_target.org_id
    and user_id = v_actor_user_id
  limit 1;

  if v_target.role = 'owner'::public.org_role then
    select count(*) = 1
    into v_target_is_last_owner
    from public.org_members
    where org_id = v_target.org_id
      and role = 'owner'::public.org_role;
  end if;

  if not public.can_remove_org_member(
    v_actor_role,
    v_target.role,
    v_target.user_id = v_actor_user_id,
    v_target_is_last_owner
  ) then
    raise exception 'member removal not allowed' using errcode = '42501';
  end if;

  delete from public.org_members
  where id = v_target.id;

  return query select
    'removed'::text,
    v_target.id,
    v_target.org_id,
    v_target.role;
end;
$$;

revoke all on function public.update_org_member_role(uuid, public.org_role) from public, anon;
grant execute on function public.update_org_member_role(uuid, public.org_role) to authenticated;

revoke all on function public.remove_org_member(uuid) from public, anon;
grant execute on function public.remove_org_member(uuid) to authenticated;

comment on function public.update_org_member_role(uuid, public.org_role) is
  'Controlled SECURITY DEFINER role-change path for org_members. Owners can manage owner roles while preserving at least one owner; admins can manage only non-owner roles and cannot self-elevate.';

comment on function public.remove_org_member(uuid) is
  'Controlled SECURITY DEFINER membership removal path. Blocks self-removal, admin removal of owners, and removal of the last owner.';

-- ---------------------------------------------------------------------------
-- Remove direct user-scoped writes to org_members. Service-role and definer RPCs
-- remain able to write; authenticated users can still read through SELECT RLS.
-- ---------------------------------------------------------------------------

drop policy if exists "owners and admins can add members" on public.org_members;
drop policy if exists "owners and admins can update members" on public.org_members;
drop policy if exists "owners can remove members" on public.org_members;
drop policy if exists "invited users can join orgs" on public.org_members;

revoke insert, update, delete on public.org_members from anon, authenticated;
grant select on public.org_members to authenticated;

do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'org_members'
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'org_members must not expose direct authenticated write policies';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Constrain direct org_invites writes so owner creation requires an owner.
-- Admins may still create/manage admin/member/viewer invites, matching the
-- existing teammate-invite route, but cannot mint an owner invite.
-- ---------------------------------------------------------------------------

drop policy if exists "owners and admins can manage invites" on public.org_invites;
drop policy if exists "invited users can accept their invite" on public.org_invites;
create policy "owners and admins can manage invites"
  on public.org_invites for all
  to public
  using (
    public.can_create_org_invite_role(public.auth_user_org_role(org_id), role)
  )
  with check (
    public.can_create_org_invite_role(public.auth_user_org_role(org_id), role)
  );
