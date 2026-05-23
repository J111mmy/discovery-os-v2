-- Migration 0013: Affiliation field on people + extended source_type enum
--
-- WHY:
-- 1. Internal speakers (sales team, researchers) appear in transcripts but their
--    speech is context, not customer evidence. The affiliation field lets the team
--    flag these people once, globally, so every future ingest treats them correctly.
-- 2. "transcript", "document", "other" are not meaningful source categories.
--    A usability study is different from a sales call — Claude should know the
--    source type when extracting evidence.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Add affiliation to people
-- ────────────────────────────────────────────────────────────────────────────

alter table people
  add column if not exists affiliation text not null default 'unknown'
  check (affiliation in ('internal', 'external', 'unknown'));

comment on column people.affiliation is
  'internal = company team member (sales, research, eng). '
  'external = customer, prospect, or third party. '
  'unknown  = not yet classified (default).';

create index if not exists idx_people_org_affiliation
  on people(org_id, affiliation);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Extend source_type enum with meaningful categories
-- ────────────────────────────────────────────────────────────────────────────
-- Postgres enums can only grow — existing values are preserved.
-- New values: customer_interview, sales_call, usability_study, internal_meeting

alter type source_type add value if not exists 'customer_interview';
alter type source_type add value if not exists 'sales_call';
alter type source_type add value if not exists 'usability_study';
alter type source_type add value if not exists 'internal_meeting';
