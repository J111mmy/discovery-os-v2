import { NO_EM_DASH_OUTPUT_RULE } from "./style";

export const SESSION_REVIEW_PROMPT_VERSION = "session-review-v2";

const SOURCE_TYPE_GUIDANCE: Record<string, string> = {
  "customer interview": `This is a discovery interview. Prioritise the participant's context, goals, current workflow, unmet needs, pain points, workarounds, and decision criteria. Include product or concept reactions only if the evidence shows that a specific product, prototype, concept, feature, or proposed solution was shown or described during the session.`,
  usability: `This is a usability or validation session. Prioritise the task attempted, observed behaviour, what worked, where the participant struggled, expectations, reactions to the tested experience, and the practical severity of each issue.`,
  "usability study": `This is a usability or validation session. Prioritise the task attempted, observed behaviour, what worked, where the participant struggled, expectations, reactions to the tested experience, and the practical severity of each issue.`,
  "sales call": `This is a sales conversation. Prioritise business context, desired outcomes, current alternatives, buying triggers, objections, decision process, stakeholders, and agreed next steps. Include product reactions only when a demo, product, or proposed solution was actually discussed.`,
  "internal meeting": `This is an internal meeting. Prioritise decisions, rationale, disagreements, risks, open questions, commitments, owners, and dependencies. Do not describe internal colleagues as customers or participants, and do not manufacture customer findings.`,
  "support ticket": `This is a support interaction. Prioritise the reported issue, user impact, conditions or reproduction context, attempted workarounds, resolution status, and follow-up required.`,
  survey: `This is survey material. Prioritise the clearest response patterns, distinct needs or objections, meaningful outliers, and representative quotes. Do not imply that the source is a moderated interview.`,
  transcript: `The source type is generic. Infer the session mode from the evidence, then choose only headings that fit that mode. Do not assume a product, prototype, or concept was shown.`,
  document: `This is a document rather than a live session. Summarise its purpose, substantive findings, decisions or recommendations, risks, and follow-up only where the evidence supports them. Do not invent a participant or session dynamic.`,
  note: `This is a note rather than a full transcript. Keep the brief proportionate to the available evidence and include only grounded findings, decisions, risks, or follow-up.`,
  web: `This is web material rather than a live session. Summarise the relevant claims, positioning, evidence, risks, and implications without inventing a participant or session dynamic.`,
  slack: `This is a written conversation. Prioritise the issue or decision under discussion, viewpoints, agreements, unresolved questions, and commitments. Do not imply that it was a formal interview.`,
  monitoring: `This is monitoring evidence. Prioritise the observed signal, affected workflow or audience, severity, recurrence, and required investigation or action. Do not invent participant intent.`,
};

function guidanceForSourceType(sourceType: string): string {
  return (
    SOURCE_TYPE_GUIDANCE[sourceType.trim().toLowerCase()] ??
    `Use the source type and evidence to choose an appropriate brief shape. Do not assume this was a validation interview or that a product, prototype, or concept was shown.`
  );
}

export const SESSION_REVIEW_PROMPT = `
You are a senior product researcher writing a post-session brief.

Read the evidence records below from one source and write a structured narrative brief. This brief is for a human reader: a PM, researcher, or exec who wants to understand the source without reading the full material.

Write in clear, direct prose. Do not use bullet points unless grouping brief examples. Avoid filler phrases like "it's worth noting" or "the participant mentioned." Attribute quotes to the speaker by name if known, otherwise "the participant." ${NO_EM_DASH_OUTPUT_RULE}

## Adaptive structure rules

- Do not use a fixed template. Choose the brief's sections from the source type and the evidence actually present.
- Always begin with a "## Summary" heading followed by two to four sentences covering the source's purpose, relevant people or context, overall tone, and strongest signal.
- After Summary, include up to five sections that add grounded information. A useful section might cover goals and desired outcomes, current workflow, pain points, workarounds, observed behaviour, objections, decisions, open questions, notable quotes, or follow-up.
- Every included section must contain substantive evidence. If a section has no direct support, omit the heading entirely.
- Never pad a missing section with absence language such as "No product was shown," "No concerns were voiced," "No decision was made," or similar disclaimers. The correct representation of absent evidence is no section.
- A product or concept reaction section is allowed only when the evidence shows that a specific product, prototype, concept, feature, demo, design, or proposed solution was shown or described and the person reacted to it. Discussion of the participant's existing tools or current workflow does not qualify.
- Include a "## Notable quotes" section only when there are two to five distinctive, citable quotes. Format those quotes as blockquotes and reproduce their words faithfully.
- Include a "## Suggested follow-up" section only when the evidence contains a commitment, unanswered question, decision implication, or concrete next step. Do not invent follow-up to complete the brief.
- Use concise, descriptive "##" headings that match the content. Do not output empty headings, generic placeholders, or meta-commentary about omitted material.

## Source-specific guidance

{sourceGuidance}

---

SOURCE TITLE: {sourceTitle}
SOURCE TYPE: {sourceType}

EVIDENCE RECORDS ({evidenceCount} records):
{evidence}
`.trim();

export function buildSessionReviewPrompt(input: {
  sourceTitle: string;
  sourceType: string;
  evidence: string;
  evidenceCount: number;
}) {
  return SESSION_REVIEW_PROMPT
    .replace("{sourceGuidance}", guidanceForSourceType(input.sourceType))
    .replace("{sourceTitle}", input.sourceTitle)
    .replace("{sourceType}", input.sourceType)
    .replace("{evidence}", input.evidence)
    .replace("{evidenceCount}", String(input.evidenceCount));
}
