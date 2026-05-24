// POST /api/ask
// Retrieves semantically relevant evidence, synthesises a sourced narrative
// answer via Claude, and returns the answer + cited evidence records.
// Never exposes model names, agent internals, or pipeline mechanics to the client.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProjectForUser } from "@/lib/auth/org";
import { queryEvidence } from "@/lib/query/evidence";
import { callLLM } from "@/lib/llm/client";
import {
  ASK_PROMPT_VERSION,
  buildAskSystemPrompt,
  buildAskUserMessage,
  parseCitedIndices,
} from "@/lib/llm/prompts/ask";
import { z } from "zod";
import type { EvidenceRecord } from "@/types/database";

const AskSchema = z.object({
  project_id: z.string().uuid(),
  question: z.string().min(1).max(1000),
  trust_scope: z
    .enum(["trusted", "include_pending"])
    .optional()
    .default("include_pending"),
  limit: z.number().int().min(5).max(30).optional().default(20),
});

export interface AskResponse {
  answer: string;
  sources: EvidenceRecord[];     // only the cited records, in citation order
  all_retrieved: EvidenceRecord[]; // full retrieval set, for UI fallback
  prompt_version: string;
  record_count: number;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = AskSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { project_id, question, trust_scope, limit } = parsed.data;

  const project = await getProjectForUser<{
    id: string;
    org_id: string;
    name: string;
    frame: string | null;
    research_context: {
      goals?: string;
      outcomes?: string;
      buyers?: string;
      scope_in?: string;
      scope_out?: string;
      research_questions?: string[];
    } | null;
  }>(user.id, project_id, "id, org_id, name, frame, research_context");

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // Retrieve semantically relevant evidence
  let retrieved: EvidenceRecord[];
  try {
    const result = await queryEvidence({
      org_id: project.org_id,
      project_id,
      q: question,
      limit,
      trust_scope,
    });
    retrieved = result.records;
  } catch (err) {
    console.error("[ask] Evidence retrieval failed:", err);
    return NextResponse.json(
      { error: "Could not retrieve evidence." },
      { status: 500 }
    );
  }

  // If no evidence, return a graceful "nothing found" answer
  if (retrieved.length === 0) {
    return NextResponse.json({
      answer:
        "There isn't enough evidence in this project yet to answer that question. Try uploading more transcripts or broadening the trust filter.",
      sources: [],
      all_retrieved: [],
      prompt_version: ASK_PROMPT_VERSION,
      record_count: 0,
    } satisfies AskResponse);
  }

  // Build the research context summary for the prompt
  const researchGoals = project.research_context?.goals
    ? [
        project.research_context.goals,
        project.research_context.outcomes,
        project.research_context.buyers,
      ]
        .filter(Boolean)
        .join(". ")
    : null;

  // Call LLM — standard tier (balanced quality/cost for interactive Q&A)
  let answer: string;
  try {
    const result = await callLLM({
      tier: "standard",
      system: buildAskSystemPrompt(),
      messages: [
        {
          role: "user",
          content: buildAskUserMessage({
            question,
            projectName: project.name,
            projectFrame: project.frame,
            researchGoals,
            evidenceRecords: retrieved,
          }),
        },
      ],
      timeoutMs: 60_000,
    });
    answer = result.content.trim();
  } catch (err) {
    console.error("[ask] LLM synthesis failed:", err);
    return NextResponse.json(
      { error: "Could not synthesise an answer. Try again." },
      { status: 500 }
    );
  }

  // Map citation indices back to records (1-based in the answer, 0-based in array)
  const citedIndices = parseCitedIndices(answer, retrieved.length);
  const citedSources = citedIndices.map((i) => retrieved[i - 1]).filter(Boolean);

  return NextResponse.json({
    answer,
    sources: citedSources,
    all_retrieved: retrieved,
    prompt_version: ASK_PROMPT_VERSION,
    record_count: retrieved.length,
  } satisfies AskResponse);
}
