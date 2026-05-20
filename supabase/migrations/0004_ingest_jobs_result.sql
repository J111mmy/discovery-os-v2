-- Add result column to ingest_jobs to store pipeline output counts
alter table ingest_jobs add column if not exists result jsonb;
