-- BEFORE dump for SEC-RLS-2 / migration 0025.
-- Jimmy: run this in Supabase SQL Editor before Codex authors the migration.
-- Paste the full result back into OPUS_CODEX_CHANNEL.md for Opus review.

select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and (
    (tablename = 'actions' and policyname in (
      'members can insert actions',
      'members can update actions',
      'members can delete actions'
    ))
    or (tablename = 'artifact_versions' and policyname = 'members can insert artifact versions')
    or (tablename = 'artifacts' and policyname in (
      'members can insert artifacts',
      'members can update artifacts',
      'members can delete artifacts'
    ))
    or (tablename = 'companies' and policyname in (
      'members can insert companies',
      'members can update companies'
    ))
    or (tablename = 'competitors' and policyname in (
      'members can insert competitors',
      'members can update competitors'
    ))
    or (tablename = 'evidence' and policyname in (
      'members can delete evidence',
      'members can update evidence trust'
    ))
    or (tablename = 'ingest_jobs' and policyname in (
      'members can insert ingest jobs',
      'members can update ingest jobs'
    ))
    or (tablename = 'people' and policyname in (
      'members can insert people',
      'members can update people'
    ))
    or (tablename = 'problems' and policyname in (
      'org members can read problems',
      'org members can insert problems',
      'org members can update problems'
    ))
    or (tablename = 'product_requests' and policyname in (
      'members can insert product_requests',
      'members can update product_requests',
      'members can delete product_requests'
    ))
    or (tablename = 'project_opportunities' and policyname in (
      'members can insert project opportunities',
      'members can update project opportunities'
    ))
    or (tablename = 'project_opportunity_evidence' and policyname = 'members can insert project opportunity evidence')
    or (tablename = 'project_opportunity_projects' and policyname = 'members can insert project opportunity projects')
    or (tablename = 'projects' and policyname in (
      'members can insert projects',
      'members can update projects'
    ))
    or (tablename = 'skill_configs' and policyname = 'org owners can manage skill configs')
    or (tablename = 'source_segments' and policyname = 'members can delete segments')
    or (tablename = 'sources' and policyname in (
      'members can insert sources',
      'members can update sources',
      'members can delete sources'
    ))
  )
order by tablename, policyname, cmd;
