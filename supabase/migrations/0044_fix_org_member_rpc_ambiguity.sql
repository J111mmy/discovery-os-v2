-- Repair ambiguous org_members column references discovered by the #150
-- clean-database lint gate. 0040 is already applied, so this is forward-only.

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

  select om.*
  into v_target
  from public.org_members as om
  where om.id = p_member_id
  for update;

  if not found then
    raise exception 'member not found' using errcode = '02000';
  end if;
  v_old_role := v_target.role;

  select om.role
  into v_actor_role
  from public.org_members as om
  where om.org_id = v_target.org_id
    and om.user_id = v_actor_user_id
  limit 1;

  if v_target.role = 'owner'::public.org_role then
    select count(*) = 1
    into v_target_is_last_owner
    from public.org_members as om
    where om.org_id = v_target.org_id
      and om.role = 'owner'::public.org_role;
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

  update public.org_members as om
  set role = p_new_role
  where om.id = v_target.id
  returning om.role into v_target.role;

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

  select om.*
  into v_target
  from public.org_members as om
  where om.id = p_member_id
  for update;

  if not found then
    raise exception 'member not found' using errcode = '02000';
  end if;

  select om.role
  into v_actor_role
  from public.org_members as om
  where om.org_id = v_target.org_id
    and om.user_id = v_actor_user_id
  limit 1;

  if v_target.role = 'owner'::public.org_role then
    select count(*) = 1
    into v_target_is_last_owner
    from public.org_members as om
    where om.org_id = v_target.org_id
      and om.role = 'owner'::public.org_role;
  end if;

  if not public.can_remove_org_member(
    v_actor_role,
    v_target.role,
    v_target.user_id = v_actor_user_id,
    v_target_is_last_owner
  ) then
    raise exception 'member removal not allowed' using errcode = '42501';
  end if;

  delete from public.org_members as om
  where om.id = v_target.id;

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
