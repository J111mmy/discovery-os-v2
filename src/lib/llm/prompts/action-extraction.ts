// Action extraction prompt — pulls commitments and feature requests from evidence.
//
// Two extraction targets per session:
//  1. actions        — commitments made by internal team members
//  2. product_requests — feature/product asks made by external participants
//
// Returns structured JSON to avoid hallucination of items not present.

import { NO_EM_DASH_OUTPUT_RULE } from "./style";

export const ACTION_EXTRACTION_PROMPT_VERSION = "action-extraction-v1";

export const ACTION_EXTRACTION_PROMPT = `
You are a research operations analyst reviewing notes from a customer research session.

Extract two types of items from the evidence below:

**1. ACTIONS**: explicit commitments made by internal team members (the researchers, sales reps, or product people running the session). These are things they said they would do. Examples:
- "I'll send you the demo recording"
- "Let me check with our engineering team and get back to you"
- "We'll set up a pilot for you next month"
- "I'll introduce you to our customer success team"

Only extract items where someone clearly committed to doing something. Do not extract vague intentions or "we're planning to" statements about the product.

**2. PRODUCT REQUESTS**: explicit asks or wishes from external participants (customers, prospects). These are things they said they need or wish the product could do. Examples:
- "I wish it had a bulk export feature"
- "We can't buy until it integrates with Salesforce"
- "It would be really useful if we could set user permissions by department"
- "We need an audit log for compliance reasons"

For priority_signal, infer from language strength:
- "critical": "can't buy without", "blocker", "deal-breaker", "we need this"
- "important": "really important", "high priority for us", "would definitely use"
- "nice_to_have": "would be nice", "it'd be cool if", "eventually"

Return a single JSON object with exactly two keys. If nothing is found for a category, return an empty array.

{
  "actions": [
    {
      "description": "<what the internal person committed to, in plain language>",
      "owner": "<their name or null if unknown>",
      "due_note": "<any timing hint they mentioned, e.g. 'before the demo', 'by end of week', or null>",
      "evidence_quote": "<the exact quote or close paraphrase that contains this commitment>"
    }
  ],
  "product_requests": [
    {
      "description": "<what they want, framed as a capability, in plain language>",
      "requester_name": "<their name or null if unknown>",
      "priority_signal": "nice_to_have | important | critical",
      "evidence_quote": "<the exact quote or close paraphrase that contains this request>"
    }
  ]
}

Rules:
- ${NO_EM_DASH_OUTPUT_RULE}
- Be conservative. Only extract things that are clearly commitments or requests. Do not infer.
- Do not create duplicate entries for the same commitment or request mentioned multiple times.
- Keep descriptions short and actionable (under 20 words each).
- Return only the JSON object. No markdown fences, no explanation.

SESSION TITLE: {sourceTitle}
SOURCE TYPE: {sourceType}

EVIDENCE ({evidenceCount} records):
{evidence}
`.trim();

export type ExtractedAction = {
  description: string;
  owner: string | null;
  due_note: string | null;
  evidence_quote: string;
};

export type ExtractedProductRequest = {
  description: string;
  requester_name: string | null;
  priority_signal: "nice_to_have" | "important" | "critical";
  evidence_quote: string;
};

export type ActionExtractionResult = {
  actions: ExtractedAction[];
  product_requests: ExtractedProductRequest[];
};

export function buildActionExtractionPrompt(params: {
  sourceTitle: string;
  sourceType: string;
  evidence: string;
  evidenceCount: number;
}): string {
  return ACTION_EXTRACTION_PROMPT
    .replace("{sourceTitle}", params.sourceTitle)
    .replace("{sourceType}", params.sourceType)
    .replace("{evidence}", params.evidence)
    .replace("{evidenceCount}", String(params.evidenceCount));
}

export function parseActionExtractionResult(raw: string): ActionExtractionResult | null {
  try {
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\n?/, "")
      .replace(/\n?```$/, "");
    const parsed = JSON.parse(cleaned) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "actions" in parsed &&
      "product_requests" in parsed &&
      Array.isArray((parsed as Record<string, unknown>).actions) &&
      Array.isArray((parsed as Record<string, unknown>).product_requests)
    ) {
      return parsed as ActionExtractionResult;
    }
    return null;
  } catch {
    return null;
  }
}
