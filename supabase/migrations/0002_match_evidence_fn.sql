-- match_evidence — pgvector cosine similarity search
-- Always requires org_id to prevent cross-tenant data leakage.
-- Call via supabase.rpc('match_evidence', { ... })

create or replace function match_evidence(
  p_org_id      uuid,
  p_project_id  uuid,
  p_embedding   vector(1536),
  p_trust_scopes text[],
  p_limit       int default 18
)
returns table (
  id            uuid,
  content       text,
  summary       text,
  themes        text[],
  trust_scope   text,
  source_id     uuid,
  segment_id    uuid,
  metadata      jsonb,
  similarity    float
)
language sql stable
as $$
  select
    e.id,
    e.content,
    e.summary,
    e.themes,
    e.trust_scope::text,
    e.source_id,
    e.segment_id,
    e.metadata,
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
