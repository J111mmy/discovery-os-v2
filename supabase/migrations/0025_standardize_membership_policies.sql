-- SEC-RLS-2: standardize remaining inline org_members policy checks.
--
-- This is a semantics-preserving refactor only:
-- - member-and-above write policies keep owner/admin/member access.
-- - any-member problem policies keep any org membership access.
-- - owner-only skill config policy keeps owner-only access.
--
-- Do not apply until Opus reviews this migration against the live BEFORE
-- pg_policies dump and Jimmy completes the invite UI test gate.

-- ============================================================
-- Member-and-above helper expression:
-- public.auth_user_org_role(org_id) in owner/admin/member
-- ============================================================

drop policy if exists "members can delete actions" on public.actions;
create policy "members can delete actions"
  on public.actions for delete
  to public
  using (
    public.auth_user_org_role(org_id) = any(array[
      'owner'::public.org_role,
      'admin'::public.org_role,
      'member'::public.org_role
    ])
  );

drop policy if exists "members can insert actions" on public.actions;
create policy "members can insert actions"
  on public.actions for insert
  to public
  with check (
    public.auth_user_org_role(org_id) = any(array[
      'owner'::public.org_role,
      'admin'::public.org_role,
      'member'::public.org_role
    ])
  );

drop policy if exists "members can update actions" on public.actions;
create policy "members can update actions"
  on public.actions for update
  to public
  using (
    public.auth_user_org_role(org_id) = any(array[
      'owner'::public.org_role,
      'admin'::public.org_role,
      'member'::public.org_role
    ])
  );

drop policy if exists "members can insert artifact versions" on public.artifact_versions;
create policy "members can insert artifact versions"
  on public.artifact_versions for insert
  to public
  with check (
    public.auth_user_org_role(org_id) = any(array[
      'owner'::public.org_role,
      'admin'::public.org_role,
      'member'::public.org_role
    ])
  );

drop policy if exists "members can delete artifacts" on public.artifacts;
create policy "members can delete artifacts"
  on public.artifacts for delete
  to public
  using (
    public.auth_user_org_role(org_id) = any(array[
      'owner'::public.org_role,
      'admin'::public.org_role,
      'member'::public.org_role
    ])
  );

drop policy if exists "members can insert artifacts" on public.artifacts;
create policy "members can insert artifacts"
  on public.artifacts for insert
  to public
  with check (
    public.auth_user_org_role(org_id) = any(array[
      'owner'::public.org_role,
      'admin'::public.org_role,
      'member'::public.org_role
    ])
  );

drop policy if exists "members can update artifacts" on public.artifacts;
create policy "members can update artifacts"
  on public.artifacts for update
  to public
  using (
    public.auth_user_org_role(org_id) = any(array[
      'owner'::public.org_role,
      'admin'::public.org_role,
      'member'::public.org_role
    ])
  );

drop policy if exists "members can insert companies" on public.companies;
create policy "members can insert companies"
  on public.companies for insert
  to public
  with check (
    public.auth_user_org_role(org_id) = any(array[
      'owner'::public.org_role,
      'admin'::public.org_role,
      'member'::public.org_role
    ])
  );

drop policy if exists "members can update companies" on public.companies;
create policy "members can update companies"
  on public.companies for update
  to public
  using (
    public.auth_user_org_role(org_id) = any(array[
      'owner'::public.org_role,
      'admin'::public.org_role,
      'member'::public.org_role
    ])
  );

drop policy if exists "members can insert competitors" on public.competitors;
create policy "members can insert competitors"
  on public.competitors for insert
  to public
  with check (
    public.auth_user_org_role(org_id) = any(array[
      'owner'::public.org_role,
      'admin'::public.org_role,
      'member'::public.org_role
    ])
  );

drop policy if exists "members can update competitors" on public.competitors;
create policy "members can update competitors"
  on public.competitors for update
  to public
  using (
    public.auth_user_org_role(org_id) = any(array[
      'owner'::public.org_role,
      'admin'::public.org_role,
      'member'::public.org_role
    ])
  );

