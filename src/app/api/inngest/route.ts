// Inngest event handler — all background functions registered here
import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { extractEntities } from "@/lib/inngest/functions/extract-entities";
import { ingestSource } from "@/lib/inngest/functions/ingest-source";
import { synthesiseProject } from "@/lib/inngest/functions/synthesise-project";
import { discoverProblems } from "@/lib/inngest/functions/discover-problems";
import { verifyClaims } from "@/lib/inngest/functions/verify-claims";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    ingestSource,
    extractEntities,
    synthesiseProject,
    discoverProblems,
    verifyClaims,
  ],
});
