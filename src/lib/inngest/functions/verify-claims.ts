// Claim verification — checks artifact claims against trusted evidence.

import { z } from "zod";
import { inngest } from "../client";
import { createServiceClient } from "@/lib/supabase/server";
import { callLLM } from "@/lib/llm/client";
import {
  buildClaimVerificationPrompt,
  CLAIM_VERIFICATION_PROMPT_VERSION,
} from "@/lib/llm/prompts/verify";

type ArtifactRow = {
  id: string;
  org_id: string;
  project_id: string;
  title: string;
  content_md: string;
};

type ArtifactClaimRow = {
  id: string;
  claim_text: string;
  section_heading: string | null;
};

type TrustedEvidenceRow = {
  id: string;
  content: string;
  summary: string | null;
  classification: string | null;
  sentiment: string | null;
  source_id: string;
};

type VerificationVerdict = "supported" | "partially_supported" | "unsupported";

const VerificationResultSchema = z.object({
  verdict: z.enum(["supported", "partially_supported", "unsupported"]),
  supporting_evidence_ids: z.array(z.string().uuid()).default([]),
  note: z.string().trim().min(1).max(500),
});

function extractJsonObject(content: string) {
  const trimmed = content.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Claim verifier returned no JSON object");
  }
  return JSON.parse(unfenced.slice(start, end + 1)) as unknown;
}

