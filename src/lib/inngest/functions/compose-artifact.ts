// Compose artifact — durable document drafting via Inngest.
// Triggered by: artifact/compose.requested
// Replaces the synchronous Vercel route handler which hits the 60s timeout on large evidence sets.

import { inngest } from "../client";
import { createServiceClient } from "@/lib/supabase/server";
import { composeDraft } from "@/lib/compose/draft";

function parseMarkdownSections(markdown: string): Array<{ heading: string; content: string }> {
  const lines = markdown.split("\n");
  const sections: Array<{ heading: string; content: string }> = [];
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

  return sections;
}

function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export const composeArtifact = inngest.createFunction(
  { id: "compose-artifact", name: "Compose Artifact", retries: 1 },
  { event: "artifact/compose.requested" },
  async ({ event, step }) => {
    const { org_id, project_id, artifact_id, prompt, limit } = event.data;
    const supabase = createServiceClient();

    try {
      const draft = await step.run("generate-draft", async () => {
        return composeDraft({ org_id, project_id, prompt, limit: limit ?? 18 });
      });

      await step.run("save-draft", async () => {
        const contentMd = [
          `# ${draft.title}`,
          "",
          ...draft.sections.map((s) => `## ${s.heading}\n\n${s.content}`),
        ].join("\n\n");

        const { error } = await supabase
          .from("artifacts")
          .update({
            title: draft.title,
            content_md: contentMd,
            word_count: wordCount(contentMd),
            model_used: draft.model_used,
            task_tier: draft.task_tier,
            metadata: {
              compose_status: "done",
              evidence_ids: draft.evidence_ids,
              citation_map: draft.citation_map,
              prompt,
            },
            updated_at: new Date().toISOString(),
          })
          .eq("org_id", org_id)
          .eq("project_id", project_id)
          .eq("id", artifact_id);

        if (error) {
          throw new Error(`Failed to save composed artifact: ${error.message}`);
        }
      });

      return { artifact_id, title: draft.title, evidence_count: draft.evidence_ids.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown compose error";
      console.error("[compose-artifact] failed:", message);

      // Mark the stub as failed so the client can show an error state
      await supabase
        .from("artifacts")
        .update({
          metadata: {
            compose_status: "failed",
            compose_error: message,
            prompt,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("org_id", org_id)
        .eq("id", artifact_id);

      throw error; // Re-throw so Inngest marks the run as failed
    }
  }
);
