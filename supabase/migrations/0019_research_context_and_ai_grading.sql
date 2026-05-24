-- Migration 0019: Project research context + evidence AI grading
--
-- Projects gain a structured research_context field so the AI has enough
-- information to grade evidence relevance from the moment of ingest.
--
-- Evidence gains two new fields:
--   ai_trust_grade  — AI's assessment: 'trusted' | 'uncertain' | 'weak'
--   ai_trust_reason — one-line explanation of the grade
--   ai_graded_at    — when the grade was set
--
-- The user's trust_scope remains the source of truth for synthesis.
-- When ai_trust_grade = 'trusted', ingest auto-sets trust_scope = 'trusted'.
-- When ai_trust_grade = 'uncertain' or 'weak', trust_scope stays 'pending'
-- and the user can promote or dismiss individually.

-- ============================================================
-- PROJECTS — research context
-- ============================================================

alter table projects
  add column if not exists research_context jsonb;

-- research_context shape (all fields optional — filled progressively):
-- {
--   "goals":              "What we're trying to learn",
--   "outcomes":           "What decisions this will inform",
--   "buyers":             "Who we're talking to — persona, role, company type",
--   "scope_in":           "Topics that are in scope",
--   "scope_out":          "Topics explicitly out of scope",
--   "research_questions": ["Question 1", "Question 2"]
-- }

comment on column projects.research_context is
  'Structured context used by the AI to grade evidence relevance. Set before first ingest for best results.';

-- ============================================================
-- EVIDENCE — AI grading fields
-- ============================================================

alter table evidence
  add column if not exists ai_trust_grade  text
    check (ai_trust_grade in ('trusted', 'uncertain', 'weak')),
  add column if not exists ai_trust_reason text,
  add column if not exists ai_graded_at    timestamptz;

comment on column evidence.ai_trust_grade is
  'AI-assessed relevance grade. trusted = auto-included in synthesis; uncertain/weak = queued for user review.';

comment on column evidence.ai_trust_reason is
  'One-line explanation of why the AI assigned this grade. Shown to the user for transparency.';

-- Index for filtering by grade — used by evidence review UI
create index if not exists idx_evidence_ai_grade
  on evidence(org_id, project_id, ai_trust_grade);
