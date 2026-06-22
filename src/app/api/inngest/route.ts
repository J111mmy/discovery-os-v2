// Inngest event handler — all background functions registered here
import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { extractEntities } from "@/lib/inngest/functions/extract-entities";
import { ingestSource } from "@/lib/inngest/functions/ingest-source";
import { synthesiseProject } from "@/lib/inngest/functions/synthesise-project";
import { discoverProblems } from "@/lib/inngest/functions/discover-problems";
import { generateOpportunities } from "@/lib/inngest/functions/generate-opportunities";
import { verifyClaims } from "@/lib/inngest/functions/verify-claims";
import { detectGaps } from "@/lib/inngest/functions/detect-gaps";
import { sessionReview } from "@/lib/inngest/functions/session-review";
import { composeArtifact } from "@/lib/inngest/functions/compose-artifact";
import { synthesisePerson } from "@/lib/inngest/functions/synthesise-person";
import { draftFrame } from "@/lib/inngest/functions/draft-frame";
import { synthesiseCompany } from "@/lib/inngest/functions/synthesise-company";
import { extractActions } from "@/lib/inngest/functions/extract-actions";
import { synthesiseCompetitor } from "@/lib/inngest/functions/synthesise-competitor";
import { gradeEvidence } from "@/lib/inngest/functions/grade-evidence";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    ingestSource,
    extractEntities,
    synthesiseProject,
    discoverProblems,
    generateOpportunities,
    verifyClaims,
    detectGaps,
    sessionReview,
    composeArtifact,
    synthesisePerson,
    draftFrame,
    synthesiseCompany,
    extractActions,
    synthesiseCompetitor,
    gradeEvidence,
  ],
});
