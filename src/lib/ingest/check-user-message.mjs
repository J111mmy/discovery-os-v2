import assert from "node:assert/strict";
import {
  INGEST_ALREADY_RUNNING_MESSAGE,
  INGEST_ENTITY_WARNING_MESSAGE,
  INGEST_GENERIC_FAILURE_MESSAGE,
  INGEST_LINKING_FAILURE_MESSAGE,
  ingestJobUserMessage,
  ingestUserMessage,
} from "./user-message.mjs";

assert.equal(
  ingestUserMessage(
    'duplicate key value violates unique constraint "ingest_jobs_one_active_per_source"'
  ),
  INGEST_ALREADY_RUNNING_MESSAGE
);

assert.equal(
  ingestUserMessage(
    'Failed to store evidence: insert or update on table "evidence" violates foreign key constraint "evidence_segment_id_fkey"'
  ),
  INGEST_LINKING_FAILURE_MESSAGE
);

assert.equal(
  ingestJobUserMessage({
    error: "provider detail that must not reach the UI",
    result: {
      issues: [
        {
          code: "ENTITY_EXTRACTION_FAILED",
          message: "untrusted persisted message",
        },
      ],
    },
  }),
  INGEST_ENTITY_WARNING_MESSAGE
);

assert.equal(
  ingestUserMessage("relation public.secret_table does not exist"),
  INGEST_GENERIC_FAILURE_MESSAGE
);

assert.equal(ingestUserMessage(null), null);

console.log("Ingest user-message checks passed (5 cases)");
