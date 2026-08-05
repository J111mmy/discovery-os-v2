#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  OUTPUT_QUALITY_BASELINE_CHECKS,
  evaluateOutputQualityGate,
} from "./gate.mjs";

function report({ total = OUTPUT_QUALITY_BASELINE_CHECKS, failures = [] } = {}) {
  return {
    summary: {
      passed: total - failures.length,
      failed: failures.length,
      total,
      score: total === 0 ? 0 : (total - failures.length) / total,
    },
    sources: [
      {
        source_id: "fixture",
        checks: [
          ...Array.from({ length: total - failures.length }, (_, index) => ({
            name: `passing-${index}`,
            passed: true,
            category: "groundedness",
            detail: "present",
          })),
          ...failures,
        ],
      },
    ],
  };
}

assert.equal(evaluateOutputQualityGate(report()).passed, true, "28/28 must pass");
assert.equal(
  evaluateOutputQualityGate(report({ total: 27 })).passed,
  false,
  "a silently reduced fixture must fail"
);
assert.equal(
  evaluateOutputQualityGate(
    report({
      failures: [
        {
          name: "signal:distinct-need",
          passed: false,
          category: "retention",
          detail: "missing terms",
        },
      ],
    })
  ).passed,
  false,
  "a retention regression must fail"
);
assert.equal(
  evaluateOutputQualityGate(
    report({
      total: 29,
      failures: [
        {
          name: "summary_fidelity",
          passed: false,
          category: "groundedness",
          detail: "forbidden over-read present",
        },
      ],
    })
  ).passed,
  false,
  "new failing checks must not be hidden behind the 28-check floor"
);

console.log("Output quality CI gate checks passed.");
