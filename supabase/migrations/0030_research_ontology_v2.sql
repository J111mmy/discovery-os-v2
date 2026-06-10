-- Research ontology v2
-- Jimmy applies this in Supabase only after Opus reviews this SQL, the
-- problem-discovery rewrite, and the dry-run report.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$ begin
  create type analysis_source as enum ('ai', 'human', 'imported', 'system');
exception when duplicate_object then null; end $$;

do $$ begin
  create type review_state as enum ('suggested', 'accepted', 'edited', 'rejected', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type theme_status as enum ('draft', 'reviewed', 'accepted', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type evidence_relation as enum ('supporting', 'contradicting', 'example', 'edge_case', 'provenance');
exception when duplicate_object then null; end $$;

do $$ begin
  create type theme_relation as enum ('primary', 'contributing', 'provenance');
exception when duplicate_object then null; end $$;

do $$ begin
  create type output_relation as enum ('source', 'supporting', 'created_from', 'cites', 'addresses');
exception when duplicate_object then null; end $$;

do $$ begin
  create type opportunity_status as enum ('suggested', 'accepted', 'active', 'dismissed', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type opportunity_confidence as enum ('low', 'medium', 'high');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Descriptive layer: tags and topics
-- ---------------------------------------------------------------------------

create table if not exists tags (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  project_id  uuid references projects(id) on delete cascade,
  label       text not null,
  label_key   text not null,
  description text,
  color       text,
  created_by  uuid,
  created_at  timestamptz not null default now()
);

create unique index if not exists tags_org_project_label_key_idx
  on tags(org_id, coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid), label_key);

create table if not exists evidence_tags (
  org_id      uuid not null references orgs(id) on delete cascade,
  project_id  uuid not null references projects(id) on delete cascade,
  evidence_id uuid not null references evidence(id) on delete cascade,
  tag_id      uuid not null references tags(id) on delete cascade,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  primary key (evidence_id, tag_id)
);

create index if not exists evidence_tags_project_tag_idx
  on evidence_tags(org_id, project_id, tag_id);

create table if not exists topics (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade,
  project_id      uuid not null references projects(id) on delete cascade,
  label           text not null,
  label_key       text not null,
  description     text,
  parent_topic_id uuid references topics(id) on delete set null,
  source          analysis_source not null default 'ai',
  review_state    review_state not null default 'suggested',
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (org_id, project_id, label_key)
);

create index if not exists topics_project_review_idx
  on topics(org_id, project_id, review_state, updated_at desc);

create table if not exists evidence_topics (
  org_id        uuid not null references orgs(id) on delete cascade,
  project_id    uuid not null references projects(id) on delete cascade,
  evidence_id   uuid not null references evidence(id) on delete cascade,
  topic_id      uuid not null references topics(id) on delete cascade,
  source        analysis_source not null default 'ai',
  review_state  review_state not null default 'suggested',
  confidence    numeric,
  rationale     text,
  agent_run_id  uuid references agent_runs(id) on delete set null,
  accepted_by   uuid,
  accepted_at   timestamptz,
  created_at    timestamptz not null default now(),
  primary key (evidence_id, topic_id)
);

create index if not exists evidence_topics_project_topic_idx
  on evidence_topics(org_id, project_id, topic_id, review_state);

-- ---------------------------------------------------------------------------
-- Interpretive layer: themes
-- ---------------------------------------------------------------------------

alter table themes
  add column if not exists central_concept text,
  add column if not exists interpretation text,
  add column if not exists status theme_status not null default 'draft',
  add column if not exists source analysis_source not null default 'ai',
  add column if not exists review_state review_state not null default 'suggested',
  add column if not exists confidence text check (confidence in ('low', 'medium', 'high')),
  add column if not exists agent_run_id uuid references agent_runs(id) on delete set null,
  add column if not exists accepted_by uuid,
  add column if not exists accepted_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists trg_themes_updated_at on themes;
create trigger trg_themes_updated_at
  before update on themes for each row execute function set_updated_at();

create table if not exists theme_topics (
  org_id       uuid not null references orgs(id) on delete cascade,
  project_id   uuid not null references projects(id) on delete cascade,
  theme_id     uuid not null references themes(id) on delete cascade,
  topic_id     uuid not null references topics(id) on delete cascade,
  relationship theme_relation not null default 'contributing',
  rationale    text,
  created_at   timestamptz not null default now(),
  primary key (theme_id, topic_id, relationship)
);

create index if not exists theme_topics_project_topic_idx
  on theme_topics(org_id, project_id, topic_id, relationship);

create table if not exists theme_evidence (
  org_id       uuid not null references orgs(id) on delete cascade,
  project_id   uuid not null references projects(id) on delete cascade,
  theme_id     uuid not null references themes(id) on delete cascade,
  evidence_id  uuid not null references evidence(id) on delete cascade,
  relationship evidence_relation not null default 'supporting',
  source       analysis_source not null default 'ai',
  review_state review_state not null default 'suggested',
  confidence   numeric,
  rationale    text,
  agent_run_id uuid references agent_runs(id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (theme_id, evidence_id, relationship)
);

create index if not exists theme_evidence_project_evidence_idx
  on theme_evidence(org_id, project_id, evidence_id, relationship);

-- ---------------------------------------------------------------------------
-- Decision layer: problems with typed support
-- ---------------------------------------------------------------------------

alter table problems
  add column if not exists statement text,
  add column if not exists who_affected text,
  add column if not exists what_is_hard text,
  add column if not exists why_it_matters text,
  add column if not exists current_workarounds text[] not null default '{}',
  add column if not exists current_tools text[] not null default '{}',
  add column if not exists confidence text check (confidence in ('low', 'medium', 'high')),
  add column if not exists freshness text,
  add column if not exists source analysis_source not null default 'ai',
  add column if not exists review_state review_state not null default 'suggested',
  add column if not exists agent_run_id uuid references agent_runs(id) on delete set null,
  add column if not exists accepted_by uuid,
  add column if not exists accepted_at timestamptz,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists problem_themes (
  org_id       uuid not null references orgs(id) on delete cascade,
  project_id   uuid not null references projects(id) on delete cascade,
  problem_id   uuid not null references problems(id) on delete cascade,
  theme_id     uuid not null references themes(id) on delete cascade,
  relationship theme_relation not null,
  source       analysis_source not null default 'ai',
  review_state review_state not null default 'suggested',
  rationale    text,
  agent_run_id uuid references agent_runs(id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (problem_id, theme_id, relationship)
);

create index if not exists problem_themes_project_theme_idx
  on problem_themes(org_id, project_id, theme_id, relationship);

create table if not exists problem_evidence (
  org_id       uuid not null references orgs(id) on delete cascade,
  project_id   uuid not null references projects(id) on delete cascade,
  problem_id   uuid not null references problems(id) on delete cascade,
  evidence_id  uuid not null references evidence(id) on delete cascade,
  relationship evidence_relation not null default 'supporting',
  source       analysis_source not null default 'ai',
  review_state review_state not null default 'suggested',
  confidence   numeric,
  rationale    text,
  agent_run_id uuid references agent_runs(id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (problem_id, evidence_id, relationship)
);

create index if not exists problem_evidence_project_evidence_idx
  on problem_evidence(org_id, project_id, evidence_id, relationship);

create table if not exists problem_topics (
  org_id       uuid not null references orgs(id) on delete cascade,
  project_id   uuid not null references projects(id) on delete cascade,
  problem_id   uuid not null references problems(id) on delete cascade,
  topic_id     uuid not null references topics(id) on delete cascade,
  relationship theme_relation not null default 'provenance',
  source       analysis_source not null default 'ai',
  review_state review_state not null default 'suggested',
  rationale    text,
  agent_run_id uuid references agent_runs(id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (problem_id, topic_id, relationship)
);

create index if not exists problem_topics_project_topic_idx
  on problem_topics(org_id, project_id, topic_id, relationship);

-- ---------------------------------------------------------------------------
-- Operational/output layer. `project_opportunities` remains suggested
-- workspaces. This table owns product opportunities linked to problems.
-- ---------------------------------------------------------------------------

create table if not exists opportunities (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references orgs(id) on delete cascade,
  project_id     uuid not null references projects(id) on delete cascade,
  title          text not null,
  description    text,
  how_might_we   text,
  status         opportunity_status not null default 'suggested',
  confidence     opportunity_confidence not null default 'low',
  source         analysis_source not null default 'ai',
  review_state   review_state not null default 'suggested',
  agent_run_id   uuid references agent_runs(id) on delete set null,
  created_by     uuid,
  accepted_by    uuid,
  accepted_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (org_id, project_id, title)
);

create index if not exists opportunities_project_status_idx
  on opportunities(org_id, project_id, status, updated_at desc);

drop trigger if exists trg_opportunities_updated_at on opportunities;
create trigger trg_opportunities_updated_at
  before update on opportunities for each row execute function set_updated_at();

create table if not exists problem_opportunities (
  org_id         uuid not null references orgs(id) on delete cascade,
  project_id     uuid not null references projects(id) on delete cascade,
  problem_id     uuid not null references problems(id) on delete cascade,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  relationship   output_relation not null default 'created_from',
  source         analysis_source not null default 'ai',
  review_state   review_state not null default 'suggested',
  rationale      text,
  created_at     timestamptz not null default now(),
  primary key (problem_id, opportunity_id, relationship)
);

create table if not exists opportunity_evidence (
  org_id         uuid not null references orgs(id) on delete cascade,
  project_id     uuid not null references projects(id) on delete cascade,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  evidence_id    uuid not null references evidence(id) on delete cascade,
  relationship   output_relation not null default 'supporting',
  rationale      text,
  created_at     timestamptz not null default now(),
  primary key (opportunity_id, evidence_id, relationship)
);

create table if not exists opportunity_themes (
  org_id         uuid not null references orgs(id) on delete cascade,
  project_id     uuid not null references projects(id) on delete cascade,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  theme_id       uuid not null references themes(id) on delete cascade,
  relationship   output_relation not null default 'supporting',
  rationale      text,
  created_at     timestamptz not null default now(),
  primary key (opportunity_id, theme_id, relationship)
);

create table if not exists problem_actions (
  org_id       uuid not null references orgs(id) on delete cascade,
  project_id   uuid not null references projects(id) on delete cascade,
  problem_id   uuid not null references problems(id) on delete cascade,
  action_id    uuid not null references actions(id) on delete cascade,
  relationship output_relation not null default 'created_from',
  source       analysis_source not null default 'ai',
  review_state review_state not null default 'suggested',
  rationale    text,
  created_at   timestamptz not null default now(),
  primary key (problem_id, action_id, relationship)
);

create table if not exists artifact_evidence (
  org_id       uuid not null references orgs(id) on delete cascade,
  project_id   uuid not null references projects(id) on delete cascade,
  artifact_id  uuid not null references artifacts(id) on delete cascade,
  evidence_id  uuid not null references evidence(id) on delete cascade,
  relationship output_relation not null default 'cites',
  created_at   timestamptz not null default now(),
  primary key (artifact_id, evidence_id, relationship)
);

create table if not exists artifact_problems (
  org_id       uuid not null references orgs(id) on delete cascade,
  project_id   uuid not null references projects(id) on delete cascade,
  artifact_id  uuid not null references artifacts(id) on delete cascade,
  problem_id   uuid not null references problems(id) on delete cascade,
  relationship output_relation not null default 'addresses',
  created_at   timestamptz not null default now(),
  primary key (artifact_id, problem_id, relationship)
);

create table if not exists artifact_themes (
  org_id       uuid not null references orgs(id) on delete cascade,
  project_id   uuid not null references projects(id) on delete cascade,
  artifact_id  uuid not null references artifacts(id) on delete cascade,
  theme_id     uuid not null references themes(id) on delete cascade,
  relationship output_relation not null default 'addresses',
  created_at   timestamptz not null default now(),
  primary key (artifact_id, theme_id, relationship)
);

create table if not exists artifact_opportunities (
  org_id         uuid not null references orgs(id) on delete cascade,
  project_id     uuid not null references projects(id) on delete cascade,
  artifact_id    uuid not null references artifacts(id) on delete cascade,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  relationship   output_relation not null default 'addresses',
  created_at     timestamptz not null default now(),
  primary key (artifact_id, opportunity_id, relationship)
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table tags enable row level security;
alter table evidence_tags enable row level security;
alter table topics enable row level security;
alter table evidence_topics enable row level security;
alter table theme_topics enable row level security;
alter table theme_evidence enable row level security;
alter table problem_themes enable row level security;
alter table problem_evidence enable row level security;
alter table problem_topics enable row level security;
alter table opportunities enable row level security;
alter table problem_opportunities enable row level security;
alter table opportunity_evidence enable row level security;
alter table opportunity_themes enable row level security;
alter table problem_actions enable row level security;
alter table artifact_evidence enable row level security;
alter table artifact_problems enable row level security;
alter table artifact_themes enable row level security;
alter table artifact_opportunities enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'tags',
    'evidence_tags',
    'topics',
    'evidence_topics',
    'theme_topics',
    'theme_evidence',
    'problem_themes',
    'problem_evidence',
    'problem_topics',
    'opportunities',
    'problem_opportunities',
    'opportunity_evidence',
    'opportunity_themes',
    'problem_actions',
    'artifact_evidence',
    'artifact_problems',
    'artifact_themes',
    'artifact_opportunities'
  ]
  loop
    execute format('drop policy if exists %I on %I', 'org members can read ' || table_name, table_name);
    execute format(
      'create policy %I on %I for select using (org_id in (select public.auth_user_org_ids()))',
      'org members can read ' || table_name,
      table_name,
      table_name
    );

    execute format('drop policy if exists %I on %I', 'members can insert ' || table_name, table_name);
    execute format(
      'create policy %I on %I for insert with check (org_id in (select org_id from org_members where user_id = auth.uid() and role in (''owner'', ''admin'', ''member'')))',
      'members can insert ' || table_name,
      table_name,
      table_name
    );

    execute format('drop policy if exists %I on %I', 'members can update ' || table_name, table_name);
    execute format(
      'create policy %I on %I for update using (org_id in (select org_id from org_members where user_id = auth.uid() and role in (''owner'', ''admin'', ''member'')))',
      'members can update ' || table_name,
      table_name,
      table_name
    );

    execute format('drop policy if exists %I on %I', 'members can delete ' || table_name, table_name);
    execute format(
      'create policy %I on %I for delete using (org_id in (select org_id from org_members where user_id = auth.uid() and role in (''owner'', ''admin'', ''member'')))',
      'members can delete ' || table_name,
      table_name,
      table_name
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Compatibility backfill
-- ---------------------------------------------------------------------------

with legacy_labels as (
  select distinct
    e.org_id,
    e.project_id,
    trim(label) as label,
    trim(lower(regexp_replace(trim(label), '[^a-zA-Z0-9]+', ' ', 'g'))) as label_key
  from evidence e
  cross join lateral unnest(coalesce(e.themes, '{}'::text[])) as label
  where trim(label) <> ''
)
insert into topics (org_id, project_id, label, label_key, source, review_state)
select org_id, project_id, min(label), label_key, 'imported', 'suggested'
from legacy_labels
where label_key <> ''
group by org_id, project_id, label_key
on conflict (org_id, project_id, label_key) do nothing;

insert into evidence_topics (
  org_id,
  project_id,
  evidence_id,
  topic_id,
  source,
  review_state,
  rationale
)
select
  e.org_id,
  e.project_id,
  e.id,
  t.id,
  'imported',
  'suggested',
  'Backfilled from legacy evidence.themes; not reviewed as a first-class topic.'
from evidence e
cross join lateral unnest(coalesce(e.themes, '{}'::text[])) as legacy_theme_label
join topics t
  on t.org_id = e.org_id
 and t.project_id = e.project_id
 and t.label_key = trim(lower(regexp_replace(trim(legacy_theme_label), '[^a-zA-Z0-9]+', ' ', 'g')))
where trim(legacy_theme_label) <> ''
on conflict (evidence_id, topic_id) do nothing;

insert into theme_evidence (
  org_id,
  project_id,
  theme_id,
  evidence_id,
  relationship,
  source,
  review_state,
  confidence,
  rationale
)
select
  et.org_id,
  e.project_id,
  et.theme_id,
  et.evidence_id,
  'supporting',
  'imported',
  'suggested',
  et.confidence,
  'Backfilled from legacy evidence_themes synthesis link.'
from evidence_themes et
join evidence e on e.id = et.evidence_id and e.org_id = et.org_id
join themes th on th.id = et.theme_id and th.org_id = et.org_id and th.project_id = e.project_id
on conflict (theme_id, evidence_id, relationship) do nothing;

insert into theme_topics (
  org_id,
  project_id,
  theme_id,
  topic_id,
  relationship,
  rationale
)
select distinct
  te.org_id,
  te.project_id,
  te.theme_id,
  et.topic_id,
  'contributing'::theme_relation,
  'Backfilled by topic overlap from theme evidence.'
from theme_evidence te
join evidence_topics et
  on et.org_id = te.org_id
 and et.project_id = te.project_id
 and et.evidence_id = te.evidence_id
on conflict (theme_id, topic_id, relationship) do nothing;

insert into problem_themes (
  org_id,
  project_id,
  problem_id,
  theme_id,
  relationship,
  source,
  review_state,
  rationale
)
select
  p.org_id,
  p.project_id,
  p.id,
  theme_id,
  'provenance',
  'imported',
  'suggested',
  'Backfilled from legacy problems.source_theme_ids; not assessed as primary/contributing support.'
from problems p
cross join lateral unnest(coalesce(p.source_theme_ids, '{}'::uuid[])) as theme_id
join themes th on th.id = theme_id and th.org_id = p.org_id and th.project_id = p.project_id
on conflict (problem_id, theme_id, relationship) do nothing;

insert into problem_evidence (
  org_id,
  project_id,
  problem_id,
  evidence_id,
  relationship,
  source,
  review_state,
  rationale
)
select
  p.org_id,
  p.project_id,
  p.id,
  evidence_id,
  'provenance',
  'imported',
  'suggested',
  'Backfilled from legacy problems.source_evidence_ids; not assessed direct support.'
from problems p
cross join lateral unnest(coalesce(p.source_evidence_ids, '{}'::uuid[])) as evidence_id
join evidence e on e.id = evidence_id and e.org_id = p.org_id and e.project_id = p.project_id
on conflict (problem_id, evidence_id, relationship) do nothing;

insert into problem_topics (
  org_id,
  project_id,
  problem_id,
  topic_id,
  relationship,
  source,
  review_state,
  rationale
)
select distinct
  pe.org_id,
  pe.project_id,
  pe.problem_id,
  et.topic_id,
  'provenance'::theme_relation,
  'imported'::analysis_source,
  'suggested'::review_state,
  'Backfilled by topic overlap from problem evidence provenance.'
from problem_evidence pe
join evidence_topics et
  on et.org_id = pe.org_id
 and et.project_id = pe.project_id
 and et.evidence_id = pe.evidence_id
on conflict (problem_id, topic_id, relationship) do nothing;

insert into artifact_evidence (
  org_id,
  project_id,
  artifact_id,
  evidence_id,
  relationship
)
select distinct
  a.org_id,
  a.project_id,
  a.id,
  ace.evidence_id,
  'cites'::output_relation
from artifact_claim_evidence ace
join artifact_claims ac on ac.id = ace.claim_id and ac.org_id = ace.org_id
join artifacts a on a.id = ac.artifact_id and a.org_id = ace.org_id
join evidence e on e.id = ace.evidence_id and e.org_id = a.org_id and e.project_id = a.project_id
on conflict (artifact_id, evidence_id, relationship) do nothing;

comment on table topics is
  'First-class descriptive research topics/codes. Legacy evidence.themes backfills here as suggested, not accepted.';

comment on table evidence_topics is
  'Many-to-many evidence/topic assignments with AI/human provenance and review state.';

comment on table theme_evidence is
  'Typed evidence support for interpretive themes. Supersedes evidence_themes after UI migration.';

comment on table problem_evidence is
  'Typed problem/evidence relationships. Legacy arrays backfill as provenance until the discovery rewrite writes direct support.';

comment on table opportunities is
  'Product opportunities linked to problems/themes/evidence. Separate from project_opportunities, which are suggested workspaces.';
