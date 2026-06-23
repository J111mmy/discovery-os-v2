// POST /api/ask
// Retrieves semantically relevant evidence, synthesises a sourced narrative
// answer via Claude, and returns the answer + cited evidence records.
// Never exposes model names, agent internals, or pipeline mechanics to the client.

import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireActiveAccess } from "@/lib/auth/access";
import { getProjectForUser } from "@/lib/auth/org";
import { queryEvidence } from "@/lib/query/evidence";
import { streamLLM } from "@/lib/llm/client";
import {
  ASK_PROMPT_VERSION,
  buildAskSystemPrompt,
  buildAskUserMessage,
  parseCitedIndices,
} from "@/lib/llm/prompts/ask";
import {
  resolveSpeakerTargetsForQuestion,
  speakerResolutionLabel,
} from "@/lib/speakers/resolve";
import {
  detectAskStructuralIntent,
  loadAskStructuralContext,
  loadAskStructuralLinkedEvidence,
  shouldLoadLinkedEvidenceForStructuralIntent,
  type AskStructuralContext,
} from "@/lib/ask/structural-context";
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

type AskStreamEvent =
  | { type: "delta"; text: string }
  | {
      type: "done";
      sources: EvidenceRecord[];
      all_retrieved: EvidenceRecord[];
      prompt_version: string;
      record_count: number;
    };

const encoder = new TextEncoder();

function encodeStreamEvent(event: AskStreamEvent) {
  return encoder.encode(`${JSON.stringify(event)}\n`);
}

async function startAskAgentRun(input: {
  orgId: string;
  projectId: string;
  question: string;
  trustScope: string;
  limit: number;
}) {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("agent_runs")
      .insert({
        org_id: input.orgId,
        project_id: input.projectId,
        agent_type: "ask-answer",
        input: {
          prompt_version: ASK_PROMPT_VERSION,
          question_length: input.question.length,
          trust_scope: input.trustScope,
          limit: input.limit,
        },
      })
      .select("id")
      .single();

    if (error || !data) {
      console.error("[ask] failed to start agent run", error?.message);
      return null;
    }

    return data.id as string;
  } catch (error) {
    console.error("[ask] failed to start agent run", error);
    return null;
  }
}

async function completeAskAgentRun(input: {
  orgId: string;
  agentRunId: string | null;
  modelUsed: string;
  output: Record<string, unknown>;
}) {
  if (!input.agentRunId) return;

  try {
    const supabase = createServiceClient();
    const { error } = await supabase
      .from("agent_runs")
      .update({
        status: "completed",
        model_used: input.modelUsed,
        output: input.output,
        completed_at: new Date().toISOString(),
      })
      .eq("org_id", input.orgId)
      .eq("id", input.agentRunId);

    if (error) {
      console.error("[ask] failed to complete agent run", error.message);
    }
  } catch (error) {
    console.error("[ask] failed to complete agent run", error);
  }
}

async function failAskAgentRun(input: {
  orgId: string;
  agentRunId: string | null;
  error: unknown;
}) {
  if (!input.agentRunId) return;

  try {
    const message = input.error instanceof Error ? input.error.message : String(input.error);
    const supabase = createServiceClient();
    const { error } = await supabase
      .from("agent_runs")
      .update({
        status: "failed",
        error: message,
        completed_at: new Date().toISOString(),
      })
      .eq("org_id", input.orgId)
      .eq("id", input.agentRunId);

    if (error) {
      console.error("[ask] failed to mark agent run failed", error.message);
    }
  } catch (error) {
    console.error("[ask] failed to mark agent run failed", error);
  }
}

