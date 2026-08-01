import assert from "node:assert/strict";
import {
  MAX_ACTIVE_INGESTS_PER_ORG,
  MAX_RAW_TEXT_CHARS,
  canDispatchIngest,
  rawTextIsWithinLimit,
} from "./limits.mjs";

assert.equal(rawTextIsWithinLimit("x".repeat(MAX_RAW_TEXT_CHARS)), true);
assert.equal(rawTextIsWithinLimit("x".repeat(MAX_RAW_TEXT_CHARS + 1)), false);
assert.equal(canDispatchIngest(MAX_ACTIVE_INGESTS_PER_ORG - 1), true);
assert.equal(canDispatchIngest(MAX_ACTIVE_INGESTS_PER_ORG), false);
assert.equal(canDispatchIngest(-1), false);

console.log("Ingest limit checks passed (5 cases).");
