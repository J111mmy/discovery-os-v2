export const ENTITY_EXTRACTION_PROMPT_VERSION = "entity-extraction-v2";

export const ENTITY_EXTRACTION_PROMPT = `
You are resolving people, companies, and competitors mentioned in customer discovery evidence.

Given the evidence records below, identify:
1. Every person mentioned by name
2. Every customer or partner company mentioned
3. Every competitor product or company mentioned (products or companies that compete with or are alternatives to the product being researched)

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
- Only include entities that appear in or are directly implied by the evidence text.
- Do not invent companies from generic role labels.
- Competitors are tools, products, or companies described as alternatives, comparisons, or prior solutions.
- Use exact names where possible; slugs must be lowercase with hyphens only.
- Only cite evidence IDs that are present in the input.

EVIDENCE RECORDS:
{evidence}
`.trim();

export function buildEntityExtractionPrompt(input: { evidence: string }) {
  return ENTITY_EXTRACTION_PROMPT.replace("{evidence}", input.evidence);
}
