# Tenant Composite Integrity Plan (#149)

## Purpose

The isolation harness found that single-column foreign keys preserve row
existence but do not prove that a child and parent belong to the same tenant.
RLS prevented direct cross-org reads, but three service-role digest agents made
one relationship family exploitable. The agents are being fixed first on a
separate expedited branch.

Production preflight on 2026-08-01 examined all 1,815 `evidence_entities` rows:

- evidence org mismatches: 0
- evidence project mismatches: 0
- missing evidence parents: 0
- person, company, or competitor org mismatches: 0
- missing typed entity parents: 0
- canonical `entity_id` versus typed-ID mismatches: 0

This means the vulnerability is latent in current data, not evidence of an
active cross-tenant exposure.

## Rollout Rules

1. Each relationship family gets a read-only production preflight before SQL is
   applied.
2. A non-zero mismatch stops that family. No row is reassigned automatically.
3. Parent composite unique indexes land before child composite foreign keys.
4. New foreign keys are added `NOT VALID`, then explicitly validated after the
   preflight. Existing single-column foreign keys remain during rollout.
5. Jimmy applies every migration after Opus review.
6. The #149 isolation harness is rerun after each family. The relevant
   `cross_org_parent_substitution` failures must reach zero before moving on.

## Family Sequence

### Family 1: Evidence-to-entity digest chain (0047)

This is the confirmed P0 relationship family and lands first:

- `evidence.project_id + org_id -> projects.id + org_id`
- `evidence_entities.project_id + org_id -> projects.id + org_id`
- `evidence_entities.evidence_id + org_id + project_id -> evidence.id + org_id + project_id`
- typed person, company, and competitor links constrained to the same org
- canonical `entity_id` required to agree with the corresponding typed ID for
  the three supported digest entity types

### Family 2: Raw source chain

Preflight and constrain:

- `sources -> projects`
- `source_segments -> sources`
- `evidence -> sources`
- `evidence -> source_segments`
- ingest jobs and source-owned operational records

The source and segment constraints should carry both tenant and project where
the child schema has those columns. Missing project columns are a schema-design
decision and are not added silently.

### Family 3: Analytical graph

Preflight and constrain themes, topics, problems, opportunities, and their join
tables. Each project-scoped join must agree on both `org_id` and `project_id`.
Nullable typed links use normal `MATCH SIMPLE` behavior so an absent optional
relationship remains valid.

### Family 4: Artifact and claim graph

Preflight and constrain artifacts, versions, claims, claim evidence, and the
typed artifact link tables. Artifact, linked object, tenant, and project must
all agree.

### Family 5: Remaining operational joins

Cover actions, requests, costs, memberships, invites, project-opportunity
tables, and any dynamically enumerated relationship not covered above.

## Rollback

Rollback removes only the new composite constraints and unique indexes for the
affected family. It does not delete or rewrite user data, and the original
single-column foreign keys remain available throughout the rollout.

## Separate Lesser Findings

- Migration 0046 removes anonymous execution from `auth_user_org_ids`,
  `auth_user_org_role`, and `match_evidence`, while retaining authenticated
  execution.
- `PATCH /api/actions/[actionId]` now checks whether an org-scoped update
  affected a row and returns `404` when it did not.
