-- #180: distinguish a completed ingest with a required child-step failure
-- from a fully successful ingest.
alter type public.job_status
  add value if not exists 'done_with_issues' after 'done';
