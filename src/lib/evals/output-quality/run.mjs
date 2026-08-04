#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const require = createRequire(import.meta.url);
const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../../..");
const srcRoot = path.join(root, "src");
const fixturePath = path.join(directory, "fixtures.json");

function loadLocalEnv() {
  const envPath = path.join(root, ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]] != null) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
  if (request.startsWith("@/")) {
    const mapped = path.join(srcRoot, request.slice(2));
    return originalResolveFilename.call(this, mapped, parent, isMain, options);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

require.extensions[".ts"] = function loadTs(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  });
  module._compile(outputText, filename);
};

function parseArgs(argv) {
  const options = {
    live: false,
    validateOnly: false,
    allowFailures: false,
    label: "current",
    output: null,
    baseline: null,
    rescore: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--live") options.live = true;
    else if (value === "--validate-only") options.validateOnly = true;
    else if (value === "--allow-failures") options.allowFailures = true;
    else if (value === "--label") options.label = argv[++index];
    else if (value === "--output") options.output = argv[++index];
    else if (value === "--baseline") options.baseline = argv[++index];
    else if (value === "--rescore") options.rescore = argv[++index];
    else throw new Error(`Unknown argument: ${value}`);
  }
  return options;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validateFixture(fixture) {
  assert(fixture?.version === "output-quality-fixture-v1", "Unexpected fixture version");
  assert(Array.isArray(fixture.sources) && fixture.sources.length >= 3, "Expected three sources");
  const sourceTypes = new Set(fixture.sources.map((source) => source.source_type));
  for (const requiredType of ["Customer interview", "Usability study", "Internal meeting"]) {
    assert(sourceTypes.has(requiredType), `Missing ${requiredType} fixture`);
  }
  for (const source of fixture.sources) {
    assert(source.id && source.title, "Every source needs an id and title");
    assert(Array.isArray(source.units) && source.units.length > 0, `${source.id} has no units`);
    assert(source.expected?.evidence_count, `${source.id} has no evidence range`);
  }
}

function extractJsonArray(content) {
  const unfenced = content.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const start = unfenced.indexOf("[");
  if (start === -1) throw new Error("LLM response did not contain a JSON array");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < unfenced.length; index += 1) {
    const char = unfenced[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) return JSON.parse(unfenced.slice(start, index + 1));
    }
  }
  throw new Error("LLM response contained an incomplete JSON array");
}

function normalized(value) {
  return String(value ?? "").toLowerCase().replace(/[-_]/g, " ");
}

