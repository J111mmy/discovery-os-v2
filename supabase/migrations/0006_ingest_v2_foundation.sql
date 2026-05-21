-- DiscOS ingest v2 foundation
-- Aligns schema with the Source -> Segment -> Evidence model before agent extraction.

-- ============================================================
-- SOURCE TYPES
-- ============================================================
alter type source_type add value if not exists 'web';
alter type source_type add value if not exists 'slack';
alter type source_type add value if not exists 'usability';
alter type source_type add value if not exists 'monitoring';

-- ============================================================
-- SEGMENT CITATION ANCHORS
-- ============================================================
alter table source_segments
  add column if not exists conversation_unit_id text,
  add column if not exists char_start int,
  add column if not exists char_end int,
  add column if not exists start_time text,
  add column if not exists end_time text;

create index if not exists idx_source_segments_conversation_unit
  on source_segments(org_id, source_id, conversation_unit_id);

-- ============================================================
-- EVIDENCE EXTRACTION FIELDS
-- ============================================================
alter table evidence
  add column if not exists classification text
    check (classification in ('insight','verbatim','data_point','signal')),
  add column if not exists sentiment text
    check (sentiment in ('positive','negative','neutral','mixed'));

create index if not exists idx_evidence_classification
  on evidence(org_id, project_id, classification);

-- ============================================================
-- PROJECT FRAME JSON FOUNDATION
-- ============================================================
alter table projects add column if not exists frame_data jsonb;

create or replace function try_parse_jsonb(value text)
returns jsonb language plpgsql immutable as $$
begin
  return value::jsonb;
exception when others then
  return null;
end;
$$;

update projects
set frame_data = try_parse_jsonb(frame)
where frame_data is null
  and frame is not null
  and btrim(frame) like '{%';

drop function if exists try_parse_jsonb(text);

