-- Migration 0047: enforce tenant integrity for the evidence-to-entity digest
-- chain identified as exploitable by the #149 isolation harness.
--
-- This is the first composite-integrity family only. It intentionally retains
-- the existing single-column foreign keys while adding same-tenant checks.
-- Jimmy applies this migration only after Opus review.

do $$
declare
  mismatch_count bigint;
begin
  select count(*)
  into mismatch_count
  from public.evidence_entities ee
  join public.evidence e on e.id = ee.evidence_id
  where e.org_id <> ee.org_id
     or e.project_id <> ee.project_id;

  if mismatch_count > 0 then
    raise exception
      '0047 preflight failed: % evidence_entities rows mismatch their evidence tenant or project',
      mismatch_count;
  end if;

  select count(*)
  into mismatch_count
  from public.evidence e
  join public.projects p on p.id = e.project_id
  where p.org_id <> e.org_id;

  if mismatch_count > 0 then
    raise exception
      '0047 preflight failed: % evidence rows mismatch their project tenant',
      mismatch_count;
  end if;

  select count(*)
  into mismatch_count
  from public.evidence_entities ee
  join public.projects p on p.id = ee.project_id
  where p.org_id <> ee.org_id;

  if mismatch_count > 0 then
    raise exception
      '0047 preflight failed: % evidence_entities rows mismatch their project tenant',
      mismatch_count;
  end if;

  select count(*)
  into mismatch_count
  from public.evidence_entities ee
  left join public.people p on p.id = ee.person_id
  left join public.companies c on c.id = ee.company_id
  left join public.competitors co on co.id = ee.competitor_id
  where (ee.person_id is not null and (p.id is null or p.org_id <> ee.org_id))
     or (ee.company_id is not null and (c.id is null or c.org_id <> ee.org_id))
     or (ee.competitor_id is not null and (co.id is null or co.org_id <> ee.org_id));

  if mismatch_count > 0 then
    raise exception
      '0047 preflight failed: % evidence_entities rows mismatch a typed entity tenant',
      mismatch_count;
  end if;

  select count(*)
  into mismatch_count
  from public.evidence_entities ee
  where (ee.entity_type = 'person' and (
           ee.entity_id is distinct from ee.person_id
           or ee.person_id is null
           or ee.company_id is not null
           or ee.competitor_id is not null
         ))
     or (ee.entity_type = 'company' and (
           ee.entity_id is distinct from ee.company_id
           or ee.company_id is null
           or ee.person_id is not null
           or ee.competitor_id is not null
         ))
     or (ee.entity_type = 'competitor' and (
           ee.entity_id is distinct from ee.competitor_id
           or ee.competitor_id is null
           or ee.person_id is not null
           or ee.company_id is not null
         ));

  if mismatch_count > 0 then
    raise exception
      '0047 preflight failed: % evidence_entities rows have inconsistent canonical and typed entity ids',
      mismatch_count;
  end if;
end
$$;

create unique index evidence_id_org_project_uidx
  on public.evidence (id, org_id, project_id);

create unique index projects_id_org_uidx
  on public.projects (id, org_id);

create unique index people_id_org_uidx
  on public.people (id, org_id);

create unique index companies_id_org_uidx
  on public.companies (id, org_id);

create unique index competitors_id_org_uidx
  on public.competitors (id, org_id);

alter table public.evidence
  add constraint evidence_project_same_org_fkey
  foreign key (project_id, org_id)
  references public.projects (id, org_id)
  not valid;

alter table public.evidence_entities
  add constraint evidence_entities_project_same_org_fkey
  foreign key (project_id, org_id)
  references public.projects (id, org_id)
  not valid,
  add constraint evidence_entities_evidence_same_scope_fkey
  foreign key (evidence_id, org_id, project_id)
  references public.evidence (id, org_id, project_id)
  not valid,
  add constraint evidence_entities_person_same_org_fkey
  foreign key (person_id, org_id)
  references public.people (id, org_id)
  not valid,
  add constraint evidence_entities_company_same_org_fkey
  foreign key (company_id, org_id)
  references public.companies (id, org_id)
  not valid,
  add constraint evidence_entities_competitor_same_org_fkey
  foreign key (competitor_id, org_id)
  references public.competitors (id, org_id)
  not valid,
  add constraint evidence_entities_canonical_target_check
  check (
    entity_type not in ('person', 'company', 'competitor')
    or (
      entity_type = 'person'
      and entity_id is not distinct from person_id
      and person_id is not null
      and company_id is null
      and competitor_id is null
    )
    or (
      entity_type = 'company'
      and entity_id is not distinct from company_id
      and company_id is not null
      and person_id is null
      and competitor_id is null
    )
    or (
      entity_type = 'competitor'
      and entity_id is not distinct from competitor_id
      and competitor_id is not null
      and person_id is null
      and company_id is null
    )
  ) not valid;

alter table public.evidence
  validate constraint evidence_project_same_org_fkey;

alter table public.evidence_entities
  validate constraint evidence_entities_project_same_org_fkey,
  validate constraint evidence_entities_evidence_same_scope_fkey,
  validate constraint evidence_entities_person_same_org_fkey,
  validate constraint evidence_entities_company_same_org_fkey,
  validate constraint evidence_entities_competitor_same_org_fkey,
  validate constraint evidence_entities_canonical_target_check;

comment on constraint evidence_entities_evidence_same_scope_fkey
  on public.evidence_entities is
  'Prevents an entity link from referencing evidence in another tenant or project.';
