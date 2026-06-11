-- Issue #32: invite-only access gate.
--
-- Creates a public-request queue plus a small principal access-status table.
-- Tables are service-role managed. Authenticated users get only the narrow
-- current_access_status() SECURITY DEFINER function used by middleware.
--
-- Do not apply until Opus reviews. Jimmy applies in Supabase.

do $$
begin
  create type public.access_request_status as enum ('pending', 'approved', 'declined');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.principal_access_status as enum ('active', 'suspended');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.access_requests (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (char_length(trim(name)) between 1 and 160),
  email               text not null check (email = lower(email) and char_length(email) <= 320),
  phone               text check (phone is null or char_length(phone) <= 80),
  company             text not null check (char_length(trim(company)) between 1 and 180),
  reason              text not null check (char_length(trim(reason)) between 1 and 1200),
  status              public.access_request_status not null default 'pending',
  request_fingerprint text,
  metadata            jsonb not null default '{}'::jsonb,
  reviewed_at         timestamptz,
  reviewed_by         uuid references auth.users(id) on delete set null,
  review_note         text check (review_note is null or char_length(review_note) <= 1000),
  invite_id           uuid references public.org_invites(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists idx_access_requests_pending_email
  on public.access_requests (lower(email))
  where status = 'pending';

create index if not exists idx_access_requests_status_created
  on public.access_requests(status, created_at desc);

create index if not exists idx_access_requests_fingerprint_created
  on public.access_requests(request_fingerprint, created_at desc)
  where request_fingerprint is not null;

alter table public.access_requests enable row level security;

-- No public/user policies. Public submission and admin review go through
-- server routes using service role so the app can rate-limit, dedupe, and avoid
-- email-existence leaks. Super admins also use service-role helpers.

create table if not exists public.user_access_status (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  status      public.principal_access_status not null default 'active',
  reason      text check (reason is null or char_length(reason) <= 1000),
  updated_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_user_access_status_status
  on public.user_access_status(status);

alter table public.user_access_status enable row level security;

-- No direct user policies. Use current_access_status() for self-checks.

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
  v_has_membership boolean := false;
  v_is_super_admin boolean := false;
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

  select exists (
    select 1
    from public.super_admins sa
    where sa.user_id = v_user_id
  )
  into v_is_super_admin;

  if v_is_super_admin then
    return 'active';
  end if;

  select exists (
    select 1
    from public.org_members om
    where om.user_id = v_user_id
  )
  into v_has_membership;

  if v_has_membership then
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

comment on table public.access_requests is
  'Public invite-only access requests. Service-role managed; no direct public RLS writes.';

comment on table public.user_access_status is
  'Principal-level active/suspended access state used by the DiscOS sign-in gate.';

comment on function public.current_access_status() is
  'Returns active/pending/declined/suspended for the authenticated principal without exposing access tables.';
