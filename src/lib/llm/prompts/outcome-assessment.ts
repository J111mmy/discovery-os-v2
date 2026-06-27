export const OUTCOME_ASSESSMENT_PROMPT_VERSION = "outcome-assessment-v1";

export function buildOutcomeAssessmentPrompt(input: { projectSummary: string }) {
  return `
You are a senior product discovery lead assessing whether a research workspace is ready to produce outcome-driving work.

Use only the project summary below. It is a compact, trusted system summary of the current project state. Do not invent evidence, customers, outcomes, or artifacts.

Assess whether the project is:
- "met": enough evidence, problem clarity, and opportunity/action direction exist to satisfy the stated outcome now.
- "on_track": the project has a plausible path to the stated outcome, but needs specific next work.
- "blocked": the project cannot credibly satisfy the stated outcome yet because essential evidence, framing, or synthesis is missing.

Return only valid JSON with this exact shape:
{
  "outcome_status": "met",
  "rationale": "2-4 sentences explaining the status in plain language.",
  "gaps_to_outcome": [
    {
      "gap": "Specific gap blocking or weakening the desired outcome",
      "why_it_matters": "Why this gap matters for the outcome",
      "severity": "high"
    }
  ],
  "next_actions": [
    {
      "action": "Concrete next step",
      "priority": "high",
      "rationale": "Why this should happen next"
    }
  ],
  "generatable_artifacts": [
    {
      "artifact_type": "Artifact name",
      "purpose": "What decision or workflow it supports",
      "readiness": "ready"
    }
  ]
}

Rules:
- outcome_status must be one of: "met", "on_track", "blocked".
- severity and priority must be one of: "high", "medium", "low".
- readiness must be one of: "ready", "needs_more_evidence", "not_ready".
- gaps_to_outcome should contain 0-5 items.
- next_actions should contain 2-6 items unless the project is truly complete.
- generatable_artifacts should contain 0-6 items.
- Artifacts should be concrete outputs the app can generate from current project knowledge, such as executive brief, GTM narrative, PRD, sales deck, evidence review, interview guide, or decision memo.
- If the frame/outcome is missing, mark blocked and make setting the frame the first action.
- If evidence is thin or stale, say so. Do not overstate readiness.

PROJECT SUMMARY:
${input.projectSummary}
`.trim();
}
