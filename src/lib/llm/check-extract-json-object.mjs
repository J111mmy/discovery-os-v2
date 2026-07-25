#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const require = createRequire(import.meta.url);
const directory = path.dirname(fileURLToPath(import.meta.url));

require.extensions[".ts"] = function loadTs(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  });
  module._compile(outputText, filename);
};

const { extractFirstJsonObject } = require(
  path.join(directory, "extract-json-object.ts")
);

const expected = {
  people: [{ name: "Stakeholder 11", note: "Uses {braces} and a quote: \"yes\"" }],
  companies: [],
  competitors: [],
};
const json = JSON.stringify(expected, null, 2);
const cases = [
  json,
  `\`\`\`json\n${json}\n\`\`\``,
  `Here is the result:\n${json}\nThis is trailing commentary.`,
  `${json}\n{"unexpected_second_object":true}`,
];

for (const input of cases) {
  const actual = extractFirstJsonObject(input);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected parsed entity response: ${JSON.stringify(actual)}`);
  }
}

for (const input of ["No JSON here", '{"people":[']) {
  let threw = false;
  try {
    extractFirstJsonObject(input);
  } catch {
    threw = true;
  }
  if (!threw) {
    throw new Error(`Expected parser to reject ${JSON.stringify(input)}`);
  }
}

console.log(`LLM JSON object checks passed (${cases.length + 2} cases).`);