drop policy if exists "members can delete evidence" on public.evidence;
create policy "members can delete evidence"
  on public.evidence for delete
  to public
  using (
    public.auth_user_org_role(org_id) = any(array[
      'owner'::public.org_role,
      'admin'::public.org_role,
      'member'::public.org_role
    ])
  );

drop policy if exists "members can update evidence trust" on public.evidence;
create policy "members can update evidence trust"
  on public.evidence for update
  to public
  using (
    public.auth_user_org_role(org_id) = any(array[
      'owner'::public.org_role,
      'admin'::public.org_role,
      'member'::public.org_role
    ])
  )
  with check (
    public.auth_user_org_role(org_id) = any(array[
      'owner'::public.org_role,
      'admin'::public.org_role,
      'member'::public.org_role
    ])
  );

drop policy if exists "members can insert ingest jobs" on public.ingest_jobs;
create policy "members can insert ingest jobs"
  on public.ingest_jobs for insert
  to public
  with check (
    public.auth_user_org_role(org_id) = any(array[
      'owner'::public.org_role,
      'admin'::public.org_role,
      'member'::public.org_role
    ])
  );

drop policy if exists "members can update ingest jobs" on public.ingest_jobs;
create policy "members can update ingest jobs"
  on public.ingest_jobs for update
  to public
  using (
    public.auth_user_org_role(org_id) = any(array[
      'owner'::public.org_role,
      'admin'::public.org_role,
      'member'::public.org_role
    ])
  )
  with check (
    public.auth_user_org_role(org_id) = any(array[
      'owner'::public.org_role,
      'admin'::public.org_role,
      'member'::public.org_role
    ])
  );

drop policy if exists "members can insert people" on public.people;
create policy "members can insert people"
  on public.people for insert
  to public
  with check (
    public.auth_user_org_role(org_id) = any(array[
      'owner'::public.org_role,
      'admin'::public.org_role,
      'member'::public.org_role
    ])
  );

drop policy if exists "members can update people" on public.people;
create policy "members can update people"
  on public.people for update
  to public
  using (
    public.auth_user_org_role(org_id) = any(array[
      'owner'::public.org_role,
      'admin'::public.org_role,
      'member'::public.org_role
    ])
  );

-- ============================================================
-- Any-member problem policies.
-- Live semantics did not filter viewer/member/admin/owner role.
-- ============================================================

drop policy if exists "org members can insert problems" on public.problems;
create policy "org members can insert problems"
  on public.problems for insert
  to public
  with check (org_id in (select public.auth_user_org_ids()));

drop policy if exists "org members can read problems" on public.problems;
create policy "org members can read problems"
  on public.problems for select
  to public
  using (org_id in (select public.auth_user_org_ids()));

drop policy if exists "org members can update problems" on public.problems;
create policy "org members can update problems"
  on public.problems for update
  to public
  using (org_id in (select public.auth_user_org_ids()));

-- ============================================================
-- Continue member-and-above write policies.
-- ============================================================

drop policy if exists "members can delete product_requests" on public.product_requests;
create policy "members can delete product_requests"
  on public.product_requests for delete
  to public
  using (
    public.auth_user_org_role(org_id) = any(array[
      'owner'::public.org_role,
      'admin'::public.org_role,
      'member'::public.org_role
    ])
  );

drop policy if exists "members can insert product_requests" on public.product_requests;
create policy "members can insert product_requests"
  on public.product_requests for insert
  to public
  with check (
    public.auth_user_org_role(org_id) = any(array[
      'owner'::public.org_role,
      'admin'::public.org_role,
      'member'::public.org_role
    ])
  );

drop policy if exists "members can update product_requests" on public.product_requests;
create policy "members can update product_requests"
  on public.product_requests for update
  to public
  using (
    public.auth_user_org_role(org_id) = any(array[
      'owner'::public.org_role,
      'admin'::public.org_role,
      'member'::public.org_role
    ])
  );

