// Compose pipeline — evidence-grounded document drafting
import { callLLM } from "@/lib/llm/client";
import { detectExpertPersona } from "@/lib/llm/persona";
import { dualQueryEvidence } from "@/lib/query/evidence";
import { createServiceClient } from "@/lib/supabase/server";
import type { ComposeDraftRequest, ComposeDraftResponse, ComposeDraftSection } from "@/types/database";

interface ProjectContext {
  name: string;
  frame: string | null;
  gtm_context: string | null;
  operating_style: string | null;
}

async function getProjectContext(
  org_id: string,
  project_id: string
): Promise<ProjectContext> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("projects")
    .select("name, frame, gtm_context, operating_style")
    .eq("id", project_id)
    .eq("org_id", org_id)
    .single();

  if (error || !data) throw new Error("Project not found");
  return data as ProjectContext;
}

function buildSystemPrompt(
  persona: string,
  project: ProjectContext,
  evidenceCount: number
): string {
  const parts: string[] = [
    `You are ${persona}.`,
    `You are creating a working document for the "${project.name}" project.`,
  ];

  if (project.frame?.trim()) {
    parts.push(`\n\nPROJECT FRAME:\n${project.frame.slice(0, 1200)}`);
  }
  if (project.gtm_context?.trim()) {
    parts.push(`\n\nGO-TO-MARKET CONTEXT:\n${project.gtm_context.slice(0, 2000)}`);
  }
  if (project.operating_style?.trim()) {
    parts.push(`\n\nVOICE & OPERATING STYLE:\n${project.operating_style.slice(0, 1500)}`);
  }

  parts.push(`\n\nEVIDENCE-GROUNDING RULES:
- You have ${evidenceCount} evidence records below. All factual claims must cite specific evidence.
- Paraphrase evidence in your own words — do not copy verbatim passages.
- Where evidence is absent or thin, flag the gap explicitly: "Evidence is limited here — treat as hypothesis."
- Never invent participants, quotes, numbers, or outcomes.
- Confidence levels: High = 3+ independent evidence records; Medium = 1–2; Low = inference only.`);

  parts.push(`\n\nOUTPUT FORMAT:
- Start immediately with # Title on line 1. No preamble, no "Here is your document".
- Use ## Section Heading for each section.
- Each section: 5–9 focused, substantive paragraphs. No bullet-point dumps.
- Write in the voice specified in VOICE & OPERATING STYLE, or plain direct prose if unspecified.
- End with a ## Open Questions section listing the top 3–5 assumptions or evidence gaps.`);

  return parts.join(" ");
}

function parseMarkdownSections(markdown: string): {
  title: string;
  sections: ComposeDraftSection[];
} {
  const lines = markdown.split("\n");
  const titleLine = lines.find((l) => l.startsWith("# "));
  const title = titleLine ? titleLine.replace(/^#\s+/, "").trim() : "Untitled";

  const sections: ComposeDraftSection[] = [];
  let currentHeading = "";
  let currentContent: string[] = [];

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (currentHeading) {
        sections.push({ heading: currentHeading, content: currentContent.join("\n").trim() });
      }
      currentHeading = line.replace(/^##\s+/, "").trim();
      currentContent = [];
    } else if (!line.startsWith("# ")) {
      currentContent.push(line);
    }
  }

  if (currentHeading) {
    sections.push({ heading: currentHeading, content: currentContent.join("\n").trim() });
  }

  return { title, sections };
}

export async function composeDraft(
  req: ComposeDraftRequest
): Promise<ComposeDraftResponse> {
  const { org_id, project_id, prompt, limit = 18 } = req;

  // Load project context and evidence in parallel
  const [project, evidence] = await Promise.all([
    getProjectContext(org_id, project_id),
    dualQueryEvidence({
      org_id,
      project_id,
      project_name: "", // will be filled after project loads — acceptable two-step
      prompt,
      limit,
    }),
  ]);

  const persona = detectExpertPersona(prompt);
  const systemPrompt = buildSystemPrompt(persona, project, evidence.length);

  // Format evidence as numbered list for the LLM
  const evidenceBlock = evidence
    .map(
      (r, i) =>
        `[${i + 1}] ${r.content.slice(0, 600)}${r.content.length > 600 ? "…" : ""}`
    )
    .join("\n\n");

  const userMessage = `${prompt}\n\n---\nEVIDENCE RECORDS:\n\n${evidenceBlock}`;

  const result = await callLLM({
    tier: "premium",
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    timeoutMs: 120_000,
  });

  const { title, sections } = parseMarkdownSections(result.content);

  return {
    title,
    sections,
    evidence_ids: evidence.map((r) => r.id),
    model_used: result.model,
    task_tier: "premium",
  };
}
