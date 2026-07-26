-- #185: atomically replace a source's segments and evidence for the current
-- ingest run.
--
-- Segments are prepared in memory while extraction runs. Only after extraction
-- and embedding succeed does this function lock and verify the newest
-- processing job, remove the previous derived rows, and insert the complete
-- replacement set in one transaction. A failed or superseded run leaves the
-- previous source data untouched.
create or replace function public.commit_ingest_derived_data(
  p_org_id uuid,
  p_project_id uuid,
  p_source_id uuid,
  p_job_id uuid,
  p_segments jsonb,
  p_evidence jsonb
)
returns table (
  evidence_id uuid,
  evidence_metadata jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_job_id uuid;
  v_current_job_status public.job_status;
  v_expected_segment_count integer;
  v_distinct_segment_count integer;
  v_expected_evidence_count integer;
  v_resolved_evidence_count integer;
begin
  if p_org_id is null
    or p_project_id is null
    or p_source_id is null
    or p_job_id is null
  then
    raise exception 'INGEST_SCOPE_REQUIRED' using errcode = '22023';
  end if;

  if p_segments is null or jsonb_typeof(p_segments) <> 'array' then
    raise exception 'INGEST_SEGMENTS_MUST_BE_ARRAY' using errcode = '22023';
  end if;

  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' then
    raise exception 'INGEST_EVIDENCE_MUST_BE_ARRAY' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.sources as s
    where s.id = p_source_id
      and s.org_id = p_org_id
      and s.project_id = p_project_id
  ) then
    raise exception 'INGEST_SOURCE_SCOPE_MISMATCH' using errcode = 'P0001';
  end if;

  select ij.id, ij.status
    into v_current_job_id, v_current_job_status
  from public.ingest_jobs as ij
  where ij.org_id = p_org_id
    and ij.source_id = p_source_id
  order by ij.created_at desc, ij.id desc
  limit 1
  for update;

  if v_current_job_id is distinct from p_job_id
    or v_current_job_status is distinct from 'processing'::public.job_status
  then
    raise exception 'INGEST_JOB_NOT_CURRENT' using errcode = 'P0001';
  end if;

  v_expected_segment_count := jsonb_array_length(p_segments);
  if v_expected_segment_count = 0 then
    raise exception 'INGEST_SEGMENTS_EMPTY' using errcode = '22023';
  end if;

  select count(distinct (payload.item->>'segment_index')::integer)
    into v_distinct_segment_count
  from jsonb_array_elements(p_segments) as payload(item);

  if v_distinct_segment_count <> v_expected_segment_count then
    raise exception 'INGEST_SEGMENT_INDEXES_NOT_UNIQUE' using errcode = '22023';
  end if;

  v_expected_evidence_count := jsonb_array_length(p_evidence);

  select count(*)
    into v_resolved_evidence_count
  from jsonb_array_elements(p_evidence) as evidence_payload(item)
  join jsonb_array_elements(p_segments) as segment_payload(item)
    on (segment_payload.item->>'segment_index')::integer
       = (evidence_payload.item->>'segment_index')::integer;

  if v_resolved_evidence_count <> v_expected_evidence_count then
    raise exception 'INGEST_EVIDENCE_SEGMENT_UNRESOLVED' using errcode = '22023';
  end if;

  -- Delete evidence first so dependent evidence links cascade cleanly before
  -- the old segments are replaced.
  delete from public.evidence as e
  where e.org_id = p_org_id
    and e.project_id = p_project_id
    and e.source_id = p_source_id;

  delete from public.source_segments as ss
  where ss.org_id = p_org_id
    and ss.source_id = p_source_id;

  insert into public.source_segments (
    id,
    org_id,
    source_id,
    segment_index,
    speaker,
    conversation_unit_id,
    char_start,
    char_end,
    start_time,
    end_time,
    raw_content,
    redacted_content,
    word_count,
    metadata
  )
  select
    (payload.item->>'id')::uuid,
    p_org_id,
    p_source_id,
    (payload.item->>'segment_index')::integer,
    nullif(payload.item->>'speaker', ''),
    nullif(payload.item->>'conversation_unit_id', ''),
    (payload.item->>'char_start')::integer,
    (payload.item->>'char_end')::integer,
    nullif(payload.item->>'start_time', ''),
    nullif(payload.item->>'end_time', ''),
    payload.item->>'raw_content',
    nullif(payload.item->>'redacted_content', ''),
    (payload.item->>'word_count')::integer,
    coalesce(payload.item->'metadata', '{}'::jsonb)
      || jsonb_build_object('ingest_job_id', p_job_id)
  from jsonb_array_elements(p_segments) as payload(item);

  return query
  with payload as (
    select item
    from jsonb_array_elements(p_evidence) as records(item)
  ),
  inserted as (
    insert into public.evidence (
      org_id,
      project_id,
      source_id,
      segment_id,
      content,
      summary,
      classification,
      sentiment,
      themes,
      metadata,
      embedding,
      trust_scope
    )
    select
      p_org_id,
      p_project_id,
      p_source_id,
      ss.id,
      payload.item->>'content',
      nullif(payload.item->>'summary', ''),
      payload.item->>'classification',
      payload.item->>'sentiment',
      array(
        select jsonb_array_elements_text(
          coalesce(payload.item->'themes', '[]'::jsonb)
        )
      ),
      coalesce(payload.item->'metadata', '{}'::jsonb)
        || jsonb_build_object('ingest_job_id', p_job_id),
      (payload.item->>'embedding')::public.vector,
      'pending'::public.trust_scope
    from payload
    join public.source_segments as ss
      on ss.org_id = p_org_id
     and ss.source_id = p_source_id
     and ss.segment_index = (payload.item->>'segment_index')::integer
    returning evidence.id, evidence.metadata
  )
  select inserted.id, inserted.metadata
  from inserted;
end;
$$;

revoke all on function public.commit_ingest_derived_data(
  uuid,
  uuid,
  uuid,
  uuid,
  jsonb,
  jsonb
) from public;
revoke all on function public.commit_ingest_derived_data(
  uuid,
  uuid,
  uuid,
  uuid,
  jsonb,
  jsonb
) from anon;
revoke all on function public.commit_ingest_derived_data(
  uuid,
  uuid,
  uuid,
  uuid,
  jsonb,
  jsonb
) from authenticated;
grant execute on function public.commit_ingest_derived_data(
  uuid,
  uuid,
  uuid,
  uuid,
  jsonb,
  jsonb
) to service_role;

comment on function public.commit_ingest_derived_data(
  uuid,
  uuid,
  uuid,
  uuid,
  jsonb,
  jsonb
) is
  'Atomically replaces source segments and evidence for the current ingest job (#185).';
