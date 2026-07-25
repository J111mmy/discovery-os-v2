-- Ask corpus honesty and source-stratified retrieval (#172).
--
-- Both functions are SECURITY INVOKER. They execute through the authenticated
-- user client, so the existing RLS policies on sources, evidence, segments,
-- evidence_entities, and people remain the authorization boundary.

create or replace function public.ask_corpus_facts(
  p_org_id uuid,
  p_project_id uuid
)
returns table(
  total_sources bigint,
  evidence_bearing_sources bigint,
  total_evidence bigint,
  trusted_evidence bigint,
  pending_evidence bigint,
  excluded_evidence bigint,
  disputed_evidence bigint,
  structured_participants bigint,
  source_breakdown jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  with project_sources as (
    select s.id, s.title
    from public.sources s
    where s.org_id = p_org_id
      and s.project_id = p_project_id
  ),
  ask_eligible_evidence as (
    select e.id, e.source_id, e.trust_scope
    from public.evidence e
    join public.sources s
      on s.id = e.source_id
      and s.org_id = e.org_id
      and s.project_id = e.project_id
    left join public.source_segments ss
      on ss.id = e.segment_id
      and ss.org_id = e.org_id
    where e.org_id = p_org_id
      and e.project_id = p_project_id
      and s.type::text <> 'internal_meeting'
      and nullif(btrim(e.metadata ->> 'adjacent_project_hint'), '') is null
      and nullif(btrim(e.metadata ->> 'adjacent_project_status'), '') is null
      and not exists (
        select 1
        from public.people p
        where p.org_id = e.org_id
          and p.affiliation = 'internal'
          and (
            e.metadata ->> 'speaker_person_id' = p.id::text
            or (
              ss.speaker is not null
              and lower(regexp_replace(btrim(ss.speaker), '\s+', ' ', 'g')) =
                lower(regexp_replace(btrim(p.name), '\s+', ' ', 'g'))
            )
          )
      )
  ),
  eligible_by_source as (
    select
      e.source_id,
      count(*)::bigint as total_evidence,
      count(*) filter (where e.trust_scope::text = 'trusted')::bigint as trusted_evidence,
      count(*) filter (where e.trust_scope::text = 'pending')::bigint as pending_evidence,
      count(*) filter (where e.trust_scope::text = 'excluded')::bigint as excluded_evidence,
      count(*) filter (where e.trust_scope::text = 'disputed')::bigint as disputed_evidence
    from ask_eligible_evidence e
    group by e.source_id
  ),
  source_counts as (
    select
      s.id as source_id,
      s.title as source_title,
      coalesce(a.total_evidence, 0)::bigint as total_evidence,
      coalesce(a.trusted_evidence, 0)::bigint as trusted_evidence,
      coalesce(a.pending_evidence, 0)::bigint as pending_evidence,
      coalesce(a.excluded_evidence, 0)::bigint as excluded_evidence,
      coalesce(a.disputed_evidence, 0)::bigint as disputed_evidence
    from project_sources s
    left join eligible_by_source a on a.source_id = s.id
  ),
  participant_count as (
    select count(distinct coalesce(ee.person_id, ee.entity_id))::bigint as total
    from ask_eligible_evidence e
    join public.evidence_entities ee
      on ee.evidence_id = e.id
      and ee.org_id = p_org_id
      and ee.project_id = p_project_id
      and ee.entity_type = 'person'
      and coalesce(ee.person_id, ee.entity_id) is not null
    join public.people p
      on p.id = coalesce(ee.person_id, ee.entity_id)
      and p.org_id = p_org_id
      and p.affiliation <> 'internal'
    where e.trust_scope::text in ('trusted', 'pending')
  )
  select
    count(*)::bigint as total_sources,
    count(*) filter (where sc.total_evidence > 0)::bigint as evidence_bearing_sources,
    coalesce(sum(sc.total_evidence), 0)::bigint as total_evidence,
    coalesce(sum(sc.trusted_evidence), 0)::bigint as trusted_evidence,
    coalesce(sum(sc.pending_evidence), 0)::bigint as pending_evidence,
    coalesce(sum(sc.excluded_evidence), 0)::bigint as excluded_evidence,
    coalesce(sum(sc.disputed_evidence), 0)::bigint as disputed_evidence,
    coalesce((select total from participant_count), 0)::bigint as structured_participants,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'source_id', sc.source_id,
          'source_title', sc.source_title,
          'total_evidence', sc.total_evidence,
          'trusted_evidence', sc.trusted_evidence,
          'pending_evidence', sc.pending_evidence,
          'excluded_evidence', sc.excluded_evidence,
          'disputed_evidence', sc.disputed_evidence
        )
        order by sc.source_title, sc.source_id
      ) filter (where sc.source_id is not null),
      '[]'::jsonb
    ) as source_breakdown
  from source_counts sc;