function headings(markdown) {
  return Array.from(markdown.matchAll(/^##\s+(.+)$/gm), (match) => match[1].trim());
}

function formatEvidenceForReview(records) {
  return records
    .map((record, index) =>
      [
        `### Record ${index + 1}: ${record.classification ?? "signal"} / ${record.sentiment ?? "neutral"}`,
        record.speaker ? `**Speaker:** [${record.speaker}]` : null,
        record.content,
        record.summary ? `*Summary: ${record.summary}*` : null,
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n---\n\n");
}

function scoreSource(source, evidence, brief) {
  const checks = [];
  const add = (name, passed, detail, category = "retention") =>
    checks.push({ name, passed, detail, category });
  const expected = source.expected;
  const count = evidence.length;
  add(
    "evidence_count",
    count >= expected.evidence_count.min && count <= expected.evidence_count.max,
    `${count} records; expected ${expected.evidence_count.min}-${expected.evidence_count.max}`
  );

  const speakers = new Set(evidence.map((record) => normalized(record.speaker)).filter(Boolean));
  for (const speaker of expected.speakers) {
    add(
      `speaker:${speaker}`,
      speakers.has(normalized(speaker)),
      speakers.has(normalized(speaker)) ? "present" : `missing; saw ${Array.from(speakers).join(", ")}`,
      "attribution"
    );
  }

  const evidenceText = normalized(
    evidence.map((record) => `${record.content ?? ""} ${record.summary ?? ""}`).join("\n")
  );
  for (const signal of expected.key_signals) {
    const missing = signal.terms.filter((term) => !evidenceText.includes(normalized(term)));
    add(
      `signal:${signal.name}`,
      missing.length === 0,
      missing.length === 0 ? "present" : `missing terms: ${missing.join(", ")}`
    );
  }

  const summaries = evidence.map((record) => String(record.summary ?? "")).join("\n");
  for (const pattern of expected.forbidden_summary_patterns) {
    const matched = new RegExp(pattern, "i").test(summaries);
    add(
      `summary_fidelity:${pattern}`,
      !matched,
      matched ? "forbidden over-read present" : "absent",
      "groundedness"
    );
  }

  for (const fidelityCase of expected.summary_fidelity_cases ?? []) {
    const matchingRecords = evidence.filter(
      (record) => record.unit_id === fidelityCase.unit_id
    );
    if (matchingRecords.length === 0 && fidelityCase.optional) {
      add(
        `summary_stance:${fidelityCase.unit_id}`,
        true,
        "record omitted rather than over-read",
        "groundedness"
      );
      continue;
    }
    const matchingSummaries = normalized(
      matchingRecords.map((record) => record.summary ?? "").join("\n")
    );
    const hasRequiredStance = fidelityCase.required_any.some((term) =>
      matchingSummaries.includes(normalized(term))
    );
    const forbiddenStance = fidelityCase.forbidden.find((term) =>
      matchingSummaries.includes(normalized(term))
    );
    add(
      `summary_stance:${fidelityCase.unit_id}`,
      matchingRecords.length > 0 && hasRequiredStance && !forbiddenStance,
      matchingRecords.length === 0
        ? "expected record missing"
        : forbiddenStance
          ? `forbidden stance: ${forbiddenStance}`
          : hasRequiredStance
            ? "faithful stance preserved"
            : `missing one of: ${fidelityCase.required_any.join(", ")}`,
      "groundedness"
    );
  }

  if (expected.session_review?.skip) {
    add("session_review_skipped", brief == null, brief == null ? "skipped" : "unexpected brief");
  } else {
    const actualHeadings = headings(brief ?? "");
    for (const pattern of expected.session_review.required_heading_patterns ?? []) {
      const matchedHeading = actualHeadings.find((heading) =>
        new RegExp(pattern, "i").test(heading)
      );
      add(
        `brief_heading:${pattern}`,
        Boolean(matchedHeading),
        matchedHeading
          ? `present as: ${matchedHeading}`
          : `missing; saw ${actualHeadings.join(", ")}`,
        "structure"
      );
    }
    for (const heading of expected.session_review.forbidden_headings) {
      add(
        `brief_omits:${heading}`,
        !actualHeadings.includes(heading),
        actualHeadings.includes(heading) ? "unexpected heading present" : "omitted",
        "structure"
      );
    }
  }

  return checks;
}

function summarizeChecks(sourceReports) {
  const checks = sourceReports.flatMap((source) => source.checks);
  const passed = checks.filter((check) => check.passed).length;
  return {
    passed,
    failed: checks.length - passed,
    total: checks.length,
    score: checks.length === 0 ? 0 : Number((passed / checks.length).toFixed(4)),
    failure_categories: checks
      .filter((check) => !check.passed)
      .reduce((counts, check) => {
        counts[check.category] = (counts[check.category] ?? 0) + 1;
        return counts;
      }, {}),
  };
}

function addParticipantCheck(fixture, sourceReports) {
  const observedExternalSpeakers = new Set(
    sourceReports.flatMap((source) =>
      source.evidence.map((record) => normalized(record.speaker)).filter(Boolean)
    )
  );
  sourceReports[0].checks.unshift({
    name: "fixture_external_participant_count",
    passed: observedExternalSpeakers.size === fixture.expected_external_participants,
    detail: `${observedExternalSpeakers.size}; expected ${fixture.expected_external_participants}`,
    category: "attribution",
  });
}

function rescoreReport(fixture, existing, options) {
  const sourceById = new Map(fixture.sources.map((source) => [source.id, source]));
  const sources = existing.sources.map((actual) => {
    const source = sourceById.get(actual.source_id);
    assert(source, `Report contains unknown source ${actual.source_id}`);
    return {
      ...actual,
      checks: scoreSource(source, actual.evidence, actual.brief),
    };
  });
  addParticipantCheck(fixture, sources);
  return {
    ...existing,
    label: options.label,
    rescored_at: new Date().toISOString(),
    fixture_version: fixture.version,
    summary: summarizeChecks(sources),
    sources,
  };
}

async function runLive(fixture, options) {
  loadLocalEnv();
  assert(
    process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY,
    "A provider API key is required for --live"
  );
  const { callLLM } = require("../../llm/client.ts");
  const {
    buildIngestExtractionBatchContent,
    buildIngestExtractionStaticPrompt,
    INGEST_EXTRACTION_PROMPT_VERSION,
  } = require("../../llm/prompts/ingest.ts");
  const {
    buildSessionReviewPrompt,
    SESSION_REVIEW_PROMPT_VERSION,
  } = require("../../llm/prompts/session-review.ts");

  const calls = [];
  const sourceReports = [];
  for (const source of fixture.sources) {
    const staticPrompt = buildIngestExtractionStaticPrompt({
      frame: "Understand how teams coordinate procurement work and where current workflows fail.",
      themes: "No existing themes.",
      problems: "No problems identified yet.",
      otherProjects: "No other active projects.",
      internalSpeakers: source.internal_speakers,
    });
    const extractionStarted = Date.now();
    const extraction = await callLLM({
      tier: "standard",
      system: "You extract structured customer evidence. Return strict JSON only.",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: staticPrompt, cache_control: { type: "ephemeral" } },
            {
              type: "text",
              text: `CONVERSATION UNITS:\n\n${buildIngestExtractionBatchContent({ units: source.units })}`,
            },
          ],
        },
      ],
      timeoutMs: 50_000,
      maxTokens: 1800,
    });
    calls.push({
      source_id: source.id,
      step: "extract",
      model: extraction.model,
      duration_ms: Date.now() - extractionStarted,
      input_tokens: extraction.inputTokens,
      output_tokens: extraction.outputTokens,
      cache_write_tokens: extraction.cacheCreationInputTokens ?? 0,
      cache_read_tokens: extraction.cacheReadInputTokens ?? 0,
      estimated_cost_usd: extraction.estimatedCostUsd ?? 0,
    });
    const evidence = extractJsonArray(extraction.content);

    let brief = null;
    if (!source.expected.session_review?.skip && evidence.length >= 3) {
      const reviewStarted = Date.now();
      const review = await callLLM({
        tier: "standard",
        system:
          "You write clear, human-readable research briefs. Write in prose. Return only the brief. No preamble, no meta-commentary.",
        messages: [
          {
            role: "user",
            content: buildSessionReviewPrompt({
              sourceTitle: source.title,
              sourceType: source.source_type,
              evidence: formatEvidenceForReview(evidence),
              evidenceCount: evidence.length,
            }),
          },
        ],
        timeoutMs: 50_000,
        maxTokens: 1800,
      });
      brief = review.content.trim();
      calls.push({
        source_id: source.id,
        step: "session_review",
        model: review.model,
        duration_ms: Date.now() - reviewStarted,
        input_tokens: review.inputTokens,
        output_tokens: review.outputTokens,
        cache_write_tokens: review.cacheCreationInputTokens ?? 0,
        cache_read_tokens: review.cacheReadInputTokens ?? 0,
        estimated_cost_usd: review.estimatedCostUsd ?? 0,
      });
    }
    sourceReports.push({
      source_id: source.id,
      evidence,
      brief,
      checks: scoreSource(source, evidence, brief),
    });
  }

  addParticipantCheck(fixture, sourceReports);

  const totals = calls.reduce(
    (sum, call) => ({
      input_tokens: sum.input_tokens + call.input_tokens,
      output_tokens: sum.output_tokens + call.output_tokens,
      cache_write_tokens: sum.cache_write_tokens + call.cache_write_tokens,
      cache_read_tokens: sum.cache_read_tokens + call.cache_read_tokens,
      estimated_cost_usd: Number((sum.estimated_cost_usd + call.estimated_cost_usd).toFixed(6)),
      duration_ms: sum.duration_ms + call.duration_ms,
    }),
    {
      input_tokens: 0,
      output_tokens: 0,
      cache_write_tokens: 0,
      cache_read_tokens: 0,
      estimated_cost_usd: 0,
      duration_ms: 0,
    }
  );
  const report = {
    schema_version: "output-quality-report-v1",
    label: options.label,
    generated_at: new Date().toISOString(),
    fixture_version: fixture.version,
    prompt_versions: {
      ingest: INGEST_EXTRACTION_PROMPT_VERSION,
      session_review: SESSION_REVIEW_PROMPT_VERSION,
    },
    summary: summarizeChecks(sourceReports),
    usage: { calls, totals },
    sources: sourceReports,
  };
  if (options.baseline) {
    const baseline = JSON.parse(fs.readFileSync(path.resolve(options.baseline), "utf8"));
    report.comparison = {
      baseline_label: baseline.label,
      baseline_score: baseline.summary?.score ?? null,
      current_score: report.summary.score,
      score_delta: Number((report.summary.score - (baseline.summary?.score ?? 0)).toFixed(4)),
      baseline_failed: baseline.summary?.failed ?? null,
      current_failed: report.summary.failed,
    };
  }
  return report;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  validateFixture(fixture);
  if (options.validateOnly) {
    console.log(`Output quality fixture is valid (${fixture.sources.length} sources).`);
    return;
  }
  let report;
  if (options.rescore) {
    report = rescoreReport(
      fixture,
      JSON.parse(fs.readFileSync(path.resolve(options.rescore), "utf8")),
      options
    );
  } else if (!options.live) {
    throw new Error("Live evaluation requires the explicit --live flag because it spends LLM credits.");
  } else {
    report = await runLive(fixture, options);
  }
  const outputPath = path.resolve(
    options.output ?? `/tmp/discos-output-quality-${Date.now()}.json`
  );
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `Output quality eval: ${report.summary.passed}/${report.summary.total} passed; ` +
      `${report.summary.failed} failed; estimated $${report.usage.totals.estimated_cost_usd.toFixed(4)}.`
  );
  console.log(`Report: ${outputPath}`);
  if (report.summary.failed > 0 && !options.allowFailures) process.exitCode = 1;
}

main().catch((error) => {
  console.error("Output quality eval failed:");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
