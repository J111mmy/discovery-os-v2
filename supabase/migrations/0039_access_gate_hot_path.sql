-- Issue #133: keep the access gate fast and avoid hot-path timeouts.
--
-- Review-gated. Jimmy applies in Supabase after approval.

create index if not exists idx_access_requests_email_created
  on public.access_requests(email, created_at desc);

create or replace function public.current_access_status()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_status public.principal_access_status;
  v_request_status public.access_request_status;
begin
  if v_user_id is null then
    return 'anonymous';
  end if;

  select uas.status
  into v_status
  from public.user_access_status uas
  where uas.user_id = v_user_id;

  if v_status = 'suspended' then
    return 'suspended';
  end if;

  if exists (
    select 1
    from public.org_members om
    where om.user_id = v_user_id
    limit 1
  ) then
    return 'active';
  end if;

  if exists (
    select 1
    from public.super_admins sa
    where sa.user_id = v_user_id
  ) then
    return 'active';
  end if;

  if v_email <> '' then
    select ar.status
    into v_request_status
    from public.access_requests ar
    where ar.email = v_email
    order by ar.created_at desc
    limit 1;

    if v_request_status = 'declined' then
      return 'declined';
    end if;

    if v_request_status = 'pending' or v_request_status = 'approved' then
      return 'pending';
    end if;
  end if;

  return 'pending';
end;
$$;

revoke all on function public.current_access_status() from public, anon;
grant execute on function public.current_access_status() to authenticated;

comment on function public.current_access_status() is
  'Returns active/pending/declined/suspended for the authenticated principal without exposing access tables. Hot-path optimized in 0039.';
