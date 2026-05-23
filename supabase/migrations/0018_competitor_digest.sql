-- Migration 0018: Competitor digest and battle card columns
--
-- The competitors table already has positioning, known_strengths, known_gaps,
-- and last_researched from migration 0006. This migration adds:
--
--   digest            text       — AI prose narrative from all linked evidence
--   digest_updated_at timestamptz — when the digest was last written
--   battle_card       jsonb      — structured 5-field battle card
--                                  AI fills their_pitch/where_they_win/their_gap
--                                  Jimmy fills your_counter/one_proof_point
--
-- The synthesise-competitor Inngest function writes all these fields plus
-- updates the existing positioning/known_strengths/known_gaps/last_researched.

alter table competitors
  add column if not exists digest            text,
  add column if not exists digest_updated_at timestamptz,
  add column if not exists battle_card       jsonb;

comment on column competitors.digest is
  'AI prose narrative synthesised from all evidence mentioning this competitor. Written by synthesise-competitor Inngest function.';

comment on column competitors.digest_updated_at is
  'When the current digest was last generated.';

comment on column competitors.battle_card is
  'Structured battle card. AI populates their_pitch, where_they_win, their_gap from evidence.
   Jimmy fills your_counter and one_proof_point manually.
   Shape: { their_pitch, where_they_win, their_gap, your_counter, one_proof_point }';
