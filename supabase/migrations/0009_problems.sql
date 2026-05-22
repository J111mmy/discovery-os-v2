-- Problem discovery — structured problem statements surfaced from themes
-- Run after 0008_evidence_themes_join.sql

-- Enums
do $$ begin
  create type problem_severity as enum ('high', 'medium', 'low');
exception when duplicate_object then null; end $$;

do $$ begin
  create type problem_status as enum ('surfaced', 'acknowledged', 'active', 'resolved', 'dismissed');
exception when duplicate_object then null; end $$;

-- Problems table
create table if not exists problems (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references orgs(id) on delete cascade,
  project_id          uuid not null references projects(id) on delete cascade,
  title               text not null,
  description         text,
  severity            problem_severity not null default 'medium',
  status              problem_status not null default 'surfaced',
  -- arrays of UUIDs keep the schema simple; join tables added later if needed
  source_theme_ids    uuid[] not null default '{}',
  source_evidence_ids uuid[] not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Unique constraint — prevents duplicate problem titles per project
-- (used by upsert in discover-problems Inngest function)
create unique index if not exists problems_project_title_idx
  on problems(org_id, project_id, title);

create index if not exists problems_status_idx
  on problems(org_id, project_id, status);

-- Updated-at trigger
create or replace function update_problems_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists problems_updated_at on problems;
create trigger problems_updated_at
  before update on problems
  for each row execute function update_problems_updated_at();

-- RLS
alter table problems enable row level security;

-- Org members can read
create policy "org members can read problems"
  on problems for select
  using (
    exists (
      select 1 from org_members
      where org_members.org_id = problems.org_id
        and org_members.user_id = auth.uid()
    )
  );

-- Org members can insert
create policy "org members can insert problems"
  on problems for insert
  with check (
    exists (
      select 1 from org_members
      where org_members.org_id = problems.org_id
        and org_members.user_id = auth.uid()
    )
  );

-- Org members can update
create policy "org members can update problems"
  on problems for update
  using (
    exists (
      select 1 from org_members
      where org_members.org_id = problems.org_id
        and org_members.user_id = auth.uid()
    )
  );

-- Service role bypass (Inngest functions use the service client)
create policy "service role bypass problems"
  on problems for all
  using (auth.role() = 'service_role');

-- Track last problem discovery on projects
alter table projects
  add column if not exists problems_discovered_at timestamptz;
