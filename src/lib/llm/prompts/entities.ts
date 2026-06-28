import { NO_EM_DASH_OUTPUT_RULE } from "./style";

export const ENTITY_EXTRACTION_PROMPT_VERSION = "entity-extraction-v3";

export const ENTITY_EXTRACTION_PROMPT = `
You are resolving people, companies, and competitors mentioned in customer discovery evidence.

PROJECT FRAME:
{projectFrame}

Given the evidence records below, identify:
1. Every person mentioned by name
2. Every customer or partner company mentioned
3. Every competitor product or company mentioned, but only if it is a genuine alternative to the product, service, workflow, or solution defined in the project frame

Return only JSON in this shape:
{
  "people": [
    {
      "name": "Person name",
      "role": "Role if mentioned, otherwise null",
      "company": "Company name if mentioned, otherwise null",
      "evidence_ids": ["evidence uuid"]
    }
  ],
  "companies": [
    {
      "name": "Company name",
      "domain": "Domain if explicitly mentioned, otherwise null",
      "evidence_ids": ["evidence uuid"]
    }
  ],
  "competitors": [
    {
      "name": "Competitor product or company name",
      "slug": "lowercase-hyphenated-slug",
      "website": "Website URL if explicitly mentioned, otherwise null",
      "evidence_ids": ["evidence uuid"]
    }
  ]
}

Rules:
- ${NO_EM_DASH_OUTPUT_RULE}
- Only include entities that appear in or are directly implied by the evidence text.
- Do not invent companies from generic role labels.
- Companies are customer, prospect, partner, employer, or vendor organisations. Do not classify locations, countries, programmes, grants, events, communities, bots, automation accounts, packages, libraries, devices, generic tools, or products as companies.
- Competitors are not "any tool mentioned." A competitor must plausibly compete with the product or solution described in the project frame.
- If the project frame does not define a product, service, workflow, or solution that can have alternatives, return an empty competitors array.
- Do not mark a tool as a competitor merely because someone uses it, has installed it, watches it, contributes to it, or compares it casually. It must be positioned as an alternative, replacement, prior solution, or direct competitor for the framed product.
- Use exact names where possible; slugs must be lowercase with hyphens only.
- Only cite evidence IDs that are present in the input.

EVIDENCE RECORDS:
{evidence}
`.trim();

export function buildEntityExtractionPrompt(input: { evidence: string; projectFrame: string }) {
  return ENTITY_EXTRACTION_PROMPT
    .replace("{projectFrame}", input.projectFrame)
    .replace("{evidence}", input.evidence);
}
