// Compose pipeline — evidence-grounded document drafting
import { callLLM, type LLMTelemetryContext } from "@/lib/llm/client";
import { detectExpertPersona } from "@/lib/llm/persona";
import { dualQueryEvidence } from "@/lib/query/evidence";
import { createServiceClient } from "@/lib/supabase/server";
import type { ComposeDraftRequest, ComposeDraftResponse, ComposeDraftSection, EvidenceRecord } from "@/types/database";

interface ProjectContext {
  name: string;
  frame: string | null;
  gtm_context: string | null;
  operating_style: string | null;
}

type ThemeSummary = { label: string; description: string | null; evidence_count: number };
type ProblemSummary = { title: string; description: string | null; severity: string };

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

async function getResearchContext(
  org_id: string,
  project_id: string
): Promise<{ themes: ThemeSummary[]; problems: ProblemSummary[] }> {
  const supabase = createServiceClient();
  const [themesResult, problemsResult] = await Promise.all([
    supabase
      .from("themes")
      .select("label, description, evidence_count")
      .eq("org_id", org_id)
      .eq("project_id", project_id)
      .order("evidence_count", { ascending: false })
      .limit(12),
    supabase
      .from("problems")
      .select("title, description, severity")
      .eq("org_id", org_id)
      .eq("project_id", project_id)
      .in("status", ["surfaced", "acknowledged", "active"])
      .order("severity", { ascending: true }) // high sorts first alphabetically
      .limit(10),
  ]);
  return {
    themes: (themesResult.data ?? []) as ThemeSummary[],
    problems: (problemsResult.data ?? []) as ProblemSummary[],
  };
}

function formatThemesBlock(themes: ThemeSummary[]): string {
  if (themes.length === 0) return "";
  const lines = themes.map((t) =>
    t.description
      ? `• ${t.label} (${t.evidence_count} records) — ${t.description}`
      : `• ${t.label} (${t.evidence_count} records)`
  );
  return `\n\nDISCOVERED THEMES:\n${lines.join("\n")}`;
}

function formatProblemsBlock(problems: ProblemSummary[]): string {
  if (problems.length === 0) return "";
  const lines = problems.map((p) => {
    const severityTag = p.severity === "high" ? "[HIGH]" : p.severity === "medium" ? "[MED]" : "[LOW]";
    return p.description
      ? `${severityTag} ${p.title} — ${p.description}`
      : `${severityTag} ${p.title}`;
  });
  return `\n\nKNOWN PROBLEMS (from research):\n${lines.join("\n")}`;
}

function buildSystemPrompt(
  persona: string,
  project: ProjectContext,
  evidenceCount: number,
  themes: ThemeSummary[],
  problems: ProblemSummary[],
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

  const themesBlock = formatThemesBlock(themes);
  if (themesBlock) parts.push(themesBlock);

  const problemsBlock = formatProblemsBlock(problems);
  if (problemsBlock) parts.push(problemsBlock);

  parts.push(`\n\nEVIDENCE-GROUNDING RULES:
- You have ${evidenceCount} evidence records below, each labelled [1], [2], [3]…
- Every factual claim, customer observation, or specific finding MUST include an inline citation in square brackets, e.g. [3] or [1][4]. Place it immediately after the relevant sentence, before the period where possible.
- If multiple records support the same point, cite all of them: [2][5].
- The DISCOVERED THEMES and KNOWN PROBLEMS above represent synthesised research — use them to orient your document structure.
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

function formatEvidenceBlock(evidence: EvidenceRecord[]): string {
  return evidence
    .map((r, i) => {
      const meta: string[] = [];
      if (r.classification) meta.push(r.classification);
      if (r.sentiment) meta.push(r.sentiment);
      if (r.source_title) meta.push(`source: ${r.source_title}`);
      if (r.segment_speaker) meta.push(`speaker: ${r.segment_speaker}`);
      const metaStr = meta.length > 0 ? ` [${meta.join(" · ")}]` : "";
      const content = r.content.slice(0, 600) + (r.content.length > 600 ? "…" : "");
      return `[${i + 1}]${metaStr}\n${content}`;
    })
    .join("\n\n");
}

// Parse [N] citation markers from composed text and build a map of N → evidence_id.
// Uses the ordered evidence array — evidence[0] = [1], evidence[1] = [2], etc.
function parseCitationMap(
  text: string,
  evidence: EvidenceRecord[]
): Record<string, string> {
  const re = /\[(\d+)\]/g;
  const map: Record<string, string> = {};
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    const n = parseInt(match[1], 10);
    const record = evidence[n - 1]; // 1-based in text, 0-based in array
    if (record && !map[String(n)]) {
      map[String(n)] = record.id;
    }
  }

  return map;
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
  req: ComposeDraftRequest,
  telemetry?: LLMTelemetryContext
): Promise<ComposeDraftResponse> {
  const { org_id, project_id, prompt, limit = 18 } = req;

  const [project, { themes, problems }, evidence] = await Promise.all([
    getProjectContext(org_id, project_id),
    getResearchContext(org_id, project_id),
    dualQueryEvidence({
      org_id,
      project_id,
      // project_name is set after project resolves — use prompt as fallback for now;
      // the parallel fetch is safe because dualQueryEvidence uses the passed name only for broad recall
      project_name: prompt,
      prompt,
      limit,
    }),
  ]);

  const persona = detectExpertPersona(prompt);
  const systemPrompt = buildSystemPrompt(persona, project, evidence.length, themes, problems);

  const evidenceBlock = formatEvidenceBlock(evidence);
  const userMessage = `${prompt}\n\n---\nEVIDENCE RECORDS:\n\n${evidenceBlock}`;

  const result = await callLLM({
    tier: "premium",
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    timeoutMs: 120_000,
    telemetry,
  });

  const { title, sections } = parseMarkdownSections(result.content);
  const citation_map = parseCitationMap(result.content, evidence);

  return {
    title,
    sections,
    evidence_ids: evidence.map((r) => r.id),
    citation_map,
    model_used: result.model,
    task_tier: "premium",
  };
}
