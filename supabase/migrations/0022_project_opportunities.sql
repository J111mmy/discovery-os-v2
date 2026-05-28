-- Migration 0022: Project opportunities from adjacent signals
-- Captures evidence-backed suggestions for new discovery workspaces.

create table if not exists project_opportunities (
  id                         uuid primary key default gen_random_uuid(),
  org_id                     uuid not null references orgs(id) on delete cascade,
  title                      text not null,
  slug                       text not null,
  description                text,
  suggested_frame            text,
  confidence                 text not null default 'low'
    check (confidence in ('low', 'medium', 'high')),
  status                     text not null default 'suggested'
    check (status in ('suggested', 'watching', 'accepted', 'dismissed')),
  supporting_evidence_count  int not null default 0,
  source_project_count       int not null default 0,
  created_project_id         uuid references projects(id) on delete set null,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  unique (org_id, slug)
);

create index if not exists idx_project_opportunities_org_status
  on project_opportunities(org_id, status, updated_at desc);

alter table project_opportunities enable row level security;

drop policy if exists "org members can read project opportunities" on project_opportunities;
create policy "org members can read project opportunities"
  on project_opportunities for select using (org_id in (select auth_user_org_ids()));

drop policy if exists "members can insert project opportunities" on project_opportunities;
create policy "members can insert project opportunities"
  on project_opportunities for insert with check (org_id in (
    select org_id from org_members
    where user_id = auth.uid() and role in ('owner','admin','member')
  ));

drop policy if exists "members can update project opportunities" on project_opportunities;
create policy "members can update project opportunities"
  on project_opportunities for update using (org_id in (
    select org_id from org_members
    where user_id = auth.uid() and role in ('owner','admin','member')
  ));

create table if not exists project_opportunity_evidence (
  org_id          uuid not null references orgs(id) on delete cascade,
  opportunity_id  uuid not null references project_opportunities(id) on delete cascade,
  evidence_id     uuid not null references evidence(id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (opportunity_id, evidence_id)
);

create index if not exists idx_project_opportunity_evidence_evidence
  on project_opportunity_evidence(org_id, evidence_id);

alter table project_opportunity_evidence enable row level security;

drop policy if exists "org members can read project opportunity evidence" on project_opportunity_evidence;
create policy "org members can read project opportunity evidence"
  on project_opportunity_evidence for select using (org_id in (select auth_user_org_ids()));

drop policy if exists "members can insert project opportunity evidence" on project_opportunity_evidence;
create policy "members can insert project opportunity evidence"
  on project_opportunity_evidence for insert with check (org_id in (
    select org_id from org_members
    where user_id = auth.uid() and role in ('owner','admin','member')
  ));

create table if not exists project_opportunity_projects (
  org_id          uuid not null references orgs(id) on delete cascade,
  opportunity_id  uuid not null references project_opportunities(id) on delete cascade,
  project_id      uuid not null references projects(id) on delete cascade,
  relationship    text not null default 'source'
    check (relationship in ('source', 'created', 'linked')),
  created_at      timestamptz not null default now(),
  primary key (opportunity_id, project_id, relationship)
);

create index if not exists idx_project_opportunity_projects_project
  on project_opportunity_projects(org_id, project_id, relationship);

alter table project_opportunity_projects enable row level security;

drop policy if exists "org members can read project opportunity projects" on project_opportunity_projects;
create policy "org members can read project opportunity projects"
  on project_opportunity_projects for select using (org_id in (select auth_user_org_ids()));

drop policy if exists "members can insert project opportunity projects" on project_opportunity_projects;
create policy "members can insert project opportunity projects"
  on project_opportunity_projects for insert with check (org_id in (
    select org_id from org_members
    where user_id = auth.uid() and role in ('owner','admin','member')
  ));

drop trigger if exists trg_project_opportunities_updated_at on project_opportunities;
create trigger trg_project_opportunities_updated_at
  before update on project_opportunities for each row execute function set_updated_at();

comment on table project_opportunities is
  'Evidence-backed suggestions for new or adjacent discovery workspaces.';

comment on table project_opportunity_evidence is
  'Join table linking suggested projects to the evidence that supports them.';

comment on table project_opportunity_projects is
  'Join table linking opportunities to source, created, or explicitly linked projects.';
