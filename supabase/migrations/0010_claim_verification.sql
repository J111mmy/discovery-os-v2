-- Claim verification agent state.
-- Supporting evidence links stay in artifact_claim_evidence; no UUID array relationship columns.

alter table artifacts
  add column if not exists verification_status text not null default 'unverified',
  add column if not exists verification_run_at timestamptz,
  add column if not exists verification_summary jsonb;

do $$
begin
  alter table artifacts
    add constraint artifacts_verification_status_check
    check (verification_status in ('verified', 'partial', 'unverified'));
exception
  when duplicate_object then null;
end $$;

alter table artifact_claims
  add column if not exists verified bool,
  add column if not exists verification_note text;

alter table artifacts enable row level security;
alter table artifact_claims enable row level security;
alter table artifact_claim_evidence enable row level security;

create index if not exists idx_artifacts_org_verification
  on artifacts(org_id, verification_status);

comment on column artifacts.verification_status is
  'Artifact-level claim verification status: verified, partial, or unverified.';
comment on column artifacts.verification_summary is
  'Agent-produced claim verification counts and run metadata.';
comment on column artifact_claims.verified is
  'True when the verifier found trusted evidence that supports this claim.';
comment on column artifact_claims.verification_note is
  'One-sentence explanation from the claim verification agent.';