$$;

create or replace function public.match_evidence_stratified(
  p_org_id uuid,
  p_project_id uuid,
  p_embedding vector(1536),
  p_trust_scopes text[],
  p_limit int default 30,
  p_per_source_limit int default 3
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
language sql
stable
security invoker
set search_path = ''
as $$
  with eligible as (
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
      (e.embedding OPERATOR(public.<=>) p_embedding) as distance,
      row_number() over (
        partition by e.source_id
        order by
          case e.trust_scope::text when 'trusted' then 0 else 1 end,
          e.embedding OPERATOR(public.<=>) p_embedding,
          e.id
      ) as source_rank
    from public.evidence e
    join public.sources s
      on s.id = e.source_id
      and s.org_id = e.org_id
      and s.project_id = e.project_id
    left join public.source_segments ss
      on ss.id = e.segment_id
      and ss.org_id = e.org_id
    where e.org_id = p_org_id
      and e.project_id = p_project_id
      and e.trust_scope::text = any(p_trust_scopes)
      and e.embedding is not null
      and s.type::text <> 'internal_meeting'
      and nullif(btrim(e.metadata ->> 'adjacent_project_hint'), '') is null
      and nullif(btrim(e.metadata ->> 'adjacent_project_status'), '') is null
      and not exists (
        select 1
        from public.people p
        where p.org_id = e.org_id
          and p.affiliation = 'internal'
          and (
            e.metadata ->> 'speaker_person_id' = p.id::text
            or (
              ss.speaker is not null
              and lower(regexp_replace(btrim(ss.speaker), '\s+', ' ', 'g')) =
                lower(regexp_replace(btrim(p.name), '\s+', ' ', 'g'))
            )
          )
      )
  )
  select
    e.id,
    e.org_id,
    e.project_id,
    e.content,
    e.summary,
    e.themes,
    e.trust_scope,
    e.classification,
    e.sentiment,
    e.source_id,
    e.segment_id,
    e.metadata,
    e.created_at,
    (1 - e.distance)::float as similarity
  from eligible e
  where e.source_rank <= greatest(1, least(p_per_source_limit, 5))
  order by e.source_rank, e.distance, e.id
  limit greatest(1, least(p_limit, 100));
$$;

revoke all on function public.ask_corpus_facts(uuid, uuid) from public, anon;
grant execute on function public.ask_corpus_facts(uuid, uuid) to authenticated;

revoke all on function public.match_evidence_stratified(
  uuid,
  uuid,
  vector,
  text[],
  int,
  int
) from public, anon;
grant execute on function public.match_evidence_stratified(
  uuid,
  uuid,
  vector,
  text[],
  int,
  int
) to authenticated;

comment on function public.ask_corpus_facts(uuid, uuid) is
  'Exact RLS-respecting corpus and trust counts for Ask. Excludes internal and adjacent-project evidence from Ask-readable counts.';

comment on function public.match_evidence_stratified(uuid, uuid, vector, text[], int, int) is
  'RLS-respecting semantic retrieval that rotates across sources before taking additional records from the same source.';
