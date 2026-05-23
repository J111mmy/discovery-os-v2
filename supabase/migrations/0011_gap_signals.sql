-- Gap signals — stores what research areas lack evidence coverage
-- Written by the detect-gaps agent after every synthesis run

alter table projects
  add column if not exists gap_signals jsonb,
  add column if not exists gaps_detected_at timestamptz;
