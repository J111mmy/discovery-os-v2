// Discovery OS v2 — Database types
// These mirror the Supabase schema exactly.
// Run `supabase gen types typescript` to regenerate after schema changes.

export type OrgRole = "owner" | "admin" | "member" | "viewer";
export type TrustScope = "pending" | "trusted" | "disputed" | "excluded";
export type SourceType = "transcript" | "document" | "note" | "survey" | "support_ticket" | "other";
export type ArtifactType = "prd" | "brief" | "persona" | "opportunity" | "gtm" | "interview_guide" | "report" | "other";
export type VerificationStatus = "unverified" | "supported" | "disputed" | "retracted";
export type JobStatus = "pending" | "processing" | "done" | "failed";
export type TaskTier = "cheap" | "standard" | "premium" | "eval";

export interface Org {
  id: string;
  name: string;
  slug: string;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface OrgMember {
  id: string;
  org_id: string;
  user_id: string;
  role: OrgRole;
  display_name: string | null;
  joined_at: string;
}

export interface Project {
  id: string;
  org_id: string;
  name: string;
  slug: string;
  description: string | null;
  frame: string | null;
  gtm_context: string | null;
  operating_style: string | null;
  settings: Record<string, unknown>;
  archived: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Source {
  id: string;
  org_id: string;
  project_id: string;
  type: SourceType;
  title: string;
  description: string | null;
  raw_url: string | null;
  metadata: Record<string, unknown>;
  trust_scope: TrustScope;
  ingested_by: string | null;
  ingested_at: string;
  created_at: string;
}

export interface SourceSegment {
  id: string;
  org_id: string;
  source_id: string;
  segment_index: number;
  speaker: string | null;
  raw_content: string;
  redacted_content: string | null;
  word_count: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Evidence {
  id: string;
  org_id: string;
  project_id: string;
  source_id: string;
  segment_id: string | null;
  content: string;
  // embedding is vector(1536) — not returned by default, only for similarity queries
  trust_scope: TrustScope;
  summary: string | null;
  themes: string[];
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Artifact {
  id: string;
  org_id: string;
  project_id: string;
  type: ArtifactType;
  title: string;
  prompt: string;
  content_md: string;
  version: number;
  word_count: number | null;
  model_used: string | null;
  task_tier: TaskTier | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ArtifactClaim {
  id: string;
  artifact_id: string;
  org_id: string;
  claim_text: string;
  section_heading: string | null;
  verification_status: VerificationStatus;
  verified_at: string | null;
  verifier_model: string | null;
  notes: string | null;
  created_at: string;
}

export interface ArtifactClaimEvidence {
  id: string;
  claim_id: string;
  evidence_id: string;
  org_id: string;
  relevance: number | null;
  created_at: string;
}

export interface IngestJob {
  id: string;
  org_id: string;
  source_id: string;
  inngest_event_id: string | null;
  status: JobStatus;
  step_log: Array<{ step: string; status: string; ts: string; error?: string }>;
  result: { segments_created: number; evidence_created: number } | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

// ============================================================
// Query helpers
// ============================================================

export interface EvidenceRecord extends Evidence {
  source_title?: string;
  source_type?: SourceType;
}

export interface ComposeDraftRequest {
  project_id: string;
  org_id: string;
  prompt: string;
  limit?: number;
}

export interface ComposeDraftSection {
  heading: string;
  content: string;
}

export interface ComposeDraftResponse {
  title: string;
  sections: ComposeDraftSection[];
  evidence_ids: string[];
  model_used: string;
  task_tier: TaskTier;
}
