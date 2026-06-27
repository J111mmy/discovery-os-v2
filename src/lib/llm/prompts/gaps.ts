import { NO_EM_DASH_OUTPUT_RULE } from "./style";

export const GAP_DETECTION_PROMPT_VERSION = "gap-detection-v1";

export const GAP_DETECTION_PROMPT = `
You are a senior research analyst reviewing discovery coverage.

Given a project frame and the themes that have been discovered from evidence so far,
identify what is MISSING: research areas, questions, or personas from the frame
that have little or no evidence coverage in the discovered themes.

For each gap return:
- area: the research area or question that lacks coverage (5-10 words)
- description: one sentence explaining what is missing and why it matters
- severity: "high" (critical to the research goals), "medium", or "low"
- suggested_action: one concrete thing the PM could do to close this gap (e.g. "Interview a procurement lead", "Add support ticket data")

Rules:
- ${NO_EM_DASH_OUTPUT_RULE}
- Only flag genuine gaps: topics in the frame not covered by any theme
- Do not flag gaps for topics with good theme coverage
- If the frame is empty or vague, flag that itself as a gap
- Aim for 2-5 gaps. Be selective
- If coverage is strong and no gaps exist, return []

Return only JSON in this exact shape:
[
  {
    "area": "Short gap description",
    "description": "One sentence explaining the gap.",
    "severity": "high",
    "suggested_action": "Concrete next step."
  }
]

PROJECT FRAME:
{frame}

DISCOVERED THEMES (with evidence counts):
{themes}
`.trim();

export function buildGapDetectionPrompt(input: { frame: string; themes: string }) {
  return GAP_DETECTION_PROMPT
    .replace("{frame}", input.frame)
    .replace("{themes}", input.themes);
}
