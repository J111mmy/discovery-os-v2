// Frame draft prompt — proposes a structured project frame from early evidence
// Triggered after the first ingest when projects.frame is null.
// Output is JSON: { problem, hypothesis, buyers, research_areas }

export const FRAME_DRAFT_PROMPT_VERSION = "frame-draft-v1";

export const FRAME_DRAFT_PROMPT = `
You are a senior product researcher helping a team frame their discovery project.

You have just read the first batch of evidence from a research session. Based on what you heard, propose a draft project frame. This frame will be shown to the researcher as a suggested starting point — they will edit or discard it. Be specific to what you actually heard, not generic.

Return a single JSON object with exactly these four keys:

{
  "problem":          "<one or two sentences: the core customer problem or job-to-be-done this project is investigating, as evidenced by what you heard>",
  "hypothesis":       "<one sentence: your working hypothesis about what solution or improvement would address this problem>",
  "buyers":           "<one or two sentences: who the buyers or primary users appear to be, based on the evidence — role, context, characteristics>",
  "research_areas":   ["<area 1>", "<area 2>", "<area 3>"]
}

Guidelines:
- research_areas: 3–5 short labels (5 words or fewer each) covering the main open questions this project still needs to answer
- Write in second person for problem and buyers ("Customers struggle with…", "The primary buyer appears to be…")
- hypothesis starts with "If we…" or "We believe that…"
- Be concrete and specific — reference what was actually said, not boilerplate PM phrases
- Do not invent details not supported by the evidence
- Return only the JSON object — no markdown fences, no preamble

PROJECT NAME:
{projectName}

EVIDENCE ({evidenceCount} records from {sourceTitle}):
{evidence}
`.trim();

export type FrameDraft = {
  problem: string;
  hypothesis: string;
  buyers: string;
  research_areas: string[];
};

export function buildFrameDraftPrompt(params: {
  projectName: string;
  sourceTitle: string;
  evidence: string;
  evidenceCount: number;
}): string {
  return FRAME_DRAFT_PROMPT
    .replace("{projectName}", params.projectName)
    .replace("{sourceTitle}", params.sourceTitle)
    .replace("{evidence}", params.evidence)
    .replace("{evidenceCount}", String(params.evidenceCount));
}

export function parseFrameDraft(raw: string): FrameDraft | null {
  try {
    // Strip markdown fences if model added them despite instructions
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\n?/, "")
      .replace(/\n?```$/, "");
    const parsed = JSON.parse(cleaned) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "problem" in parsed &&
      "hypothesis" in parsed &&
      "buyers" in parsed &&
      "research_areas" in parsed &&
      Array.isArray((parsed as Record<string, unknown>).research_areas)
    ) {
      return parsed as FrameDraft;
    }
    return null;
  } catch {
    return null;
  }
}