function mergeEvidenceRecords(...groups: EvidenceRecord[][]) {
  const seen = new Set<string>();
  const merged: EvidenceRecord[] = [];

  for (const group of groups) {
    for (const record of group) {
      if (!record.id || seen.has(record.id)) continue;
      seen.add(record.id);
      merged.push(record);
    }
  }

  return merged;
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

  const access = await requireActiveAccess({ id: user.id, email: user.email });
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error, access_status: access.status },
      { status: 403 }
    );
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

  const structuralIntent = detectAskStructuralIntent(question);
  const shouldRetrieveSemanticEvidence =
    !structuralIntent || structuralIntent.needsEvidence;
  const shouldRetrieveLinkedStructuralEvidence =
    shouldLoadLinkedEvidenceForStructuralIntent(structuralIntent);

  let structuralContext: AskStructuralContext | null = null;
  let linkedStructuralEvidence: EvidenceRecord[] = [];
  let speakerResolution: Awaited<
    ReturnType<typeof resolveSpeakerTargetsForQuestion>
  > | null = null;

  try {
    const [resolvedSpeaker, resolvedStructuralContext, resolvedLinkedStructuralEvidence] =
      await Promise.all([
        shouldRetrieveSemanticEvidence
          ? resolveSpeakerTargetsForQuestion({
              supabase,
              org_id: project.org_id,
              project_id,
              question,
            })
          : Promise.resolve(null),
        structuralIntent
          ? loadAskStructuralContext({
              supabase,
              org_id: project.org_id,
              project_id,
              intent: structuralIntent,
            })
          : Promise.resolve(null),
        shouldRetrieveLinkedStructuralEvidence && structuralIntent
          ? loadAskStructuralLinkedEvidence({
              supabase,
              org_id: project.org_id,
              project_id,
              intent: structuralIntent,
              trust_scope,
              limit,
            })
          : Promise.resolve([]),
      ]);

    speakerResolution = resolvedSpeaker;
    structuralContext = resolvedStructuralContext;
    linkedStructuralEvidence = resolvedLinkedStructuralEvidence;
  } catch (err) {
    console.error("[ask] Structural context retrieval failed:", err);
    return NextResponse.json(
      { error: "Could not retrieve project context." },
      { status: 500 }
    );
  }

  // Retrieve semantically relevant evidence, narrowed to the named speaker
  // when the question asks what a person said, wanted, felt, or required.
  let retrieved: EvidenceRecord[] = [];
  try {
    let semanticEvidence: EvidenceRecord[] = [];
    if (shouldRetrieveSemanticEvidence) {
      const result = await queryEvidence({
        org_id: project.org_id,
        project_id,
        q: question,
        limit,
        trust_scope,
        speaker_resolution: speakerResolution,
      });
      semanticEvidence = result.records;
    }
    retrieved = mergeEvidenceRecords(linkedStructuralEvidence, semanticEvidence).slice(0, limit);
  } catch (err) {
    console.error("[ask] Evidence retrieval failed:", err);
    return NextResponse.json(
      { error: "Could not retrieve evidence." },
      { status: 500 }
    );
  }

  // If no evidence, return a graceful "nothing found" answer
  if (retrieved.length === 0 && !structuralContext?.hasData) {
    const speakerFocus = speakerResolutionLabel(speakerResolution);
    if (speakerFocus) {
      return NextResponse.json({
        answer: `I couldn't find enough evidence where ${speakerFocus} is the speaker to answer that safely. There may be related evidence in the project, but I won't attribute another speaker's words to ${speakerFocus}.`,
        sources: [],
        all_retrieved: [],
        prompt_version: ASK_PROMPT_VERSION,
        record_count: 0,
      } satisfies AskResponse);
    }

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

  const agentRunId = await startAskAgentRun({
    orgId: project.org_id,
    projectId: project.id,
    question,
    trustScope: trust_scope,
    limit,
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // Call LLM — standard tier (balanced quality/cost for interactive Q&A)
        const result = await streamLLM(
          {
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
                  speakerResolution,
                  structuralContext: structuralContext?.text ?? null,
                }),
              },
            ],
            timeoutMs: 60_000,
            telemetry: {
              orgId: project.org_id,
              projectId: project.id,
              agentRunId,
              agentType: "ask-answer",
              step: "stream-answer",
            },
          },
          (delta) => {
            controller.enqueue(
              encodeStreamEvent({ type: "delta", text: delta })
            );
          }
        );

        const answer = result.content.trim();
        // Map citation indices back to records (1-based in the answer, 0-based in array)
        const citedIndices = parseCitedIndices(answer, retrieved.length);
        const citedSources = citedIndices
          .map((i) => retrieved[i - 1])
          .filter(Boolean);

        await completeAskAgentRun({
          orgId: project.org_id,
          agentRunId,
          modelUsed: result.model,
          output: {
            answer_length: answer.length,
            cited_source_count: citedSources.length,
            retrieved_count: retrieved.length,
          },
        });

        controller.enqueue(
          encodeStreamEvent({
            type: "done",
            sources: citedSources,
            all_retrieved: retrieved,
            prompt_version: ASK_PROMPT_VERSION,
            record_count: retrieved.length,
          })
        );
        controller.close();
      } catch (err) {
        console.error("[ask] LLM synthesis failed:", err);
        await failAskAgentRun({
          orgId: project.org_id,
          agentRunId,
          error: err,
        });
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
