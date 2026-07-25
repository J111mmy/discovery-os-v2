-- #179: enforce at most one active ingest job per source.
--
-- Precondition: existing duplicate active jobs must be resolved deliberately
-- before the unique index is created. This migration does not guess which live
-- run should survive.
do $$
begin
  if exists (
    select 1
    from public.ingest_jobs
    where status in ('pending', 'processing')
    group by source_id
    having count(*) > 1
  ) then
    raise exception
      'Cannot enforce ingest single-flight: duplicate pending/processing jobs exist';
  end if;
end
$$;

create unique index if not exists ingest_jobs_one_active_per_source
  on public.ingest_jobs (source_id)
  where status in ('pending', 'processing');

comment on index public.ingest_jobs_one_active_per_source is
  'Prevents concurrent pending/processing ingest jobs for the same source (#179).';
