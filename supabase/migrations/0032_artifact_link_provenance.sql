-- #26 structure-driven compose provenance.
--
-- Adds provenance fields to the final artifact-link hop so generated GTM
-- artifacts can be traced through artifact -> opportunity/problem/theme ->
-- evidence -> source with the same review/provenance shape as the upstream
-- ontology joins.
--
-- Jimmy applies this in Supabase after Opus approval. This migration is
-- additive and idempotent; no RLS policy changes are required because 0030
-- already enables/policies these tables.

alter table public.artifact_evidence
  add column if not exists source public.analysis_source not null default 'ai',
  add column if not exists review_state public.review_state not null default 'suggested',
  add column if not exists agent_run_id uuid references public.agent_runs(id) on delete set null,
  add column if not exists rationale text;

alter table public.artifact_problems
  add column if not exists source public.analysis_source not null default 'ai',
  add column if not exists review_state public.review_state not null default 'suggested',
  add column if not exists agent_run_id uuid references public.agent_runs(id) on delete set null,
  add column if not exists rationale text;

alter table public.artifact_themes
  add column if not exists source public.analysis_source not null default 'ai',
  add column if not exists review_state public.review_state not null default 'suggested',
  add column if not exists agent_run_id uuid references public.agent_runs(id) on delete set null,
  add column if not exists rationale text;

alter table public.artifact_opportunities
  add column if not exists source public.analysis_source not null default 'ai',
  add column if not exists review_state public.review_state not null default 'suggested',
  add column if not exists agent_run_id uuid references public.agent_runs(id) on delete set null,
  add column if not exists rationale text;

comment on column public.artifact_evidence.source is
  'Provenance source for the artifact-to-evidence relationship.';
comment on column public.artifact_evidence.review_state is
  'Review state for the artifact-to-evidence relationship.';
comment on column public.artifact_evidence.agent_run_id is
  'Agent run that created or last generated this artifact-to-evidence relationship.';
comment on column public.artifact_evidence.rationale is
  'Reason this evidence is cited by the artifact.';

comment on column public.artifact_problems.source is
  'Provenance source for the artifact-to-problem relationship.';
comment on column public.artifact_problems.review_state is
  'Review state for the artifact-to-problem relationship.';
comment on column public.artifact_problems.agent_run_id is
  'Agent run that created or last generated this artifact-to-problem relationship.';
comment on column public.artifact_problems.rationale is
  'Reason this problem is addressed by the artifact.';

comment on column public.artifact_themes.source is
  'Provenance source for the artifact-to-theme relationship.';
comment on column public.artifact_themes.review_state is
  'Review state for the artifact-to-theme relationship.';
comment on column public.artifact_themes.agent_run_id is
  'Agent run that created or last generated this artifact-to-theme relationship.';
comment on column public.artifact_themes.rationale is
  'Reason this theme is addressed by the artifact.';

comment on column public.artifact_opportunities.source is
  'Provenance source for the artifact-to-opportunity relationship.';
comment on column public.artifact_opportunities.review_state is
  'Review state for the artifact-to-opportunity relationship.';
comment on column public.artifact_opportunities.agent_run_id is
  'Agent run that created or last generated this artifact-to-opportunity relationship.';
comment on column public.artifact_opportunities.rationale is
  'Reason this opportunity is addressed by the artifact.';
