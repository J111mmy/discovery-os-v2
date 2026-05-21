-- Canonical evidence entity link shape
-- Keep legacy resolved FK columns, but add the generic entity_id used by the
-- product model: evidence_entities(evidence_id, entity_id, entity_type).

alter table evidence_entities
  add column if not exists entity_id uuid,
  add column if not exists relationship text;

update evidence_entities
set entity_id = coalesce(person_id, company_id, competitor_id)
where entity_id is null
  and (
    person_id is not null
    or company_id is not null
    or competitor_id is not null
  );

create unique index if not exists idx_evidence_entities_entity_unique
  on evidence_entities(evidence_id, entity_type, entity_id)
  where entity_id is not null;

create index if not exists idx_evidence_entities_entity_lookup
  on evidence_entities(org_id, entity_type, entity_id)
  where entity_id is not null;
