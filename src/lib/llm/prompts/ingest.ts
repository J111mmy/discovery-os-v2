export const INGEST_EXTRACTION_PROMPT_VERSION = "ingest-extraction-v2";

export const INGEST_EXTRACTION_PROMPT = `
You are a senior research analyst reviewing customer discovery material.

Read the conversation unit below. Extract every discrete, citable claim made by any participant.

For each claim return:
- content: the exact quote or close paraphrase, in quotable form
- summary: one sentence describing what this claim means
- classification: one of insight | verbatim | data_point | signal
- sentiment: one of positive | negative | neutral | mixed
- speaker: the speaker's name or label, or null if unknown
- themes: an array of short theme labels, preferring the existing themes where relevant
- adjacent_project_hint: if the claim is more relevant to one of the OTHER ACTIVE PROJECTS listed below than to the current project, include that project's name here; otherwise omit or return null

Return only a JSON array. Do not include markdown fences or explanatory text.
Extract as many claims as the content supports. If there are no citable claims, return [].
Do not extract greetings, filler acknowledgements, backchannels, or standalone fragments such as "yeah", "okay", "right", or "I agree" unless they contain a concrete claim.

PROJECT FRAME (what this project is investigating):
{frame}

EXISTING THEMES IN THIS ORG (prefer these before inventing new ones):
{themes}

KNOWN PROBLEMS IN THIS PROJECT (flag if evidence supports or contradicts any of these):
{problems}

OTHER ACTIVE PROJECTS (flag signals that belong here instead of or in addition to the current project):
{otherProjects}

CONVERSATION UNIT:
{content}
`.trim();

export function buildIngestExtractionPrompt(input: {
  content: string;
  frame: string;
  themes: string;
  problems: string;
  otherProjects: string;
}) {
  return INGEST_EXTRACTION_PROMPT
    .replace("{content}", input.content)
    .replace("{frame}", input.frame)
    .replace("{themes}", input.themes)
    .replace("{problems}", input.problems)
    .replace("{otherProjects}", input.otherProjects);
}
