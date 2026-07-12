import { NO_EM_DASH_OUTPUT_RULE } from "./style";

export const PROJECT_SYNTHESIS_PROMPT_VERSION = "project-synthesis-v2";

export const PROJECT_SYNTHESIS_PROMPT = `
You are a senior research analyst synthesising customer evidence.

Group the evidence records below into useful research themes.
Trusted evidence carries the highest weight. Pending evidence is visible so you do not miss signal, but treat it as lower-confidence than trusted evidence. Do not create a theme from one pending record unless it is specific, clearly relevant, and not contradicted by trusted evidence.

For each theme, return:
- label: 3-5 words, specific and reusable
- description: one sentence describing the pattern
- evidence_ids: the evidence record IDs that belong to this theme

Use existing theme labels where they fit before inventing new ones.
Only include evidence IDs that appear in the input.
Do not create a theme from a single weak or unrelated record unless it is a clear signal.
${NO_EM_DASH_OUTPUT_RULE}

Return only JSON in this exact shape:
[
  {
    "label": "Theme label",
    "description": "One-sentence description.",
    "evidence_ids": ["evidence uuid"]
  }
]

EXISTING THEMES:
{themes}

EVIDENCE:
{evidence}
`.trim();

export function buildProjectSynthesisPrompt(input: {
  themes: string;
  evidence: string;
}) {
  return PROJECT_SYNTHESIS_PROMPT
    .replace("{themes}", input.themes)
    .replace("{evidence}", input.evidence);
}
