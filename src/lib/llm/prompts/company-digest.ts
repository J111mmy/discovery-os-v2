// Company digest prompt — synthesises a narrative profile for a company
// from all evidence linked to it across every project in the org.
// Output is 3–5 paragraphs of prose: who they are, what they consistently
// want, their relationship signal, and cross-project themes.

import { NO_EM_DASH_OUTPUT_RULE } from "./style";

export const COMPANY_DIGEST_PROMPT_VERSION = "company-digest-v1";

export const COMPANY_DIGEST_PROMPT = `
You are a senior research analyst writing an intelligence brief about a company from the perspective of a product team doing customer discovery.

You have been given all the evidence we have gathered from people at this company across all our research projects. Write a 3–5 paragraph prose brief. No headings. No bullets. Return only the prose.

Cover these areas. Weave them naturally, do not label them:
1. **Who they are**: what kind of company, their role in the market, size signals if available, what problems they're trying to solve internally
2. **What they consistently want**: recurring themes across all people from this company: jobs-to-be-done, frustrations, aspirations
3. **How they react to products like ours**: praise, scepticism, confusion, enthusiasm, specific objections raised
4. **Cross-project signal**: if they appear in multiple research projects, what does that pattern tell us about their strategic priorities?
5. **Relationship signal**: overall sentiment toward us, readiness to buy or pilot, any red flags or strong buying signals

Style rule: ${NO_EM_DASH_OUTPUT_RULE}

Be specific. Reference what was actually said, not generic market knowledge. If evidence is thin, say so briefly and note what questions remain unanswered. Write in a tone suitable for a product team reading before a sales call.

COMPANY: {companyName}
{domainLine}
{industryLine}
PEOPLE FROM THIS COMPANY IN OUR RESEARCH:
{people}

EVIDENCE ({evidenceCount} records across {projectCount} project(s)):
{evidence}
`.trim();

export function buildCompanyDigestPrompt(params: {
  companyName: string;
  domain: string | null;
  industry: string | null;
  people: string;
  evidence: string;
  evidenceCount: number;
  projectCount: number;
}): string {
  return COMPANY_DIGEST_PROMPT
    .replace("{companyName}", params.companyName)
    .replace("{domainLine}", params.domain ? `DOMAIN: ${params.domain}` : "")
    .replace("{industryLine}", params.industry ? `INDUSTRY: ${params.industry}` : "")
    .replace("{people}", params.people)
    .replace("{evidence}", params.evidence)
    .replace("{evidenceCount}", String(params.evidenceCount))
    .replace("{projectCount}", String(params.projectCount));
}