-- ============================================================
-- GLOBAL ENTITY TABLES
-- ============================================================
create table if not exists companies (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  name        text not null,
  domain      text,
  industry    text,
  size        text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_companies_org_name
  on companies(org_id, lower(name));
create index if not exists idx_companies_org_domain
  on companies(org_id, lower(domain));

alter table companies enable row level security;

drop policy if exists "org members can read companies" on companies;
create policy "org members can read companies"
  on companies for select using (org_id in (select auth_user_org_ids()));

drop policy if exists "members can insert companies" on companies;
create policy "members can insert companies"
  on companies for insert with check (org_id in (
    select org_id from org_members
    where user_id = auth.uid() and role in ('owner','admin','member')
  ));

drop policy if exists "members can update companies" on companies;
create policy "members can update companies"
  on companies for update using (org_id in (
    select org_id from org_members
    where user_id = auth.uid() and role in ('owner','admin','member')
  ));

create table if not exists people (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  name        text not null,
  role        text,
  email       text,
  company_id  uuid references companies(id) on delete set null,
  status      text not null default 'prospect'
    check (status in ('prospect','interviewed','concept-shown','demo-shown',
                      'beta-candidate','beta-participant','customer')),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_people_org_name
  on people(org_id, lower(name));
create index if not exists idx_people_org_email
  on people(org_id, lower(email));
create index if not exists idx_people_company
  on people(company_id);

alter table people enable row level security;

drop policy if exists "org members can read people" on people;
create policy "org members can read people"
  on people for select using (org_id in (select auth_user_org_ids()));

drop policy if exists "members can insert people" on people;
create policy "members can insert people"
  on people for insert with check (org_id in (
    select org_id from org_members
    where user_id = auth.uid() and role in ('owner','admin','member')
  ));

drop policy if exists "members can update people" on people;
create policy "members can update people"
  on people for update using (org_id in (
    select org_id from org_members
    where user_id = auth.uid() and role in ('owner','admin','member')
  ));

create table if not exists competitors (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references orgs(id) on delete cascade,
  name              text not null,
  slug              text not null,
  website           text,
  positioning       text,
  known_strengths   text,
  known_gaps        text,
  last_researched   date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (org_id, slug)
);

create index if not exists idx_competitors_org_name
  on competitors(org_id, lower(name));

alter table competitors enable row level security;

drop policy if exists "org members can read competitors" on competitors;
create policy "org members can read competitors"
  on competitors for select using (org_id in (select auth_user_org_ids()));

drop policy if exists "members can insert competitors" on competitors;
create policy "members can insert competitors"
  on competitors for insert with check (org_id in (
    select org_id from org_members
    where user_id = auth.uid() and role in ('owner','admin','member')
  ));

drop policy if exists "members can update competitors" on competitors;
create policy "members can update competitors"
  on competitors for update using (org_id in (
    select org_id from org_members
    where user_id = auth.uid() and role in ('owner','admin','member')
  ));

create table if not exists person_projects (
  person_id   uuid not null references people(id) on delete cascade,
  project_id  uuid not null references projects(id) on delete cascade,
  status      text,
  first_seen  timestamptz not null default now(),
  primary key (person_id, project_id)
);

create index if not exists idx_person_projects_project
  on person_projects(project_id);

alter table person_projects enable row level security;

drop policy if exists "org members can read person projects" on person_projects;
create policy "org members can read person projects"
  on person_projects for select using (
    exists (
      select 1
      from people p
      where p.id = person_id
        and p.org_id in (select auth_user_org_ids())
    )
  );

drop policy if exists "members can insert person projects" on person_projects;
create policy "members can insert person projects"
  on person_projects for insert with check (
    exists (
      select 1
      from people p
      join projects pr on pr.id = project_id and pr.org_id = p.org_id
      join org_members om on om.org_id = p.org_id
      where p.id = person_id
        and om.user_id = auth.uid()
        and om.role in ('owner','admin','member')
    )
  );

create table if not exists company_projects (
  company_id  uuid not null references companies(id) on delete cascade,
  project_id  uuid not null references projects(id) on delete cascade,
  first_seen  timestamptz not null default now(),
  primary key (company_id, project_id)
);

create index if not exists idx_company_projects_project
  on company_projects(project_id);

alter table company_projects enable row level security;

drop policy if exists "org members can read company projects" on company_projects;
create policy "org members can read company projects"
  on company_projects for select using (
    exists (
      select 1
      from companies c
      where c.id = company_id
        and c.org_id in (select auth_user_org_ids())
    )
  );

drop policy if exists "members can insert company projects" on company_projects;
create policy "members can insert company projects"
  on company_projects for insert with check (
    exists (
      select 1
      from companies c
      join projects pr on pr.id = project_id and pr.org_id = c.org_id
      join org_members om on om.org_id = c.org_id
      where c.id = company_id
        and om.user_id = auth.uid()
        and om.role in ('owner','admin','member')
    )
  );

-- ============================================================
-- RESOLVED ENTITY LINKS FROM EVIDENCE
-- ============================================================
alter table evidence_entities
  add column if not exists person_id uuid references people(id) on delete set null,
  add column if not exists company_id uuid references companies(id) on delete set null,
  add column if not exists competitor_id uuid references competitors(id) on delete set null,
  add column if not exists relationship text;

create unique index if not exists idx_evidence_entities_person_unique
  on evidence_entities(evidence_id, person_id)
  where person_id is not null;

create unique index if not exists idx_evidence_entities_company_unique
  on evidence_entities(evidence_id, company_id)
  where company_id is not null;

create unique index if not exists idx_evidence_entities_competitor_unique
  on evidence_entities(evidence_id, competitor_id)
  where competitor_id is not null;

create index if not exists idx_evidence_entities_resolved_people
  on evidence_entities(org_id, person_id)
  where person_id is not null;
create index if not exists idx_evidence_entities_resolved_companies
  on evidence_entities(org_id, company_id)
  where company_id is not null;
create index if not exists idx_evidence_entities_resolved_competitors
  on evidence_entities(org_id, competitor_id)
  where competitor_id is not null;

-- ============================================================
-- AGENT RUN LOG
-- ============================================================
create table if not exists agent_runs (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  project_id    uuid references projects(id) on delete set null,
  agent_type    text not null,
  status        text not null default 'running'
    check (status in ('running','completed','failed')),
  input         jsonb,
  output        jsonb,
  error         text,
  model_used    text,
  started_at    timestamptz not null default now(),
  completed_at  timestamptz
);

create index if not exists idx_agent_runs_org_project
  on agent_runs(org_id, project_id, agent_type, started_at desc);

alter table agent_runs enable row level security;

drop policy if exists "org members can read agent runs" on agent_runs;
create policy "org members can read agent runs"
  on agent_runs for select using (org_id in (select auth_user_org_ids()));

-- ============================================================
-- SKILL CONFIGS
-- ============================================================
create table if not exists skill_configs (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid references orgs(id) on delete cascade,
  skill_type      text not null,
  system_prompt   text,
  output_schema   jsonb,
  model_tier      text not null default 'standard',
  prompt_version  text,
  active          bool not null default true,
  updated_at      timestamptz not null default now(),
  unique (org_id, skill_type)
);

create unique index if not exists idx_skill_configs_system_default
  on skill_configs(skill_type)
  where org_id is null;

alter table skill_configs enable row level security;

drop policy if exists "org members can read skill configs" on skill_configs;
create policy "org members can read skill configs"
  on skill_configs for select using (
    org_id is null or org_id in (select auth_user_org_ids())
  );

drop policy if exists "org owners can manage skill configs" on skill_configs;
create policy "org owners can manage skill configs"
  on skill_configs for all using (
    org_id in (
      select org_id from org_members
      where user_id = auth.uid() and role = 'owner'
    )
  ) with check (
    org_id in (
      select org_id from org_members
      where user_id = auth.uid() and role = 'owner'
    )
  );

-- ============================================================
-- UPDATED_AT TRIGGERS
-- ============================================================
drop trigger if exists trg_companies_updated_at on companies;
create trigger trg_companies_updated_at
  before update on companies for each row execute function set_updated_at();

drop trigger if exists trg_people_updated_at on people;
create trigger trg_people_updated_at
  before update on people for each row execute function set_updated_at();

drop trigger if exists trg_competitors_updated_at on competitors;
create trigger trg_competitors_updated_at
  before update on competitors for each row execute function set_updated_at();
