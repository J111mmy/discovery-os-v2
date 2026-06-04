-- Invite acceptance RPC.
--
-- This function is the single controlled escalation path for accepting org
-- invites. Invitees are not members yet, so normal RLS correctly blocks them
-- from reading org_invites or inserting org_members. The SECURITY DEFINER
-- function bypasses that only after authorizing the caller's JWT email against
-- the invite row.
--
-- AUTHOR ONLY: do not apply until Opus reviews this migration.

create or replace function public.accept_invite(p_token text)
returns table(status text, org_id uuid, message text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invite public.org_invites%rowtype;
  v_user_id uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_display_name text := nullif(auth.jwt() -> 'user_metadata' ->> 'full_name', '');
  v_existing_member_id uuid;
  v_created_member boolean := false;
begin
  if v_user_id is null then
    return query select 'not-authenticated'::text, null::uuid, 'Caller must be authenticated.'::text;
    return;
  end if;

  if p_token is null or length(trim(p_token)) = 0 then
    return query select 'not-found'::text, null::uuid, 'Invite token is missing.'::text;
    return;
  end if;

  select *
  into v_invite
  from public.org_invites oi
  where oi.token = p_token
  limit 1;

  if not found then
    return query select 'not-found'::text, null::uuid, 'Invite was not found.'::text;
    return;
  end if;

  if v_email = '' or lower(v_invite.email) <> v_email then
    return query select 'wrong-account'::text, null::uuid, 'Invite belongs to a different email.'::text;
    return;
  end if;

  select id
  into v_existing_member_id
  from public.org_members om
  where om.org_id = v_invite.org_id
    and om.user_id = v_user_id
  limit 1;

  if v_invite.accepted_at is not null then
    if v_existing_member_id is not null then
      return query select 'already-member'::text, v_invite.org_id, 'Caller is already a member.'::text;
      return;
    end if;

    return query select 'already-accepted'::text, null::uuid, 'Invite has already been accepted.'::text;
    return;
  end if;

  if v_invite.expires_at < now() then
    return query select 'expired'::text, null::uuid, 'Invite has expired.'::text;
    return;
  end if;

  if v_existing_member_id is null then
    insert into public.org_members (
      org_id,
      user_id,
      role,
      display_name
    )
    values (
      v_invite.org_id,
      v_user_id,
      v_invite.role::public.org_role,
      coalesce(v_display_name, auth.jwt() ->> 'email')
    )
    returning id into v_existing_member_id;
    v_created_member := true;
  end if;

  update public.org_invites
  set accepted_at = coalesce(accepted_at, now())
  where id = v_invite.id;

  if v_created_member then
    return query select 'accepted'::text, v_invite.org_id, 'Invite accepted.'::text;
    return;
  end if;

  return query select 'already-member'::text, v_invite.org_id, 'Caller is already a member.'::text;
end;
$$;

revoke all on function public.accept_invite(text) from public, anon;
grant execute on function public.accept_invite(text) to authenticated;

comment on function public.accept_invite(text) is
  'Accepts an org invite for the authenticated user when the caller JWT email matches the invite email. Controlled SECURITY DEFINER path; do not widen invitee RLS.';

-- Verification script for reviewer/Jimmy to run manually.
--
-- This block is intentionally non-destructive. Replace the placeholders before
-- running in Supabase SQL Editor, and keep the transaction rolled back.
--
-- begin;
--
-- -- 1) As anon/no JWT, function execution should be denied by GRANT:
-- -- select * from public.accept_invite('<VALID_INVITE_TOKEN>');
--
-- -- 2) As invited user JWT, valid token should return accepted/already-member
-- -- and create exactly one matching membership:
-- -- select * from public.accept_invite('<VALID_INVITE_TOKEN>');
-- -- select accepted_at from public.org_invites where token = '<VALID_INVITE_TOKEN>';
-- -- select count(*) from public.org_members
-- -- where org_id = '<INVITE_ORG_ID>'::uuid
-- --   and user_id = auth.uid();
--
-- -- 3) Re-running with the same invited user should be idempotent and should
-- -- not create a second membership:
-- -- select * from public.accept_invite('<VALID_INVITE_TOKEN>');
-- -- select count(*) from public.org_members
-- -- where org_id = '<INVITE_ORG_ID>'::uuid
-- --   and user_id = auth.uid();
--
-- -- 3b) If accepted_at is already set but membership has been removed, the
-- -- token must not recreate access:
-- -- delete from public.org_members
-- -- where org_id = '<INVITE_ORG_ID>'::uuid
-- --   and user_id = auth.uid();
-- -- select * from public.accept_invite('<VALID_INVITE_TOKEN>');
-- -- -- expected: already-accepted
--
-- -- 4) As a different authenticated email, the same token should return
-- -- wrong-account and create no membership:
-- -- select * from public.accept_invite('<VALID_INVITE_TOKEN>');
--
-- -- 5) Unknown token should return not-found:
-- -- select * from public.accept_invite('not-a-real-token');
--
-- -- 6) Expired token should return expired and create no membership:
-- -- update public.org_invites
-- -- set expires_at = now() - interval '1 minute'
-- -- where token = '<VALID_INVITE_TOKEN>';
-- -- select * from public.accept_invite('<VALID_INVITE_TOKEN>');
--
-- rollback;
