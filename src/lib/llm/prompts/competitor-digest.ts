// Competitor digest prompt — synthesises intelligence on a competitor
// from all evidence mentioning them across every project in the org.
//
// Returns a JSON object with:
//   digest         — 3–5 paragraph prose narrative
//   positioning    — their stated pitch / how they position themselves
//   known_strengths — where they win and why (for the battle card)
//   known_gaps     — documented weaknesses customers have mentioned
//   battle_card    — structured 5-field battle card (3 AI-filled, 2 left for user)

export const COMPETITOR_DIGEST_PROMPT_VERSION = "competitor-digest-v1";

export const COMPETITOR_DIGEST_PROMPT = `
You are a competitive intelligence analyst synthesising everything a product team has heard about a competitor from customer interviews, sales calls, and research sessions.

Your job is to turn raw customer evidence into structured competitive intelligence. Be specific and evidence-driven. Do not use general market knowledge — base everything on what was actually said in the evidence below.

Return a single JSON object with exactly these keys:

{
  "digest": "<3–5 paragraphs of prose. Weave together: who this competitor is as seen through customer eyes, what they do well, where they fall short, which customers use or have used them and why, and what the overall competitive signal suggests. Write in a tone suitable for a PM preparing for a competitive deal. No headings, no bullets.>",

  "positioning": "<1–2 sentences: how this competitor positions themselves, as understood from what customers said about them. Not what their website says — what customers believe they stand for.>",

  "known_strengths": "<2–4 sentences: where they consistently win according to customers. What do customers cite as reasons they chose or considered this competitor? What do they do better than us?>",

  "known_gaps": "<2–4 sentences: where they fall short according to customers. What frustrations, limitations, or objections did customers mention? What are the openings for us?>",

  "battle_card": {
    "their_pitch": "<their core value proposition in 10 words or fewer, as customers understand it>",
    "where_they_win": "<the single strongest thing they have — a capability, relationship, or position that is hardest to beat>",
    "their_gap": "<the single most actionable weakness — the one gap that most often opens a door for us>",
    "your_counter": null,
    "one_proof_point": null
  }
}

Rules:
- Base everything on the evidence. Do not invent facts.
- If the evidence is thin on a particular field, write "Limited evidence — [what was said]" rather than fabricating.
- your_counter and one_proof_point must always be null — those are for the user to fill in.
- Return only the JSON object. No markdown fences, no preamble.

COMPETITOR: {competitorName}
{websiteLine}

EVIDENCE ({evidenceCount} records across {projectCount} project(s)):
{evidence}
`.trim();

export type BattleCard = {
  their_pitch: string;
  where_they_win: string;
  their_gap: string;
  your_counter: string | null;
  one_proof_point: string | null;
};

export type CompetitorDigestResult = {
  digest: string;
  positioning: string;
  known_strengths: string;
  known_gaps: string;
  battle_card: BattleCard;
};

export function buildCompetitorDigestPrompt(params: {
  competitorName: string;
  website: string | null;
  evidence: string;
  evidenceCount: number;
  projectCount: number;
}): string {
  return COMPETITOR_DIGEST_PROMPT
    .replace("{competitorName}", params.competitorName)
    .replace("{websiteLine}", params.website ? `WEBSITE: ${params.website}` : "")
    .replace("{evidence}", params.evidence)
    .replace("{evidenceCount}", String(params.evidenceCount))
    .replace("{projectCount}", String(params.projectCount));
}

export function parseCompetitorDigestResult(raw: string): CompetitorDigestResult | null {
  try {
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\n?/, "")
      .replace(/\n?```$/, "");
    const parsed = JSON.parse(cleaned) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "digest" in parsed &&
      "positioning" in parsed &&
      "known_strengths" in parsed &&
      "known_gaps" in parsed &&
      "battle_card" in parsed
    ) {
      return parsed as CompetitorDigestResult;
    }
    return null;
  } catch {
    return null;
  }
}
