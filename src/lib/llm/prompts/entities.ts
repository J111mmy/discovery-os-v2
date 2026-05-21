export const ENTITY_EXTRACTION_PROMPT_VERSION = "entity-extraction-v1";

export const ENTITY_EXTRACTION_PROMPT = `
You are resolving people and companies mentioned in customer discovery evidence.

Given the evidence records below, identify every person and company mentioned.

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
  ]
}

Rules:
- Only include entities that appear in or are directly implied by the evidence text.
- Do not invent companies from generic role labels.
- Use exact names where possible.
- Only cite evidence IDs that are present in the input.

EVIDENCE RECORDS:
{evidence}
`.trim();

export function buildEntityExtractionPrompt(input: { evidence: string }) {
  return ENTITY_EXTRACTION_PROMPT.replace("{evidence}", input.evidence);
}
