-- Migration 0034: LLM cost telemetry
-- Stores per-call token and estimated cost metadata only.
-- No prompts, responses, or source content are stored in this table.

create or replace function public.auth_is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.super_admins
    where user_id = auth.uid()
  );
$$;

revoke all on function public.auth_is_super_admin() from public;
grant execute on function public.auth_is_super_admin() to authenticated;

create table if not exists public.llm_cost_events (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.orgs(id) on delete cascade,
  project_id         uuid references public.projects(id) on delete set null,
  artifact_id        uuid references public.artifacts(id) on delete set null,
  agent_run_id       uuid references public.agent_runs(id) on delete set null,
  agent_type         text not null,
  step               text not null,
  provider           text not null check (provider in ('anthropic', 'openai')),
  model              text not null,
  tier               text not null check (tier in ('cheap', 'standard', 'premium', 'eval')),
  input_tokens       integer not null default 0 check (input_tokens >= 0),
  output_tokens      integer not null default 0 check (output_tokens >= 0),
  cache_write_tokens integer not null default 0 check (cache_write_tokens >= 0),
  cache_read_tokens  integer not null default 0 check (cache_read_tokens >= 0),
  estimated_usd      numeric(12, 6) not null default 0 check (estimated_usd >= 0),
  pricing_version    text not null,
  created_at         timestamptz not null default now()
);

create index if not exists idx_llm_cost_events_org_project_created
  on public.llm_cost_events(org_id, project_id, created_at desc);

create index if not exists idx_llm_cost_events_model_agent_type
  on public.llm_cost_events(model, agent_type);

create index if not exists idx_llm_cost_events_agent_run
  on public.llm_cost_events(agent_run_id)
  where agent_run_id is not null;

alter table public.llm_cost_events enable row level security;

drop policy if exists "org members can read llm cost events" on public.llm_cost_events;
create policy "org members can read llm cost events"
  on public.llm_cost_events
  for select
  using (org_id in (select public.auth_user_org_ids()));

drop policy if exists "super admins can read all llm cost events" on public.llm_cost_events;
create policy "super admins can read all llm cost events"
  on public.llm_cost_events
  for select
  using (public.auth_is_super_admin());

comment on table public.llm_cost_events is
  'Per-call LLM token and estimated cost telemetry. Contains IDs, model metadata, token counts, and cost estimates only.';

comment on column public.llm_cost_events.estimated_usd is
  'Estimated provider cost in USD using the pricing_version stored on the row.';
