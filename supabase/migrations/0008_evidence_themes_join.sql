-- Evidence-theme join table and synthesis freshness state.
-- Keep evidence.themes text[] for backward compatibility; new synthesis writes
-- relationship rows here.

create table evidence_themes (
  evidence_id uuid not null references evidence(id) on delete cascade,
  theme_id uuid not null references themes(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  confidence float,
  created_at timestamptz not null default now(),
  primary key (evidence_id, theme_id)
);

alter table evidence_themes enable row level security;

create policy "org members can read evidence themes"
  on evidence_themes for select
  using (org_id in (select auth_user_org_ids()));

create index idx_evidence_themes_theme on evidence_themes(theme_id);
create index idx_evidence_themes_evidence on evidence_themes(evidence_id);

alter table projects
  add column if not exists synthesis_stale bool not null default false,
  add column if not exists last_synthesised_at timestamptz;

-- Search results need the ingest v2 fields so the evidence browser can render
-- the same badges for semantic results as it does for the initial server query.
drop function if exists match_evidence(uuid, uuid, vector(1536), text[], int);

create function match_evidence(
  p_org_id uuid,
  p_project_id uuid,
  p_embedding vector(1536),
  p_trust_scopes text[],
  p_limit int default 18
)
returns table (
  id uuid,
  org_id uuid,
  project_id uuid,
  content text,
  summary text,
  themes text[],
  trust_scope text,
  classification text,
  sentiment text,
  source_id uuid,
  segment_id uuid,
  metadata jsonb,
  created_at timestamptz,
  similarity float
)
language sql stable
as $$
  select
    e.id,
    e.org_id,
    e.project_id,
    e.content,
    e.summary,
    e.themes,
    e.trust_scope::text,
    e.classification,
    e.sentiment,
    e.source_id,
    e.segment_id,
    e.metadata,
    e.created_at,
    1 - (e.embedding <=> p_embedding) as similarity
  from evidence e
  where
    e.org_id = p_org_id
    and e.project_id = p_project_id
    and e.trust_scope::text = any(p_trust_scopes)
    and e.embedding is not null
  order by e.embedding <=> p_embedding
  limit p_limit;
$$;
