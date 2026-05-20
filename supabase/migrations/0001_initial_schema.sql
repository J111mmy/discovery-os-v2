-- Discovery OS v2 — Initial Schema
-- Run via: supabase db push  OR  paste into Supabase SQL editor
-- Requires: pgvector extension

-- ============================================================
-- EXTENSIONS
-- ============================================================
-- uuid-ossp not needed — using gen_random_uuid() which is built into Postgres 13+
create extension if not exists vector;

-- ============================================================
-- ENUMS
-- ============================================================
create type org_role as enum ('owner', 'admin', 'member', 'viewer');
create type trust_scope as enum ('pending', 'trusted', 'disputed', 'excluded');
create type source_type as enum ('transcript', 'document', 'note', 'survey', 'support_ticket', 'other');
create type artifact_type as enum ('prd', 'brief', 'persona', 'opportunity', 'gtm', 'interview_guide', 'report', 'other');
create type verification_status as enum ('unverified', 'supported', 'disputed', 'retracted');
create type job_status as enum ('pending', 'processing', 'done', 'failed');

-- ============================================================
-- ORGS
-- ============================================================
create table orgs (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique,
  settings      jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ============================================================
-- USERS (mirrors auth.users — do not duplicate auth data)
-- ============================================================
create table org_members (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  role          org_role not null default 'member',
  display_name  text,
  joined_at     timestamptz not null default now(),
  unique (org_id, user_id)
);

create index idx_org_members_org on org_members(org_id);
create index idx_org_members_user on org_members(user_id);

-- ============================================================
-- PROJECTS
-- ============================================================
create table projects (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  name          text not null,
  slug          text not null,
  description   text,
  frame         text,          -- project Frame (problem + audience + outcome)
  gtm_context   text,          -- go-to-market positioning text
  operating_style text,        -- voice & operating style
  settings      jsonb not null default '{}',
  archived      boolean not null default false,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (org_id, slug)
);

create index idx_projects_org on projects(org_id);

-- ============================================================
-- SOURCES  (raw uploaded files / linked content)
-- ============================================================
create table sources (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  project_id    uuid not null references projects(id) on delete cascade,
  type          source_type not null default 'other',
  title         text not null,
  description   text,
  raw_url       text,          -- storage path or external URL
  metadata      jsonb not null default '{}',  -- date, participants, tags, etc.
  trust_scope   trust_scope not null default 'pending',
  ingested_by   uuid references auth.users(id),
  ingested_at   timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create index idx_sources_org_project on sources(org_id, project_id);
create index idx_sources_trust on sources(org_id, project_id, trust_scope);

-- ============================================================
-- SOURCE SEGMENTS  (chunked passages from a source)
-- ============================================================
create table source_segments (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  source_id     uuid not null references sources(id) on delete cascade,
  segment_index int not null,             -- ordering within source
  speaker       text,                     -- for transcripts
  raw_content   text not null,            -- original text (pre-redaction)
  redacted_content text,                  -- PII-redacted version (used for LLM calls)
  word_count    int,
  metadata      jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  unique (source_id, segment_index)
);

create index idx_source_segments_source on source_segments(source_id);
create index idx_source_segments_org on source_segments(org_id);

-- ============================================================
-- EVIDENCE  (embedded, queryable records)
-- ============================================================
create table evidence (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  project_id    uuid not null references projects(id) on delete cascade,
  source_id     uuid not null references sources(id) on delete cascade,
  segment_id    uuid references source_segments(id) on delete set null,
  content       text not null,            -- the passage used for embedding (redacted)
  embedding     vector(1536),             -- text-embedding-3-small
  trust_scope   trust_scope not null default 'pending',
  summary       text,                     -- LLM-generated one-liner (cheap tier)
  themes        text[],                   -- tag array for fast filter
  metadata      jsonb not null default '{}',
  created_at    timestamptz not null default now()
);

-- Multi-tenant safety: always filter by org_id first
create index idx_evidence_org_project_trust on evidence(org_id, project_id, trust_scope);
create index idx_evidence_source on evidence(source_id);

-- HNSW vector index for fast cosine similarity search
create index idx_evidence_embedding on evidence
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- ============================================================
-- THEMES  (project-level theme registry)
-- ============================================================
create table themes (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  project_id    uuid not null references projects(id) on delete cascade,
  label         text not null,
  description   text,
  evidence_count int not null default 0,
  created_at    timestamptz not null default now(),
  unique (project_id, label)
);

create index idx_themes_project on themes(org_id, project_id);

-- ============================================================
-- EVIDENCE ENTITIES  (people, companies, products extracted from evidence)
-- ============================================================
create table evidence_entities (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  project_id    uuid not null references projects(id) on delete cascade,
  evidence_id   uuid not null references evidence(id) on delete cascade,
  entity_type   text not null,    -- 'person' | 'company' | 'product' | 'feature' | 'pain_point'
  label         text not null,
  metadata      jsonb not null default '{}',
  created_at    timestamptz not null default now()
);

create index idx_entities_evidence on evidence_entities(evidence_id);
create index idx_entities_project on evidence_entities(org_id, project_id, entity_type);

-- ============================================================
-- ARTIFACTS  (generated documents)
-- ============================================================
create table artifacts (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  project_id    uuid not null references projects(id) on delete cascade,
  type          artifact_type not null default 'other',
  title         text not null,
  prompt        text not null,            -- original compose prompt
  content_md    text not null default '', -- current markdown content
  version       int not null default 1,
  word_count    int,
  model_used    text,                     -- actual model string at generation time
  task_tier     text,                     -- cheap | standard | premium | eval
  metadata      jsonb not null default '{}',
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_artifacts_project on artifacts(org_id, project_id);

-- ============================================================
-- ARTIFACT VERSIONS  (full history of edits)
-- ============================================================
create table artifact_versions (
  id            uuid primary key default gen_random_uuid(),
  artifact_id   uuid not null references artifacts(id) on delete cascade,
  org_id        uuid not null references orgs(id) on delete cascade,
  version       int not null,
  content_md    text not null,
  saved_by      uuid references auth.users(id),
  saved_at      timestamptz not null default now(),
  unique (artifact_id, version)
);

create index idx_artifact_versions_artifact on artifact_versions(artifact_id);

-- ============================================================
-- ARTIFACT CLAIMS  (discrete factual claims extracted from an artifact)
-- ============================================================
create table artifact_claims (
  id                  uuid primary key default gen_random_uuid(),
  artifact_id         uuid not null references artifacts(id) on delete cascade,
  org_id              uuid not null references orgs(id) on delete cascade,
  claim_text          text not null,
  section_heading     text,
  verification_status verification_status not null default 'unverified',
  verified_at         timestamptz,
  verifier_model      text,
  notes               text,
  created_at          timestamptz not null default now()
);

create index idx_claims_artifact on artifact_claims(artifact_id);
create index idx_claims_org_status on artifact_claims(org_id, verification_status);

-- ============================================================
-- ARTIFACT CLAIM EVIDENCE  (join: which evidence supports each claim)
-- ============================================================
create table artifact_claim_evidence (
  id          uuid primary key default gen_random_uuid(),
  claim_id    uuid not null references artifact_claims(id) on delete cascade,
  evidence_id uuid not null references evidence(id) on delete cascade,
  org_id      uuid not null references orgs(id) on delete cascade,
  relevance   float,    -- cosine similarity score at link time
  created_at  timestamptz not null default now(),
  unique (claim_id, evidence_id)
);

create index idx_claim_evidence_claim on artifact_claim_evidence(claim_id);
create index idx_claim_evidence_evidence on artifact_claim_evidence(evidence_id);

-- ============================================================
-- INGEST JOBS  (async pipeline tracking)
-- ============================================================
create table ingest_jobs (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  source_id     uuid not null references sources(id) on delete cascade,
  inngest_event_id text,
  status        job_status not null default 'pending',
  step_log      jsonb not null default '[]',   -- [{step, status, ts, error}]
  error         text,
  started_at    timestamptz,
  completed_at  timestamptz,
  created_at    timestamptz not null default now()
);

create index idx_ingest_jobs_source on ingest_jobs(source_id);
create index idx_ingest_jobs_org_status on ingest_jobs(org_id, status);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table orgs enable row level security;
alter table org_members enable row level security;
alter table projects enable row level security;
alter table sources enable row level security;
alter table source_segments enable row level security;
alter table evidence enable row level security;
alter table themes enable row level security;
alter table evidence_entities enable row level security;
alter table artifacts enable row level security;
alter table artifact_versions enable row level security;
alter table artifact_claims enable row level security;
alter table artifact_claim_evidence enable row level security;
alter table ingest_jobs enable row level security;

-- Helper function: get the org IDs the current user belongs to
create or replace function auth_user_org_ids()
returns setof uuid language sql security definer stable as $$
  select org_id from org_members where user_id = auth.uid()
$$;

-- RLS policies — read: members of the org can see everything
create policy "org members can read orgs"
  on orgs for select using (id in (select auth_user_org_ids()));

create policy "org members can read projects"
  on projects for select using (org_id in (select auth_user_org_ids()));

create policy "org members can read sources"
  on sources for select using (org_id in (select auth_user_org_ids()));

create policy "org members can read segments"
  on source_segments for select using (org_id in (select auth_user_org_ids()));

create policy "org members can read evidence"
  on evidence for select using (org_id in (select auth_user_org_ids()));

create policy "org members can read artifacts"
  on artifacts for select using (org_id in (select auth_user_org_ids()));

create policy "org members can read claims"
  on artifact_claims for select using (org_id in (select auth_user_org_ids()));

create policy "org members can read claim evidence"
  on artifact_claim_evidence for select using (org_id in (select auth_user_org_ids()));

create policy "org members can read themes"
  on themes for select using (org_id in (select auth_user_org_ids()));

create policy "org members can read entities"
  on evidence_entities for select using (org_id in (select auth_user_org_ids()));

create policy "org members can read ingest jobs"
  on ingest_jobs for select using (org_id in (select auth_user_org_ids()));

-- Write policies: members and above can insert/update; viewers cannot
create policy "members can insert projects"
  on projects for insert with check (org_id in (
    select org_id from org_members
    where user_id = auth.uid() and role in ('owner','admin','member')
  ));

create policy "members can update projects"
  on projects for update using (org_id in (
    select org_id from org_members
    where user_id = auth.uid() and role in ('owner','admin','member')
  ));

create policy "members can insert sources"
  on sources for insert with check (org_id in (
    select org_id from org_members
    where user_id = auth.uid() and role in ('owner','admin','member')
  ));

create policy "members can insert artifacts"
  on artifacts for insert with check (org_id in (
    select org_id from org_members
    where user_id = auth.uid() and role in ('owner','admin','member')
  ));

create policy "members can update artifacts"
  on artifacts for update using (org_id in (
    select org_id from org_members
    where user_id = auth.uid() and role in ('owner','admin','member')
  ));

-- Service role bypass (used by Inngest functions server-side)
-- The service role key bypasses RLS automatically in Supabase — no policy needed.

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_orgs_updated_at
  before update on orgs for each row execute function set_updated_at();
create trigger trg_projects_updated_at
  before update on projects for each row execute function set_updated_at();
create trigger trg_artifacts_updated_at
  before update on artifacts for each row execute function set_updated_at();