function formatEvidencePool(evidence: TrustedEvidenceRow[]) {
  if (evidence.length === 0) return "No trusted evidence records were available.";

  return evidence
    .map((record) =>
      [
        `ID: ${record.id}`,
        record.classification ? `CLASSIFICATION: ${record.classification}` : null,
        record.sentiment ? `SENTIMENT: ${record.sentiment}` : null,
        record.summary ? `SUMMARY: ${record.summary}` : null,
        `CONTENT: ${record.content.slice(0, 1200)}`,
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n---\n\n");
}

function splitSentences(text: string) {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 30);
}

function extractClaimsFromMarkdown(markdown: string) {
  const claims: Array<{ claim_text: string; section_heading: string | null }> = [];
  let section: string | null = null;
  let paragraph: string[] = [];

  function flushParagraph() {
    const text = paragraph.join(" ").trim();
    paragraph = [];
    if (!text) return;
    if (/^(evidence is limited|open questions?|assumptions?|next steps?)\b/i.test(text)) return;

    for (const sentence of splitSentences(text)) {
      if (sentence.startsWith("#")) continue;
      claims.push({
        claim_text: sentence.slice(0, 1200),
        section_heading: section,
      });
    }
  }

  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("## ")) {
      flushParagraph();
      section = line.replace(/^##\s+/, "").trim() || null;
      continue;
    }
    if (line.startsWith("# ")) {
      flushParagraph();
      continue;
    }
    if (!line) {
      flushParagraph();
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      flushParagraph();
      claims.push({
        claim_text: line.replace(/^[-*]\s+/, "").trim().slice(0, 1200),
        section_heading: section,
      });
      continue;
    }
    paragraph.push(line);
  }

  flushParagraph();

  const seen = new Set<string>();
  return claims
    .filter((claim) => {
      const key = claim.claim_text.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 80);
}

function claimStatus(verdict: VerificationVerdict) {
  if (verdict === "supported") return "supported";
  if (verdict === "partially_supported") return "disputed";
  return "unverified";
}

export const verifyClaims = inngest.createFunction(
  { id: "verify-claims", name: "Verify Claims", retries: 2 },
  { event: "artifact/claim.verification.requested" },
  async ({ event, step }) => {
    const { org_id, project_id, artifact_id } = event.data;
    const supabase = createServiceClient();
    let agentRunId: string | null = null;

    try {
      agentRunId = await step.run("start-agent-run", async () => {
        const { data, error } = await supabase
          .from("agent_runs")
          .insert({
            org_id,
            project_id,
            agent_type: "claim-verification",
            input: {
              artifact_id,
              prompt_version: CLAIM_VERIFICATION_PROMPT_VERSION,
            },
          })
          .select("id")
          .single();

        if (error || !data) {
          throw new Error(`Failed to start claim verification run: ${error?.message}`);
        }

        return data.id as string;
      });

      const { artifact, claims } = await step.run("fetch-artifact", async () => {
        const { data: artifactData, error: artifactError } = await supabase
          .from("artifacts")
          .select("id, org_id, project_id, title, content_md")
          .eq("org_id", org_id)
          .eq("project_id", project_id)
          .eq("id", artifact_id)
          .single();

        if (artifactError || !artifactData) {
          throw new Error(`Failed to fetch artifact: ${artifactError?.message}`);
        }

        const artifactRow = artifactData as ArtifactRow;
        const extractedClaims = extractClaimsFromMarkdown(artifactRow.content_md);

        await supabase
          .from("artifact_claims")
          .delete()
          .eq("org_id", org_id)
          .eq("artifact_id", artifact_id);

        if (extractedClaims.length === 0) {
          return { artifact: artifactRow, claims: [] as ArtifactClaimRow[] };
        }

        const { data: insertedClaims, error: claimsError } = await supabase
          .from("artifact_claims")
          .insert(
            extractedClaims.map((claim) => ({
              artifact_id,
              org_id,
              claim_text: claim.claim_text,
              section_heading: claim.section_heading,
            }))
          )
          .select("id, claim_text, section_heading");

        if (claimsError) {
          throw new Error(`Failed to write artifact claims: ${claimsError.message}`);
        }

        return {
          artifact: artifactRow,
          claims: (insertedClaims ?? []) as ArtifactClaimRow[],
        };
      });

      const evidence = await step.run("fetch-evidence", async () => {
        const { data, error } = await supabase
          .from("evidence")
          .select("id, content, summary, classification, sentiment, source_id")
          .eq("org_id", org_id)
          .eq("project_id", project_id)
          .eq("trust_scope", "trusted")
          .order("created_at", { ascending: false })
          .limit(40);

        if (error) {
          throw new Error(`Failed to fetch trusted evidence: ${error.message}`);
        }

        return (data ?? []) as TrustedEvidenceRow[];
      });

      const verification = await step.run("verify-each-claim", async () => {
        const evidencePool = formatEvidencePool(evidence);
        const allowedEvidenceIds = new Set(evidence.map((record) => record.id));
        const results: Array<{
          claim_id: string;
          verdict: VerificationVerdict;
          supporting_evidence_ids: string[];
          note: string;
          model_used: string;
        }> = [];

        let droppedClaims = 0;
        for (const claim of claims) {
          // RESILIENT SCOPE (Codex P2 review of 88f77ad): only the LLM call and
          // its JSON/schema parse are caught-and-skipped here. Truncated or
          // malformed model output must not fail the whole run — but a database
          // persistence failure is NOT a model-output problem and must NOT be
          // silently swallowed as a "skipped claim." Persistence happens after
          // this block and its errors are thrown to fail the step.
          let parsed: z.infer<typeof VerificationResultSchema>;
          let modelUsed: string;
          try {
            const result = await callLLM({
              tier: "eval",
              // Eval tier defaults to 2048 output tokens; bump for this call to
              // reduce truncation on the verdict+note+evidence_ids object — see
              // issue #30.
              maxTokens: 3072,
              system:
                "You verify artifact claims against trusted evidence. Return strict JSON only.",
              messages: [
                {
                  role: "user",
                  content: buildClaimVerificationPrompt({
                    claim: claim.claim_text,
                    evidence: evidencePool,
                  }),
                },
              ],
              timeoutMs: 120_000,
            });

            const parseResult = VerificationResultSchema.safeParse(
              extractJsonObject(result.content)
            );
            if (!parseResult.success) {
              const failingPaths = parseResult.error.issues
                .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
                .join("; ");
              throw new Error(`schema mismatch (${failingPaths})`);
            }
            parsed = parseResult.data;
            modelUsed = result.model;
          } catch (claimError) {
            // Resilient per-claim handling: LLM/parse failure (truncation,
            // schema mismatch, transient model error) → log and skip, leaving
            // this claim unverified. Skipped claims are surfaced in the summary
            // and prevent an artifact-level "verified" (see compute-status).
            droppedClaims += 1;
            const message = claimError instanceof Error ? claimError.message : "Unknown error";
            console.warn(`[verify-claims] skipped claim ${claim.id}: ${message}`);
            continue;
          }

          // PERSISTENCE — outside the resilient catch. Any error here throws and
          // fails the run (it is a real persistence fault, not flaky model output).
          const supportingEvidenceIds = Array.from(
            new Set(parsed.supporting_evidence_ids.filter((id) => allowedEvidenceIds.has(id)))
          );

          const { error: updateError } = await supabase
            .from("artifact_claims")
            .update({
              verification_status: claimStatus(parsed.verdict),
              verified: parsed.verdict === "supported",
              verification_note: parsed.note,
              verified_at: new Date().toISOString(),
              verifier_model: modelUsed,
              notes: parsed.note,
            })
            .eq("org_id", org_id)
            .eq("artifact_id", artifact_id)
            .eq("id", claim.id);

          if (updateError) {
            throw new Error(`Failed to update claim verification: ${updateError.message}`);
          }

          const { error: deleteError } = await supabase
            .from("artifact_claim_evidence")
            .delete()
            .eq("org_id", org_id)
            .eq("claim_id", claim.id);

          if (deleteError) {
            throw new Error(`Failed to clear claim evidence links: ${deleteError.message}`);
          }

          if (supportingEvidenceIds.length > 0) {
            const { error: linkError } = await supabase.from("artifact_claim_evidence").insert(
              supportingEvidenceIds.map((evidenceId) => ({
                claim_id: claim.id,
                evidence_id: evidenceId,
                org_id,
                relevance: null,
              }))
            );

            if (linkError) {
              throw new Error(`Failed to link supporting evidence: ${linkError.message}`);
            }
          }

          results.push({
            claim_id: claim.id,
            verdict: parsed.verdict,
            supporting_evidence_ids: supportingEvidenceIds,
            note: parsed.note,
            model_used: modelUsed,
          });
        }

        if (droppedClaims > 0) {
          console.warn(
            `[verify-claims] ${droppedClaims}/${claims.length} claim(s) skipped for artifact ${artifact_id}`
          );
        }

        return { results, droppedClaims, attempted: claims.length };
      });

      const output = await step.run("compute-status", async () => {
        const verificationResults = verification.results;
        const droppedClaims = verification.droppedClaims;
        // Denominator includes skipped claims (Codex P1 review of 88f77ad): a
        // claim we could not verify is unverified, not absent.
        const total = verification.attempted;
        const supported = verificationResults.filter((result) => result.verdict === "supported").length;
        const partial = verificationResults.filter(
          (result) => result.verdict === "partially_supported"
        ).length;
        const unsupported = verificationResults.filter(
          (result) => result.verdict === "unsupported"
        ).length;

        // An artifact is only "verified" when every attempted claim was actually
        // verified AND supported — a skipped claim (droppedClaims > 0) means we
        // could not assess part of the artifact, so it can be at most "partial"
        // (Codex P1 review of 88f77ad).
        const verificationStatus =
          total > 0 && supported === total && droppedClaims === 0
            ? "verified"
            : supported > 0 || partial > 0 || droppedClaims > 0
            ? "partial"
            : "unverified";

        const summary = {
          total,
          supported,
          partial,
          unsupported,
          skipped: droppedClaims,
          prompt_version: CLAIM_VERIFICATION_PROMPT_VERSION,
        };

        const modelUsed = Array.from(
          new Set(verificationResults.map((result) => result.model_used))
        ).join(", ");

        const { error: artifactError } = await supabase
          .from("artifacts")
          .update({
            verification_status: verificationStatus,
            verification_run_at: new Date().toISOString(),
            verification_summary: summary,
          })
          .eq("org_id", org_id)
          .eq("project_id", project_id)
          .eq("id", artifact.id);

        if (artifactError) {
          throw new Error(`Failed to update artifact verification: ${artifactError.message}`);
        }

        await supabase
          .from("agent_runs")
          .update({
            status: "completed",
            output: summary,
            model_used: modelUsed || null,
            completed_at: new Date().toISOString(),
          })
          .eq("org_id", org_id)
          .eq("id", agentRunId!);

        return {
          verification_status: verificationStatus,
          ...summary,
        };
      });

      return output;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown claim verification error";
      if (agentRunId) {
        await supabase
          .from("agent_runs")
          .update({
            status: "failed",
            error: message,
            completed_at: new Date().toISOString(),
          })
          .eq("org_id", org_id)
          .eq("id", agentRunId);
      }
      throw error;
    }
  }
);
