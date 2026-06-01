-- Evidence grading quality signal.
--
-- Adds provenance for the current evidence trust_scope and an append-only log
-- of human overrides. Existing evidence rows keep trust_scope_source='pending'
-- because historical trusted/excluded provenance is ambiguous.
--
-- Do not apply until Opus has reviewed this migration against the live
-- pg_policies/schema dump.

alter table evidence
  add column if not exists trust_scope_source text not null default 'pending'
    check (trust_scope_source in ('ai', 'human', 'pending'));

comment on column evidence.trust_scope_source is
  'Provenance for the current trust_scope: ai = automated grader, human = manual review action, pending = no known decision/provenance.';

create index if not exists idx_evidence_trust_scope_source
  on evidence(org_id, project_id, trust_scope_source, trust_scope);

create table if not exists evidence_grade_feedback (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  evidence_id uuid not null references evidence(id) on delete cascade,
  model_grade text check (model_grade in ('trusted', 'uncertain', 'weak')),
  from_scope trust_scope not null,
  to_scope trust_scope not null,
  from_source text not null default 'pending'
    check (from_source in ('ai', 'human', 'pending')),
  created_at timestamptz not null default now()
);

comment on table evidence_grade_feedback is
  'Append-only human override events for evidence grading quality analysis.';

comment on column evidence_grade_feedback.user_id is
  'Reviewer auth.users id captured for disagreement diagnostics. Do not personalize grading per reviewer.';

create index if not exists idx_evidence_grade_feedback_project_created
  on evidence_grade_feedback(org_id, project_id, created_at desc);

create index if not exists idx_evidence_grade_feedback_evidence
  on evidence_grade_feedback(org_id, evidence_id);

create index if not exists idx_evidence_grade_feedback_false_exclude
  on evidence_grade_feedback(project_id, from_source, from_scope, to_scope)
  where from_source = 'ai' and from_scope = 'excluded';

create index if not exists idx_evidence_grade_feedback_false_trust
  on evidence_grade_feedback(project_id, from_source, from_scope, to_scope)
  where from_source = 'ai' and from_scope = 'trusted';

alter table evidence_grade_feedback enable row level security;

drop policy if exists "org members can read evidence grade feedback"
  on evidence_grade_feedback;
create policy "org members can read evidence grade feedback"
  on evidence_grade_feedback for select
  using (org_id in (select auth_user_org_ids()));

drop policy if exists "org members can insert evidence grade feedback"
  on evidence_grade_feedback;
create policy "org members can insert evidence grade feedback"
  on evidence_grade_feedback for insert
  with check (
    user_id = auth.uid()
    and org_id in (select auth_user_org_ids())
    and exists (
      select 1
      from projects
      where projects.id = evidence_grade_feedback.project_id
        and projects.org_id = evidence_grade_feedback.org_id
    )
    and exists (
      select 1
      from evidence
      where evidence.id = evidence_grade_feedback.evidence_id
        and evidence.org_id = evidence_grade_feedback.org_id
        and evidence.project_id = evidence_grade_feedback.project_id
    )
  );
