"use server";

import { getProjectForUser } from "@/lib/auth/org";
import { callLLM } from "@/lib/llm/client";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

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
