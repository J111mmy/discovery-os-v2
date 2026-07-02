#!/usr/bin/env node

import Module from "node:module";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../../..");
const srcRoot = path.join(root, "src");

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

const { parseTranscriptSpeakerLegend, parseTranscriptTurns } = require("./transcript-turns.ts");
const { prescanSourceEntities } = require("./prescan.ts");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function labels(turns) {
  return Array.from(new Set(turns.map((turn) => turn.speaker)));
}

function fakeSupabase() {
  return {
    from() {
      const result = { data: [], error: null };
      const chain = {
        select() {
          return chain;
        },
        eq() {
          return chain;
        },
        order() {
          return Promise.resolve(result);
        },
      };
      return chain;
    },
  };
}

async function run() {
  const academic = `
Participant 01
Institution: Academic health sciences library
Country: USA

I: Interviewer
P: Participant

I: And we will jump into the questions.
P: So I have been working on search systems for years.
I: Can you tell me about your workflow?
P: I usually start with the library catalogue.
`;

  const academicLegend = parseTranscriptSpeakerLegend(academic);
  assert(academicLegend.length === 2, "academic fixture should parse two legend entries");

  const academicTurns = parseTranscriptTurns(academic);
  assert(
    JSON.stringify(labels(academicTurns)) === JSON.stringify(["I", "P"]),
    `academic fixture speakers were ${labels(academicTurns).join(", ")}`
  );

  const academicPrescan = await prescanSourceEntities({
    supabase: fakeSupabase(),
    org_id: "org-test",
    type: "customer_interview",
    raw_text: academic,
  });
  assert(academicPrescan.speakers.length === 2, "academic prescan should emit two speakers");
  assert(
    academicPrescan.speakers[0].raw_label === "I" &&
      academicPrescan.speakers[0].suggested_name === "Interviewer" &&
      academicPrescan.speakers[0].suggested_role === "interviewer",
    "academic interviewer should stay label I and be suggested as interviewer"
  );
  assert(
    academicPrescan.speakers[1].raw_label === "P" &&
      academicPrescan.speakers[1].suggested_name === "Participant" &&
      academicPrescan.speakers[1].suggested_role === "customer",
    "academic participant should stay label P and be suggested as customer"
  );

  const otter = `
Grouped: Friday transcript export
Jimmy Keogh
00:00
Hi Caitlin, thanks for joining.
Caitlin
00:05
No problem, happy to help.
Jimmy Keogh
00:10
How are you handling the review process today?
Caitlin
00:15
We still do most of it manually.
`;
  const otterPrescan = await prescanSourceEntities({
    supabase: fakeSupabase(),
    org_id: "org-test",
    type: "customer_interview",
    raw_text: otter,
  });
  assert(
    JSON.stringify(otterPrescan.speakers.map((speaker) => speaker.raw_label)) ===
      JSON.stringify(["Jimmy Keogh", "Caitlin"]),
    `otter fixture speakers were ${otterPrescan.speakers
      .map((speaker) => speaker.raw_label)
      .join(", ")}`
  );

  const bots = `
00:50 PARTICIPANT 10: The bot comments on every pull request and it gets noisy. 00:54 RESEARCHER: What happens next? 01:01 PARTICIPANT 10: We mute parts of it. 01:10 RESEARCHER: Is that common across the team?
`;
  const botSpeakers = labels(parseTranscriptTurns(bots));
  assert(
    JSON.stringify(botSpeakers) === JSON.stringify(["PARTICIPANT 10", "RESEARCHER"]),
    `bots fixture speakers were ${botSpeakers.join(", ")}`
  );

  console.log("Transcript turn checks passed.");
}

run().catch((error) => {
  console.error("Transcript turn checks failed:");
  console.error(error);
  process.exit(1);
});
