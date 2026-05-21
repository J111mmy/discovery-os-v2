-- Phase 2 app surfaces: review actions, source management, invites, and artifact history
create extension if not exists pgcrypto;

-- Evidence review actions
drop policy if exists "members can update evidence trust" on evidence;
create policy "members can update evidence trust"
  on evidence for update
  using (org_id in (
    select org_id from org_members
    where user_id = auth.uid() and role in ('owner', 'admin', 'member')
  ))
  with check (org_id in (
    select org_id from org_members
    where user_id = auth.uid() and role in ('owner', 'admin', 'member')
  ));

drop policy if exists "members can delete evidence" on evidence;
create policy "members can delete evidence"
  on evidence for delete
  using (org_id in (
    select org_id from org_members
    where user_id = auth.uid() and role in ('owner', 'admin', 'member')
  ));

-- Source management
drop policy if exists "members can update sources" on sources;
create policy "members can update sources"
  on sources for update
  using (org_id in (
    select org_id from org_members
    where user_id = auth.uid() and role in ('owner', 'admin', 'member')
  ))
  with check (org_id in (
    select org_id from org_members
    where user_id = auth.uid() and role in ('owner', 'admin', 'member')
  ));

drop policy if exists "members can delete sources" on sources;
create policy "members can delete sources"
  on sources for delete
  using (org_id in (
    select org_id from org_members
    where user_id = auth.uid() and role in ('owner', 'admin', 'member')
  ));

drop policy if exists "members can delete segments" on source_segments;
create policy "members can delete segments"
  on source_segments for delete
  using (org_id in (
    select org_id from org_members
    where user_id = auth.uid() and role in ('owner', 'admin', 'member')
  ));

drop policy if exists "members can insert ingest jobs" on ingest_jobs;
create policy "members can insert ingest jobs"
  on ingest_jobs for insert
  with check (org_id in (
    select org_id from org_members
    where user_id = auth.uid() and role in ('owner', 'admin', 'member')
  ));

drop policy if exists "members can update ingest jobs" on ingest_jobs;
create policy "members can update ingest jobs"
  on ingest_jobs for update
  using (org_id in (
    select org_id from org_members
    where user_id = auth.uid() and role in ('owner', 'admin', 'member')
  ))
  with check (org_id in (
    select org_id from org_members
    where user_id = auth.uid() and role in ('owner', 'admin', 'member')
  ));

-- Artifact library
drop policy if exists "members can delete artifacts" on artifacts;
create policy "members can delete artifacts"
  on artifacts for delete
  using (org_id in (
    select org_id from org_members
    where user_id = auth.uid() and role in ('owner', 'admin', 'member')
  ));

drop policy if exists "org members can read artifact versions" on artifact_versions;
create policy "org members can read artifact versions"
  on artifact_versions for select
  using (org_id in (select auth_user_org_ids()));

drop policy if exists "members can insert artifact versions" on artifact_versions;
create policy "members can insert artifact versions"
  on artifact_versions for insert
  with check (org_id in (
    select org_id from org_members
    where user_id = auth.uid() and role in ('owner', 'admin', 'member')
  ));

-- Team invites
create table if not exists org_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  email text not null,
  role text not null default 'member',
  token text not null unique default encode(extensions.gen_random_bytes(32), 'hex'),
  accepted_at timestamptz,
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now()
);

create index if not exists idx_org_invites_org on org_invites(org_id);
create index if not exists idx_org_invites_email on org_invites(lower(email));
alter table org_invites enable row level security;

drop policy if exists "owners and admins can manage invites" on org_invites;
create policy "owners and admins can manage invites"
  on org_invites for all
  using (org_id in (
    select org_id from org_members
    where user_id = auth.uid() and role in ('owner', 'admin')
  ))
  with check (org_id in (
    select org_id from org_members
    where user_id = auth.uid() and role in ('owner', 'admin')
  ));

drop policy if exists "invited users can read their invite" on org_invites;
create policy "invited users can read their invite"
  on org_invites for select
  using (
    lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and accepted_at is null
    and expires_at > now()
  );

drop policy if exists "invited users can accept their invite" on org_invites;
create policy "invited users can accept their invite"
  on org_invites for update
  using (
    lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and accepted_at is null
    and expires_at > now()
  )
  with check (
    lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

drop policy if exists "invited users can join orgs" on org_members;
create policy "invited users can join orgs"
  on org_members for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from org_invites
      where org_invites.org_id = org_members.org_id
        and lower(org_invites.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        and org_invites.accepted_at is null
        and org_invites.expires_at > now()
        and org_invites.role = org_members.role::text
    )
  );
