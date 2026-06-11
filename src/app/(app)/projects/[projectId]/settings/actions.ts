"use server";

import { accessRedirectPath, requireActiveAccess } from "@/lib/auth/access";
import { getProjectForUser } from "@/lib/auth/org";
import { callLLM } from "@/lib/llm/client";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

type EvidenceContext = {
  content: string;
  summary: string | null;
};

type ThemeContext = {
  label: string;
  description: string | null;
};

type ProblemContext = {
  title: string;
};

type TrustScopeContext = "trusted" | "pending";

type EvidenceSettingsContext = EvidenceContext & {
  trust_scope: TrustScopeContext;
  classification: string | null;
  sentiment: string | null;
};

type EntityContext = {
  label: string;
  entity_type: string;
};

const SuggestedSettingsSchema = z.object({
  research_context: z.object({
    goals: z.string().default(""),
    outcomes: z.string().default(""),
    buyers: z.string().default(""),
    scope_in: z.string().default(""),
    scope_out: z.string().default(""),
    research_questions: z.array(z.string()).default([]),
  }),
  frame: z.string().default(""),
  operating_style: z.string().default(""),
  gtm_context: z.string().default(""),
});

export type SuggestedProjectSettings = z.infer<typeof SuggestedSettingsSchema>;

function formatEvidence(evidence: EvidenceContext[]) {
  if (evidence.length === 0) return "No trusted evidence yet.";

  return evidence
    .map((record, index) => {
      const lines = [`${index + 1}. ${record.content.slice(0, 900)}`];
      if (record.summary) lines.push(`Summary: ${record.summary}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

function formatThemes(themes: ThemeContext[]) {
  if (themes.length === 0) return "No themes discovered yet.";

  return themes
    .map((theme) =>
      theme.description ? `- ${theme.label}: ${theme.description}` : `- ${theme.label}`
    )
    .join("\n");
}

function formatProblems(problems: ProblemContext[]) {
  if (problems.length === 0) return "No problems discovered yet.";
  return problems.map((problem) => `- ${problem.title}`).join("\n");
}

function extractJsonObject(content: string) {
  const unfenced = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Settings suggestion did not return JSON.");
  }
  return JSON.parse(unfenced.slice(start, end + 1)) as unknown;
}

function formatEvidenceForSettings(evidence: EvidenceSettingsContext[]) {
  if (evidence.length === 0) return "No evidence records are available yet.";

  return evidence
    .map((record, index) => {
      const meta = [record.trust_scope, record.classification, record.sentiment].filter(Boolean);
      const lines = [`${index + 1}. [${meta.join(" / ")}] ${record.content.slice(0, 900)}`];
      if (record.summary) lines.push(`Summary: ${record.summary}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

function formatEntities(entities: EntityContext[]) {
  if (entities.length === 0) return "No people, companies, or competitors have been resolved yet.";

  const unique = Array.from(
    new Map(
      entities
        .filter((entity) => entity.label?.trim())
        .map((entity) => [`${entity.entity_type}:${entity.label.toLowerCase()}`, entity])
    ).values()
  ).slice(0, 25);

  return unique.map((entity) => `- ${entity.entity_type}: ${entity.label}`).join("\n");
}

function buildSettingsSuggestionPrompt(input: {
  projectName: string;
  existing: {
    frame: string | null;
    operating_style: string | null;
    gtm_context: string | null;
    research_context: Record<string, unknown> | null;
  };
  evidence: EvidenceSettingsContext[];
  themes: ThemeContext[];
  problems: ProblemContext[];
  entities: EntityContext[];
}) {
  return `
Draft editable project settings for the "${input.projectName}" discovery project.

Use the evidence and synthesis below. Trusted evidence is stronger than pending evidence. Pending evidence can be used for provisional suggestions, but do not overstate confidence. Do not invent customer facts, buyers, market claims, or outcomes. If the evidence is thin, write the settings as exploratory.

Return only valid JSON with this exact shape:
{
  "research_context": {
    "goals": "1-2 sentences on what the project is trying to learn",
    "outcomes": "1 sentence on the decision this research should inform",
    "buyers": "comma-separated buyer/user personas",
    "scope_in": "comma-separated areas in scope",
    "scope_out": "comma-separated areas out of scope or unknown",
    "research_questions": ["3-6 questions the team should answer"]
  },
  "frame": "Plain text with headings: Problem, Hypothesis, Buyers, Research Areas, Success Metrics",
  "operating_style": "Short instructions for how generated documents should sound and behave",
  "gtm_context": "Concise GTM background: market/customer segment, buying context, competitive or workflow context, and evidence caveats"
}

EXISTING SETTINGS:
${JSON.stringify(input.existing, null, 2)}

EVIDENCE:
${formatEvidenceForSettings(input.evidence)}

THEMES:
${formatThemes(input.themes)}

PROBLEMS:
${formatProblems(input.problems)}

PEOPLE, COMPANIES, AND COMPETITORS MENTIONED:
${formatEntities(input.entities)}
`.trim();
}

function buildFramePrompt(input: {
  projectName: string;
  evidence: EvidenceContext[];
  themes: ThemeContext[];
  problems: ProblemContext[];
}) {
  return `
Draft a concise project frame for the "${input.projectName}" discovery project.

Use the trusted evidence, themes, and known problems below. Do not invent customer facts. If the evidence is thin, write a frame that is explicitly exploratory.

Return plain text only with these exact section headings:

Problem
One sentence.

Hypothesis
One sentence.

Buyers
Comma-separated buyer or user personas.

Research Areas
- 3 to 5 bullet points as plain text.

Success Metrics
- 2 to 3 bullet points as plain text.

TRUSTED EVIDENCE:
${formatEvidence(input.evidence)}

THEMES:
${formatThemes(input.themes)}

PROBLEMS:
${formatProblems(input.problems)}
`.trim();
}

export async function generateFrameAction(formData: FormData): Promise<string> {
  const projectId = String(formData.get("project_id") ?? "");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  const access = await requireActiveAccess({ id: user.id, email: user.email });
  if (!access.ok) redirect(accessRedirectPath(access.status));
  if (!projectId) throw new Error("Missing project.");

  const project = await getProjectForUser<{ id: string; org_id: string; name: string }>(
    user.id,
    projectId,
    "id, org_id, name"
  );

  if (!project) throw new Error("Project not found.");

  const [evidenceResult, themesResult, problemsResult] = await Promise.all([
    supabase
      .from("evidence")
      .select("content, summary")
      .eq("org_id", project.org_id)
      .eq("project_id", project.id)
      .eq("trust_scope", "trusted")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("themes")
      .select("label, description")
      .eq("org_id", project.org_id)
      .eq("project_id", project.id)
      .order("evidence_count", { ascending: false })
      .limit(10),
    supabase
      .from("problems")
      .select("title")
      .eq("org_id", project.org_id)
      .eq("project_id", project.id)
      .in("status", ["surfaced", "acknowledged", "active"])
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  if (evidenceResult.error) {
    throw new Error(`Could not load trusted evidence: ${evidenceResult.error.message}`);
  }
  if (themesResult.error) {
    throw new Error(`Could not load themes: ${themesResult.error.message}`);
  }
  if (problemsResult.error) {
    throw new Error(`Could not load problems: ${problemsResult.error.message}`);
  }

  const result = await callLLM({
    tier: "standard",
    system:
      "You draft concise, editable product discovery project frames from trusted research context.",
    messages: [
      {
        role: "user",
        content: buildFramePrompt({
          projectName: project.name,
          evidence: (evidenceResult.data ?? []) as EvidenceContext[],
          themes: (themesResult.data ?? []) as ThemeContext[],
          problems: (problemsResult.data ?? []) as ProblemContext[],
        }),
      },
    ],
    timeoutMs: 120_000,
  });

  const frame = result.content.trim();
  if (!frame) throw new Error("Frame generation returned no text.");

  const { error } = await supabase
    .from("projects")
    .update({ frame })
    .eq("org_id", project.org_id)
    .eq("id", project.id);

  if (error) throw new Error(`Could not save generated frame: ${error.message}`);

  revalidatePath(`/projects/${project.id}/settings`);
  revalidatePath(`/projects/${project.id}`);

  return frame;
}

export async function suggestProjectSettingsAction(
  formData: FormData
): Promise<SuggestedProjectSettings> {
  const projectId = String(formData.get("project_id") ?? "");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  const access = await requireActiveAccess({ id: user.id, email: user.email });
  if (!access.ok) redirect(accessRedirectPath(access.status));
  if (!projectId) throw new Error("Missing project.");

  const project = await getProjectForUser<{
    id: string;
    org_id: string;
    name: string;
    frame: string | null;
    research_context: Record<string, unknown> | null;
    operating_style: string | null;
    gtm_context: string | null;
  }>(
    user.id,
    projectId,
    "id, org_id, name, frame, research_context, operating_style, gtm_context"
  );

  if (!project) throw new Error("Project not found.");

  const [evidenceResult, themesResult, problemsResult, entitiesResult] = await Promise.all([
    supabase
      .from("evidence")
      .select("content, summary, trust_scope, classification, sentiment")
      .eq("org_id", project.org_id)
      .eq("project_id", project.id)
      .in("trust_scope", ["trusted", "pending"])
      .order("created_at", { ascending: false })
      .limit(40),
    supabase
      .from("themes")
      .select("label, description")
      .eq("org_id", project.org_id)
      .eq("project_id", project.id)
      .order("evidence_count", { ascending: false })
      .limit(12),
    supabase
      .from("problems")
      .select("title")
      .eq("org_id", project.org_id)
      .eq("project_id", project.id)
      .in("status", ["surfaced", "acknowledged", "active"])
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("evidence_entities")
      .select("label, entity_type")
      .eq("org_id", project.org_id)
      .eq("project_id", project.id)
      .in("entity_type", ["person", "company", "competitor"])
      .limit(50),
  ]);

  if (evidenceResult.error) {
    throw new Error(`Could not load evidence: ${evidenceResult.error.message}`);
  }
  if (themesResult.error) {
    throw new Error(`Could not load themes: ${themesResult.error.message}`);
  }
  if (problemsResult.error) {
    throw new Error(`Could not load problems: ${problemsResult.error.message}`);
  }
  if (entitiesResult.error) {
    throw new Error(`Could not load entities: ${entitiesResult.error.message}`);
  }

  const evidence = (evidenceResult.data ?? []) as EvidenceSettingsContext[];
  if (evidence.length === 0) {
    throw new Error("Add evidence before asking AI to suggest project settings.");
  }

  const result = await callLLM({
    tier: "standard",
    system:
      "You draft concise, editable product discovery project settings from evidence. You are careful about uncertainty and never invent unsupported customer facts.",
    messages: [
      {
        role: "user",
        content: buildSettingsSuggestionPrompt({
          projectName: project.name,
          existing: {
            frame: project.frame,
            research_context: project.research_context,
            operating_style: project.operating_style,
            gtm_context: project.gtm_context,
          },
          evidence,
          themes: (themesResult.data ?? []) as ThemeContext[],
          problems: (problemsResult.data ?? []) as ProblemContext[],
          entities: (entitiesResult.data ?? []) as EntityContext[],
        }),
      },
    ],
    timeoutMs: 120_000,
  });

  const parsed = SuggestedSettingsSchema.safeParse(extractJsonObject(result.content));
  if (!parsed.success) {
    throw new Error("Settings suggestion returned an unexpected shape.");
  }

  return {
    research_context: {
      goals: parsed.data.research_context.goals.trim(),
      outcomes: parsed.data.research_context.outcomes.trim(),
      buyers: parsed.data.research_context.buyers.trim(),
      scope_in: parsed.data.research_context.scope_in.trim(),
      scope_out: parsed.data.research_context.scope_out.trim(),
      research_questions: parsed.data.research_context.research_questions
        .map((question) => question.trim())
        .filter(Boolean)
        .slice(0, 6),
    },
    frame: parsed.data.frame.trim(),
    operating_style: parsed.data.operating_style.trim(),
    gtm_context: parsed.data.gtm_context.trim(),
  };
}
