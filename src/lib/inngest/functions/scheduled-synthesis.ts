// Scheduled synthesis — runs weekly for all active projects.
// Fires every Monday at 06:00 UTC per CLAUDE.md §15 (Weekly operating rhythm).
// Each project gets its own synthesis event so they run independently and in parallel.

import { inngest } from "../client";
import { createServiceClient } from "@/lib/supabase/server";

export const weeklyProjectSynthesis = inngest.createFunction(
  {
    id: "weekly-project-synthesis",
    name: "Weekly Project Synthesis",
    retries: 0, // if the scheduler fires, it fires — don't retry the fan-out itself
  },
  {
    cron: "0 6 * * 1", // Every Monday at 06:00 UTC
  },
  async ({ step }) => {
    const supabase = createServiceClient();

    // Fetch all projects that have at least one trusted evidence record
    // — no point synthesising an empty project
    const { data: projects, error } = await step.run("fetch-active-projects", async () => {
      const result = await supabase
        .from("projects")
        .select(`
          id,
          org_id,
          evidence!inner(id)
        `)
        .eq("evidence.trust_scope", "trusted")
        .limit(200);

      return result;
    });

    if (error || !projects || projects.length === 0) {
      return { projects_queued: 0 };
    }

    // Deduplicate — the join may produce duplicate project rows
    const seen = new Set<string>();
    const unique = projects.filter((p: { id: string }) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });

    // Fan out — one synthesis event per project
    await step.run("fan-out-synthesis", async () => {
      const events = (unique as Array<{ id: string; org_id: string }>).map((p) => ({
        name: "project/synthesis.requested" as const,
        data: { org_id: p.org_id, project_id: p.id },
      }));

      if (events.length > 0) {
        await inngest.send(events);
      }
    });

    return { projects_queued: unique.length };
  }
);
