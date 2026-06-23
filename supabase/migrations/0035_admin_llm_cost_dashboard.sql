-- Migration 0035: super-admin LLM cost dashboard aggregates
-- Returns aggregate-only cost telemetry for /admin/costs.
-- No prompts, responses, source content, or raw llm_cost_events rows are exposed.

create or replace function public.admin_llm_cost_dashboard(
  p_window text default '7d',
  p_bucket text default 'day',
  p_top_n integer default 10
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_window text := coalesce(p_window, '7d');
  v_bucket text := coalesce(p_bucket, 'day');
  v_top_n integer := least(greatest(coalesce(p_top_n, 10), 1), 50);
  v_since timestamptz;
  v_bucket_unit text;
  v_result jsonb;
begin
  if not public.auth_is_super_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if v_window = '24h' then
    v_since := now() - interval '24 hours';
  elsif v_window = '7d' then
    v_since := now() - interval '7 days';
  elsif v_window = '30d' then
    v_since := now() - interval '30 days';
  elsif v_window = 'all' then
    v_since := null;
  else
    raise exception 'invalid window: %', v_window using errcode = '22023';
  end if;

  if v_bucket in ('day', 'week', 'month') then
    v_bucket_unit := v_bucket;
  else
    raise exception 'invalid bucket: %', v_bucket using errcode = '22023';
  end if;

  with filtered as materialized (
    select *
    from public.llm_cost_events
    where v_since is null
       or created_at >= v_since
  )
  select jsonb_build_object(
    'window', v_window,
    'bucket', v_bucket,
    'top_n', v_top_n,
    'generated_at', now(),
    'summary', coalesce((
      select jsonb_build_object(
        'estimated_usd', coalesce(sum(estimated_usd), 0),
        'call_count', count(*),
        'input_tokens', coalesce(sum(input_tokens), 0),
        'output_tokens', coalesce(sum(output_tokens), 0),
        'cache_write_tokens', coalesce(sum(cache_write_tokens), 0),
        'cache_read_tokens', coalesce(sum(cache_read_tokens), 0),
        'pricing_versions', coalesce(jsonb_agg(distinct pricing_version), '[]'::jsonb),
        'first_event_at', min(created_at),
        'last_event_at', max(created_at)
      )
      from filtered
    ), '{}'::jsonb),
    'by_operation', coalesce((
      select jsonb_agg(to_jsonb(row_data) order by row_data.estimated_usd desc)
      from (
        select
          agent_type,
          coalesce(sum(estimated_usd), 0) as estimated_usd,
          count(*) as call_count,
          coalesce(sum(input_tokens), 0) as input_tokens,
          coalesce(sum(output_tokens), 0) as output_tokens,
          coalesce(sum(cache_write_tokens), 0) as cache_write_tokens,
          coalesce(sum(cache_read_tokens), 0) as cache_read_tokens
        from filtered
        group by agent_type
        order by estimated_usd desc, call_count desc
        limit 50
      ) row_data
    ), '[]'::jsonb),
    'by_step', coalesce((
      select jsonb_agg(to_jsonb(row_data) order by row_data.estimated_usd desc)
      from (
        select
          agent_type,
          step,
          coalesce(sum(estimated_usd), 0) as estimated_usd,
          count(*) as call_count,
          coalesce(sum(input_tokens), 0) as input_tokens,
          coalesce(sum(output_tokens), 0) as output_tokens,
          coalesce(sum(cache_write_tokens), 0) as cache_write_tokens,
          coalesce(sum(cache_read_tokens), 0) as cache_read_tokens
        from filtered
        group by agent_type, step
        order by estimated_usd desc, call_count desc
        limit 100
      ) row_data
    ), '[]'::jsonb),
    'by_org', coalesce((
      select jsonb_agg(to_jsonb(row_data) order by row_data.estimated_usd desc)
      from (
        select
          f.org_id,
          o.name as org_name,
          o.slug as org_slug,
          coalesce(sum(f.estimated_usd), 0) as estimated_usd,
          count(*) as call_count,
          coalesce(sum(f.input_tokens), 0) as input_tokens,
          coalesce(sum(f.output_tokens), 0) as output_tokens,
          coalesce(sum(f.cache_write_tokens), 0) as cache_write_tokens,
          coalesce(sum(f.cache_read_tokens), 0) as cache_read_tokens
        from filtered f
        left join public.orgs o on o.id = f.org_id
        group by f.org_id, o.name, o.slug
        order by estimated_usd desc, call_count desc
        limit 100
      ) row_data
    ), '[]'::jsonb),
    'by_model', coalesce((
      select jsonb_agg(to_jsonb(row_data) order by row_data.estimated_usd desc)
      from (
        select
          provider,
          model,
          tier,
          coalesce(sum(estimated_usd), 0) as estimated_usd,
          count(*) as call_count,
          coalesce(sum(input_tokens), 0) as input_tokens,
          coalesce(sum(output_tokens), 0) as output_tokens,
          coalesce(sum(cache_write_tokens), 0) as cache_write_tokens,
          coalesce(sum(cache_read_tokens), 0) as cache_read_tokens
        from filtered
        group by provider, model, tier
        order by estimated_usd desc, call_count desc
        limit 50
      ) row_data
    ), '[]'::jsonb),
    'over_time', coalesce((
      select jsonb_agg(to_jsonb(row_data) order by row_data.bucket_start)
      from (
        select
          date_trunc(v_bucket_unit, created_at) as bucket_start,
          coalesce(sum(estimated_usd), 0) as estimated_usd,
          count(*) as call_count,
          coalesce(sum(input_tokens), 0) as input_tokens,
          coalesce(sum(output_tokens), 0) as output_tokens,
          coalesce(sum(cache_write_tokens), 0) as cache_write_tokens,
          coalesce(sum(cache_read_tokens), 0) as cache_read_tokens
        from filtered
        group by bucket_start
        order by bucket_start
      ) row_data
    ), '[]'::jsonb),
    'top_artifacts', coalesce((
      select jsonb_agg(to_jsonb(row_data) order by row_data.estimated_usd desc)
      from (
        select
          f.artifact_id,
          a.project_id,
          a.title as artifact_title,
          p.name as project_name,
          o.name as org_name,
          coalesce(sum(f.estimated_usd), 0) as estimated_usd,
          count(*) as call_count,
          coalesce(sum(f.input_tokens), 0) as input_tokens,
          coalesce(sum(f.output_tokens), 0) as output_tokens,
          coalesce(sum(f.cache_write_tokens), 0) as cache_write_tokens,
          coalesce(sum(f.cache_read_tokens), 0) as cache_read_tokens,
          max(f.created_at) as last_event_at
        from filtered f
        left join public.artifacts a on a.id = f.artifact_id and a.org_id = f.org_id
        left join public.projects p on p.id = a.project_id and p.org_id = f.org_id
        left join public.orgs o on o.id = f.org_id
        where f.artifact_id is not null
        group by f.artifact_id, a.project_id, a.title, p.name, o.name
        order by estimated_usd desc, call_count desc
        limit v_top_n
      ) row_data
    ), '[]'::jsonb),
    'top_ingest_sources', coalesce((
      select jsonb_agg(to_jsonb(row_data) order by row_data.estimated_usd desc)
      from (
        select
          source_ids.source_id,
          s.project_id,
          s.title as source_title,
          s.type as source_type,
          p.name as project_name,
          o.name as org_name,
          coalesce(sum(f.estimated_usd), 0) as estimated_usd,
          count(*) as call_count,
          coalesce(sum(f.input_tokens), 0) as input_tokens,
          coalesce(sum(f.output_tokens), 0) as output_tokens,
          coalesce(sum(f.cache_write_tokens), 0) as cache_write_tokens,
          coalesce(sum(f.cache_read_tokens), 0) as cache_read_tokens,
          max(f.created_at) as last_event_at
        from filtered f
        left join public.agent_runs ar on ar.id = f.agent_run_id and ar.org_id = f.org_id
        left join lateral (
          select (ar.input->>'source_id')::uuid as source_id
          where ar.input->>'source_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        ) source_ids on true
        left join public.sources s on s.id = source_ids.source_id and s.org_id = f.org_id
        left join public.projects p on p.id = s.project_id and p.org_id = f.org_id
        left join public.orgs o on o.id = f.org_id
        where f.agent_type like 'ingest%'
          and source_ids.source_id is not null
        group by source_ids.source_id, s.project_id, s.title, s.type, p.name, o.name
        order by estimated_usd desc, call_count desc
        limit v_top_n
      ) row_data
    ), '[]'::jsonb),
    'notes', jsonb_build_object(
      'top_ingest_sources', 'Uses agent_runs.input.source_id when present; older ingest telemetry without a source_id is omitted.',
      'security', 'Aggregate-only SECURITY DEFINER RPC. It checks auth_is_super_admin() before reading cross-org labels and returns no raw llm_cost_events rows.'
    )
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_llm_cost_dashboard(text, text, integer) from public;
grant execute on function public.admin_llm_cost_dashboard(text, text, integer) to authenticated;

comment on function public.admin_llm_cost_dashboard(text, text, integer) is
  'Super-admin aggregate-only LLM cost dashboard data. Returns grouped cost summaries, not raw event rows.';
