// Discovery OS v2 — Database types
// These mirror the Supabase schema exactly.
// Run `supabase gen types typescript` to regenerate after schema changes.

export type OrgRole = "owner" | "admin" | "member" | "viewer";
export type TrustScope = "pending" | "trusted" | "disputed" | "excluded";
export type SourceType =
  | "transcript"
  | "document"
  | "note"
  | "survey"
  | "support_ticket"
  | "other"
  | "web"
  | "slack"
  | "usability"
  | "monitoring"
  | "customer_interview"
  | "sales_call"
  | "usability_study"
  | "internal_meeting";

export type Affiliation = "internal" | "external" | "unknown";
export type ArtifactType = "prd" | "brief" | "persona" | "opportunity" | "gtm" | "interview_guide" | "report" | "other";
export type VerificationStatus = "unverified" | "supported" | "disputed" | "retracted";
export type ArtifactVerificationStatus = "verified" | "partial" | "unverified";
export type JobStatus = "pending" | "processing" | "done" | "failed";
export type TaskTier = "cheap" | "standard" | "premium" | "eval";
export type EvidenceClassification = "insight" | "verbatim" | "data_point" | "signal";
export type EvidenceSentiment = "positive" | "negative" | "neutral" | "mixed";
export type EntityType = "person" | "company" | "product" | "feature" | "pain_point" | "competitor";
export type PersonStatus =
  | "prospect"
  | "interviewed"
  | "concept-shown"
  | "demo-shown"
  | "beta-candidate"
  | "beta-participant"
  | "customer";
export type AgentRunStatus = "running" | "completed" | "failed";

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

export interface OrgInvite {
  id: string;
  org_id: string;
  email: string;
  role: "admin" | "member";
  token: string;
  accepted_at: string | null;
  expires_at: string;
  created_at: string;
}

export interface Project {
  id: string;
  org_id: string;
  name: string;
  slug: string;
  description: string | null;
  frame: string | null;
  frame_data: Record<string, unknown> | null;
  /** AI-proposed draft. Written by draft-frame when frame is null after first ingest. Does not overwrite frame. */
  frame_draft: { problem: string; hypothesis: string; buyers: string; research_areas: string[] } | null;
  frame_draft_generated_at: string | null;
  gtm_context: string | null;
  operating_style: string | null;
  settings: Record<string, unknown>;
  archived: boolean;
  synthesis_stale: boolean;
  last_synthesised_at: string | null;
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
  conversation_unit_id: string | null;
  char_start: number | null;
  char_end: number | null;
  start_time: string | null;
  end_time: string | null;
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
  classification: EvidenceClassification | null;
  sentiment: EvidenceSentiment | null;
  themes: string[];
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface EvidenceEntity {
  id: string;
  org_id: string;
  project_id: string;
  evidence_id: string;
  entity_id: string | null;
  entity_type: EntityType;
  label: string;
  metadata: Record<string, unknown>;
  person_id: string | null;
  company_id: string | null;
  competitor_id: string | null;
  relationship: string | null;
  created_at: string;
}

export interface Theme {
  id: string;
  org_id: string;
  project_id: string;
  label: string;
  description: string | null;
  evidence_count: number;
  created_at: string;
}

export interface EvidenceTheme {
  evidence_id: string;
  theme_id: string;
  org_id: string;
  confidence: number | null;
  created_at: string;
}

export interface Company {
  id: string;
  org_id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  size: string | null;
  notes: string | null;
  /** AI-synthesised narrative profile. Written by synthesise-company Inngest function. */
  digest: string | null;
  digest_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Person {
  id: string;
  org_id: string;
  name: string;
  role: string | null;
  email: string | null;
  company_id: string | null;
  status: PersonStatus;
  affiliation: Affiliation;
  digest: string | null;
  digest_updated_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Competitor {
  id: string;
  org_id: string;
  name: string;
  slug: string;
  website: string | null;
  positioning: string | null;
  known_strengths: string | null;
  known_gaps: string | null;
  last_researched: string | null;
  created_at: string;
  updated_at: string;
}

export interface PersonProject {
  person_id: string;
  project_id: string;
  status: string | null;
  first_seen: string;
}

export interface CompanyProject {
  company_id: string;
  project_id: string;
  first_seen: string;
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
  verification_status: ArtifactVerificationStatus;
  verification_run_at: string | null;
  verification_summary: Record<string, unknown> | null;
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
  verified: boolean | null;
  verification_note: string | null;
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

export interface ArtifactVersion {
  id: string;
  artifact_id: string;
  org_id: string;
  version: number;
  content_md: string;
  saved_by: string | null;
  saved_at: string;
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

export type ActionStatus = "open" | "done" | "dismissed";
export type PrioritySignal = "nice_to_have" | "important" | "critical";
export type ProductRequestStatus = "open" | "backlog" | "in_progress" | "shipped" | "dismissed";

export interface Action {
  id: string;
  org_id: string;
  project_id: string;
  source_id: string;
  evidence_id: string | null;
  description: string;
  owner: string | null;
  due_note: string | null;
  status: ActionStatus;
  created_at: string;
  updated_at: string;
}

export interface ProductRequest {
  id: string;
  org_id: string;
  project_id: string;
  source_id: string;
  evidence_id: string | null;
  company_id: string | null;
  description: string;
  requester_name: string | null;
  priority_signal: PrioritySignal;
  status: ProductRequestStatus;
  created_at: string;
  updated_at: string;
}

export interface AgentRun {
  id: string;
  org_id: string;
  project_id: string | null;
  agent_type: string;
  status: AgentRunStatus;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  error: string | null;
  model_used: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface SkillConfig {
  id: string;
  org_id: string | null;
  skill_type: string;
  system_prompt: string | null;
  output_schema: Record<string, unknown> | null;
  model_tier: TaskTier;
  prompt_version: string | null;
  active: boolean;
  updated_at: string;
}

// ============================================================
// Query helpers
// ============================================================

export interface EvidenceRecord extends Evidence {
  source_title?: string;
  source_type?: SourceType;
  segment_speaker?: string | null;
  segment_index?: number | null;
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
