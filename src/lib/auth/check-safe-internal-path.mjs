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

const { safeInternalPath } = require(path.join(directory, "safe-internal-path.ts"));

const cases = [
  ["//evil.com", "/projects"],
  ["/\\evil.com", "/projects"],
  ["https://evil.com", "/projects"],
  ["////evil.com", "/projects"],
  ["/projects", "/projects"],
  ["/projects/abc?x=1", "/projects/abc?x=1"],
];

for (const [input, expected] of cases) {
  const actual = safeInternalPath(input);
  if (actual !== expected) {
    throw new Error(`safeInternalPath(${JSON.stringify(input)}) returned ${actual}`);
  }
}

console.log(`Safe internal path checks passed (${cases.length} cases).`);
