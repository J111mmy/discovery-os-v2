// Inngest event handler — all background functions registered here
import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { extractEntities } from "@/lib/inngest/functions/extract-entities";
import { ingestSource } from "@/lib/inngest/functions/ingest-source";
import { synthesiseProject } from "@/lib/inngest/functions/synthesise-project";
import { discoverProblems } from "@/lib/inngest/functions/discover-problems";
import { verifyClaims } from "@/lib/inngest/functions/verify-claims";
import { detectGaps } from "@/lib/inngest/functions/detect-gaps";
import { weeklyProjectSynthesis } from "@/lib/inngest/functions/scheduled-synthesis";
import { sessionReview } from "@/lib/inngest/functions/session-review";
import { composeArtifact } from "@/lib/inngest/functions/compose-artifact";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    ingestSource,
    extractEntities,
    synthesiseProject,
    discoverProblems,
    verifyClaims,
    detectGaps,
    weeklyProjectSynthesis,
    sessionReview,
    composeArtifact,
  ],
});
