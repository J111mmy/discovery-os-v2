-- Migration 0038: cached project outcome assessment.
--
-- Adds project-level cached output for the user-triggered outcome-assessment
-- agent. This does not add tables, policies, functions, or grants; existing
-- projects RLS continues to govern read/update access for authenticated users.

alter table public.projects
  add column if not exists outcome_assessment jsonb,
  add column if not exists outcome_assessed_at timestamptz;

comment on column public.projects.outcome_assessment is
  'Latest cached AI outcome assessment for the project. User-triggered only; contains structured status, rationale, gaps, next actions, artifact readiness, and small metadata.';

comment on column public.projects.outcome_assessed_at is
  'Timestamp of the latest successful outcome assessment.';