drop policy if exists "members can insert project opportunities" on public.project_opportunities;
create policy "members can insert project opportunities"
  on public.project_opportunities for insert
  to public
  with check (
    public.auth_user_org_role(org_id) = any(array[
      'owner'::public.org_role,
      'admin'::public.org_role,
      'member'::public.org_role
    ])
  );

drop policy if exists "members can update project opportunities" on public.project_opportunities;
create policy "members can update project opportunities"
  on public.project_opportunities for update
  to public
  using (
    public.auth_user_org_role(org_id) = any(array[
      'owner'::public.org_role,
      'admin'::public.org_role,
      'member'::public.org_role
    ])
  );

drop policy if exists "members can insert project opportunity evidence" on public.project_opportunity_evidence;
create policy "members can insert project opportunity evidence"
  on public.project_opportunity_evidence for insert
  to public
  with check (
    public.auth_user_org_role(org_id) = any(array[
      'owner'::public.org_role,
      'admin'::public.org_role,
      'member'::public.org_role
    ])
  );

drop policy if exists "members can insert project opportunity projects" on public.project_opportunity_projects;
create policy "members can insert project opportunity projects"
  on public.project_opportunity_projects for insert
  to public
  with check (
    public.auth_user_org_role(org_id) = any(array[
      'owner'::public.org_role,
      'admin'::public.org_role,
      'member'::public.org_role
    ])
  );

drop policy if exists "members can insert projects" on public.projects;
create policy "members can insert projects"
  on public.projects for insert
  to public
  with check (
    public.auth_user_org_role(org_id) = any(array[
      'owner'::public.org_role,
      'admin'::public.org_role,
      'member'::public.org_role
    ])
  );

drop policy if exists "members can update projects" on public.projects;
create policy "members can update projects"
  on public.projects for update
  to public
  using (
    public.auth_user_org_role(org_id) = any(array[
      'owner'::public.org_role,
      'admin'::public.org_role,
      'member'::public.org_role
    ])
  );

-- ============================================================
-- Owner-only skill config management.
-- ============================================================

drop policy if exists "org owners can manage skill configs" on public.skill_configs;
create policy "org owners can manage skill configs"
  on public.skill_configs for all
  to public
  using (public.auth_user_org_role(org_id) = 'owner'::public.org_role)
  with check (public.auth_user_org_role(org_id) = 'owner'::public.org_role);

-- ============================================================
-- Final member-and-above source policies.
-- ============================================================

drop policy if exists "members can delete segments" on public.source_segments;
create policy "members can delete segments"
  on public.source_segments for delete
  to public
  using (
    public.auth_user_org_role(org_id) = any(array[
      'owner'::public.org_role,
      'admin'::public.org_role,
      'member'::public.org_role
    ])
  );

drop policy if exists "members can delete sources" on public.sources;
create policy "members can delete sources"
  on public.sources for delete
  to public
  using (
    public.auth_user_org_role(org_id) = any(array[
      'owner'::public.org_role,
      'admin'::public.org_role,
      'member'::public.org_role
    ])
  );

drop policy if exists "members can insert sources" on public.sources;
create policy "members can insert sources"
  on public.sources for insert
  to public
  with check (
    public.auth_user_org_role(org_id) = any(array[
      'owner'::public.org_role,
      'admin'::public.org_role,
      'member'::public.org_role
    ])
  );

drop policy if exists "members can update sources" on public.sources;
create policy "members can update sources"
  on public.sources for update
  to public
  using (
    public.auth_user_org_role(org_id) = any(array[
      'owner'::public.org_role,
      'admin'::public.org_role,
      'member'::public.org_role
    ])
  )
  with check (
    public.auth_user_org_role(org_id) = any(array[
      'owner'::public.org_role,
      'admin'::public.org_role,
      'member'::public.org_role
    ])
  );
