export type AgentCategory =
  | "Intake"
  | "Evidence quality"
  | "Synthesis"
  | "Entity intelligence"
  | "Creation"
  | "Governance";

export type AgentRegistryItem = {
  id: string;
  name: string;
  category: AgentCategory;
  event: string;
  purpose: string;
  input: string[];
  output: string[];
  scope: string[];
  boundaries: string[];
};

export const AGENT_REGISTRY: AgentRegistryItem[] = [
  {
    id: "ingest-source",
    name: "Ingest Source",
    category: "Intake",
    event: "source/ingest.requested",
    purpose: "Turns a submitted source into segments and citable evidence for one project.",
    input: ["org_id", "project_id", "source_id", "job_id"],
    output: ["source_segments", "evidence", "ingest_jobs result", "projects.synthesis_stale"],
    scope: ["One submitted source", "One project", "One organisation"],
    boundaries: [
      "Does not run project-wide synthesis automatically",
      "Marks the project stale instead of spending on full recomputation",
    ],
  },
  {
    id: "grade-evidence",
    name: "Grade Evidence",
    category: "Evidence quality",
    event: "source/evidence.grading.requested",
    purpose: "Reviews extracted evidence against the project frame and assigns trust scope.",
    input: ["org_id", "project_id", "source_id"],
    output: ["evidence trust_scope", "grade reason metadata", "agent_runs diagnostics"],
    scope: ["Evidence from one source", "Project frame and research context"],
    boundaries: [
      "Does not delete evidence",
      "Unclear records become review items rather than trusted facts",
    ],
  },
  {
    id: "extract-entities",
    name: "Extract Entities",
    category: "Intake",
    event: "source/entities.requested",
    purpose: "Finds people, companies, and competitors mentioned in trusted source evidence.",
    input: ["org_id", "project_id", "source_id"],
    output: ["people", "companies", "competitors", "evidence_entities", "digest events"],
    scope: ["Entities grounded in one source", "Existing org directory"],
    boundaries: [
      "Filters common junk names and tool-like competitors",
      "Entity digests run separately after extraction",
    ],
  },
  {
    id: "extract-actions",
    name: "Extract Actions and Requests",
    category: "Intake",
    event: "source/actions.requested",
    purpose: "Extracts follow-ups, commitments, and product requests from one source.",
    input: ["org_id", "project_id", "source_id"],
    output: ["actions", "product_requests"],
    scope: ["One source", "Project-level action/request records"],
    boundaries: ["Does not alter evidence trust", "Does not create roadmap decisions automatically"],
  },
  {
    id: "session-review",
    name: "Session Review",
    category: "Intake",
    event: "source/review.requested",
    purpose: "Creates a readable session review artifact from one source.",
    input: ["org_id", "project_id", "source_id"],
    output: ["session review artifact content"],
    scope: ["One source", "Project documents"],
    boundaries: ["Uses render-time sanitisation", "Does not replace project synthesis"],
  },
  {
    id: "draft-frame",
    name: "Draft Project Frame",
    category: "Synthesis",
    event: "project/frame.requested",
    purpose: "Suggests an editable project frame from early trusted evidence.",
    input: ["org_id", "project_id", "source_id"],
    output: ["projects.frame_draft", "frame_draft_generated_at"],
    scope: ["One project", "Trusted evidence available at the time"],
    boundaries: ["Writes a draft only", "Human accepts or edits before it becomes project context"],
  },
  {
    id: "synthesise-project",
    name: "Synthesise Project",
    category: "Synthesis",
    event: "project/synthesis.requested",
    purpose: "Builds the project theme landscape from trusted evidence.",
    input: ["org_id", "project_id", "requested_by user action"],
    output: ["themes", "theme_evidence", "project/synthesis.completed"],
    scope: ["One project", "Trusted and visible evidence"],
    boundaries: [
      "User initiated only",
      "Does not run on a timer or immediately after ingest",
    ],
  },
  {
    id: "discover-problems",
    name: "Discover Problems",
    category: "Synthesis",
    event: "project/problems.requested",
    purpose: "Turns themes and evidence into problem statements with typed links.",
    input: ["org_id", "project_id", "dry_run optional"],
    output: ["problems", "problem_theme", "problem_evidence", "problem_topic"],
    scope: ["One project", "Reviewed themes and linked evidence"],
    boundaries: [
      "Preserves acknowledged or active problem state",
      "Runs under one in-flight job per project",
    ],
  },
  {
    id: "generate-opportunities",
    name: "Generate Opportunities",
    category: "Synthesis",
    event: "project/opportunities.requested",
    purpose: "Suggests opportunities from problem, theme, and evidence links.",
    input: ["org_id", "project_id", "dry_run optional"],
    output: ["opportunities", "opportunity_problem", "opportunity_evidence", "opportunity_theme"],
    scope: ["One project", "Active problem layer"],
    boundaries: [
      "Explicit user trigger only",
      "Batched to stay under serverless execution limits",
    ],
  },
  {
    id: "assess-outcome",
    name: "Assess Outcome",
    category: "Synthesis",
    event: "project/outcome.assess.requested",
    purpose: "Assesses whether the project is meeting the stated research outcome.",
    input: ["org_id", "project_id"],
    output: ["projects.outcome_assessment", "outcome_assessed_at"],
    scope: ["One project summary", "Latest problems, themes, opportunities, and gaps"],
    boundaries: ["Summary input only", "Does not rerun gap detection"],
  },
  {
    id: "detect-gaps",
    name: "Detect Research Gaps",
    category: "Governance",
    event: "project/synthesis.completed",
    purpose: "Identifies gaps after an explicit synthesis run completes.",
    input: ["org_id", "project_id"],
    output: ["projects.gap_signals"],
    scope: ["One project", "Fresh synthesis output"],
    boundaries: ["Triggered only after user-initiated synthesis", "Does not ingest or generate documents"],
  },
  {
    id: "compose-artifact",
    name: "Compose Artifact",
    category: "Creation",
    event: "artifact/compose.requested",
    purpose: "Generates a draft artifact from the problem, theme, opportunity, and evidence chain.",
    input: ["org_id", "project_id", "artifact_id", "prompt", "limit", "dry_run optional"],
    output: ["artifact content", "artifact_evidence", "artifact_problems", "artifact_themes", "artifact_opportunities"],
    scope: ["One artifact", "One project traceability chain"],
    boundaries: ["Explicit user action only", "Writes typed provenance links for trust review"],
  },
  {
    id: "verify-claims",
    name: "Verify Claims",
    category: "Governance",
    event: "artifact/claim.verification.requested",
    purpose: "Checks artifact claims against linked evidence.",
    input: ["org_id", "project_id", "artifact_id"],
    output: ["artifact_claims", "artifact_claim_evidence", "artifacts.verification_status"],
    scope: ["One artifact", "Claims and cited evidence"],
    boundaries: ["Explicit verification action", "Does not silently rewrite the artifact"],
  },
  {
    id: "synthesise-person",
    name: "Synthesise Person",
    category: "Entity intelligence",
    event: "person/digest.requested",
    purpose: "Summarises what is known about one person from linked evidence.",
    input: ["org_id", "project_id", "person_id"],
    output: ["person digest fields"],
    scope: ["One person", "Evidence linked to that person"],
    boundaries: ["Does not merge people", "Does not infer internal/external status without evidence"],
  },
  {
    id: "synthesise-company",
    name: "Synthesise Company",
    category: "Entity intelligence",
    event: "company/digest.requested",
    purpose: "Summarises what is known about one company from linked evidence.",
    input: ["org_id", "project_id", "company_id"],
    output: ["company digest fields"],
    scope: ["One company", "Evidence linked to that company"],
    boundaries: ["Does not classify tools as companies by itself", "Does not merge companies"],
  },
  {
    id: "synthesise-competitor",
    name: "Synthesise Competitor",
    category: "Entity intelligence",
    event: "competitor/digest.requested",
    purpose: "Summarises competitor mentions from linked evidence.",
    input: ["org_id", "project_id", "competitor_id"],
    output: ["competitor digest fields"],
    scope: ["One competitor", "Evidence linked to that competitor"],
    boundaries: ["Only meaningful when the project frame defines a product to compete with"],
  },
];

export const AGENT_CATEGORY_ORDER: AgentCategory[] = [
  "Intake",
  "Evidence quality",
  "Synthesis",
  "Creation",
  "Entity intelligence",
  "Governance",
];
