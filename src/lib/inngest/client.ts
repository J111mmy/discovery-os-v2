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
  "project/synthesis.requested": {
    data: {
      org_id: string;
      project_id: string;
    };
  };
  "project/problems.requested": {
    data: {
      org_id: string;
      project_id: string;
      dry_run?: boolean;
    };
  };
  "artifact/claim.verification.requested": {
    data: {
      org_id: string;
      project_id: string;
      artifact_id: string;
    };
  };
};
