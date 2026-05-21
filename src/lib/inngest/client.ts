import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "discovery-os",
  name: "DiscOS",
});

// Event type map — extend as new events are added
export type Events = {
  "source/ingest.requested": {
    data: {
      org_id: string;
      project_id: string;
      source_id: string;
      job_id: string;
    };
  };
  "source/entities.requested": {
    data: {
      org_id: string;
      project_id: string;
      source_id: string;
    };
  };
  "claim/verification.requested": {
    data: {
      org_id: string;
      artifact_id: string;
      claim_id: string;
    };
  };
};
