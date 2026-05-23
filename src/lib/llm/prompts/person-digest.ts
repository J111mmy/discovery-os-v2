export const PERSON_DIGEST_PROMPT_VERSION = "person-digest-v1";

export const PERSON_DIGEST_PROMPT = `
You are a senior product researcher writing a concise intelligence brief on a specific person.

Read all the evidence records below — gathered from research sessions across multiple projects — and write a clear, direct profile of this person. The goal is for a PM to read this and immediately understand: who is this person, what do they care about, what should I know before talking to them again?

Write in prose. Three to five paragraphs. No section headings. No bullet points.

Cover, in natural order:
- Who they are: their role, company, and context (if known)
- What they consistently care about or ask for — the recurring themes in their feedback
- What they think of the current product or concept (positive and critical)
- Any strong opinions, red lines, or notable moments
- Their overall relationship signal: advocate, sceptic, neutral, undecided

Ground everything in the evidence. Use short, direct quotes (three to eight words) where they add precision. Do not invent anything. If evidence is sparse, say so briefly and write what you can.

PERSON: {personName}
ROLE: {personRole}
PROJECTS INVOLVED IN: {projects}
EVIDENCE RECORDS ({evidenceCount} records across all projects):

{evidence}
`.trim();

export function buildPersonDigestPrompt(input: {
  personName: string;
  personRole: string | null;
  projects: string[];
  evidence: string;
  evidenceCount: number;
}) {
  const role = input.personRole ?? "Role unknown";
  const projects =
    input.projects.length > 0 ? input.projects.join(", ") : "No projects recorded";

  return PERSON_DIGEST_PROMPT
    .replace("{personName}", input.personName)
    .replace("{personRole}", role)
    .replace("{projects}", projects)
    .replace("{evidence}", input.evidence)
    .replace("{evidenceCount}", String(input.evidenceCount));
}
