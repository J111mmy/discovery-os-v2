-- Backfill legacy project rows and make archived null-safe permanently.
-- Jimmy applies in Supabase after Opus review.

update public.projects
set archived = false
where archived is null;

alter table public.projects
  alter column archived set default false,
  alter column archived set not null;
