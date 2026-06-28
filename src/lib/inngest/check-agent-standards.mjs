#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const functionsDir = path.join(root, "src/lib/inngest/functions");
const appDir = path.join(root, "src/app");
const TIMEOUT_LIMIT_MS = 60_000;

function walk(dir, predicate = () => true) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath, predicate));
    } else if (predicate(fullPath)) {
      files.push(fullPath);
    }
  }
  return files;
}

function lineFor(source, index) {
  return source.slice(0, index).split("\n").length;
}

function stripSeparators(value) {
  return value.replace(/_/g, "");
}

function extractBalanced(source, startIndex, openChar = "{", closeChar = "}") {
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }

    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === "'" || char === "\"" || char === "`") {
      quote = char;
      continue;
    }

    if (char === openChar) depth += 1;
    if (char === closeChar) depth -= 1;
    if (depth === 0) {
      return { text: source.slice(startIndex, index + 1), end: index + 1 };
    }
  }

  throw new Error(`Could not find matching ${closeChar} from index ${startIndex}`);
}

function findCallObjects(source, callee) {
  const calls = [];
  const pattern = new RegExp(`\\b${callee}\\s*\\(`, "g");
  let match;
  while ((match = pattern.exec(source))) {
    const openParen = source.indexOf("(", match.index);
    const objectStart = source.indexOf("{", openParen);
    if (objectStart === -1) continue;
    const object = extractBalanced(source, objectStart);
    calls.push({ callee, index: match.index, object: object.text });
    pattern.lastIndex = object.end;
  }
  return calls;
}

function parseLocalNumericValues(source) {
  const values = new Map();
  const constRegex = /const\s+([A-Z0-9_]+)\s*=\s*([0-9][0-9_]*)\s*;/g;
  let match;
  while ((match = constRegex.exec(source))) {
    values.set(match[1], Number(stripSeparators(match[2])));
  }

  const functionRegex = /function\s+([A-Za-z0-9_]+)\s*\([^)]*\)\s*{([\s\S]*?)}/g;
  while ((match = functionRegex.exec(source))) {
    const [, name, body] = match;
    if (!body.includes("configuredInteger(")) continue;
    const numbers = Array.from(body.matchAll(/\b[0-9][0-9_]*\b/g)).map((item) =>
      Number(stripSeparators(item[0]))
    );
    if (numbers.length > 0) {
      values.set(`${name}()`, numbers[numbers.length - 1]);
    }
  }

  return values;
}

function resolveNumericExpression(expression, localValues) {
  const trimmed = expression.trim().replace(/,$/, "");
  if (/^[0-9][0-9_]*$/.test(trimmed)) return Number(stripSeparators(trimmed));
  if (localValues.has(trimmed)) return localValues.get(trimmed);
  return null;
}

function getPropertyExpression(object, propertyName) {
  const regex = new RegExp(`\\b${propertyName}\\s*:\\s*([^,\\n}]+)`);
  return object.match(regex)?.[1]?.trim() ?? null;
}

function getCreateFunctionConfig(source) {
  const callIndex = source.indexOf("inngest.createFunction(");
  if (callIndex === -1) return null;
  const openParen = source.indexOf("(", callIndex);
  const objectStart = source.indexOf("{", openParen);
  if (objectStart === -1) return null;
  return extractBalanced(source, objectStart).text;
}

function getFunctionEvent(source) {
  return source.match(/\{\s*event:\s*["']([^"']+)["']\s*}/)?.[1] ?? null;
}

function getUserTriggeredProjectEvents() {
  const events = new Set();
  for (const file of walk(appDir, (fullPath) => fullPath.endsWith(".ts") || fullPath.endsWith(".tsx"))) {
    const source = fs.readFileSync(file, "utf8");
    if (!/export\s+async\s+function\s+run[A-Za-z0-9_]*Action/.test(source)) continue;
    for (const match of source.matchAll(/\bname\s*:\s*["']([^"']+)["']/g)) {
      events.add(match[1]);
    }
  }
  return events;
}

function hasProjectConcurrency(config) {
  return (
    /\bconcurrency\s*:\s*{[\s\S]*?\blimit\s*:\s*1[\s\S]*?\bkey\s*:\s*["']event\.data\.project_id["'][\s\S]*?}/.test(
      config
    )
  );
}

const userTriggeredProjectEvents = getUserTriggeredProjectEvents();
const failures = [];

for (const file of walk(functionsDir, (fullPath) => fullPath.endsWith(".ts"))) {
  const source = fs.readFileSync(file, "utf8");
  const relative = path.relative(root, file);
  const localValues = parseLocalNumericValues(source);
  const calls = [...findCallObjects(source, "callLLM"), ...findCallObjects(source, "streamLLM")];
  const llmCalls = calls.filter((call) => /\b(callLLM|streamLLM)\b/.test(call.callee));
  const premiumCalls = llmCalls.filter((call) => /\btier\s*:\s*["']premium["']/.test(call.object));
  const config = getCreateFunctionConfig(source);
  const eventName = getFunctionEvent(source);

  for (const call of llmCalls) {
    const callLocation = `${relative}:${lineFor(source, call.index)}`;

    if (!/\btelemetry\s*:/.test(call.object)) {
      failures.push(`${callLocation} ${call.callee} is missing telemetry (R7).`);
    }

    const timeoutExpression = getPropertyExpression(call.object, "timeoutMs");
    if (timeoutExpression) {
      const timeout = resolveNumericExpression(timeoutExpression, localValues);
      if (timeout == null) {
        failures.push(
          `${callLocation} timeoutMs uses an unresolved expression (${timeoutExpression}); use a local numeric constant below ${TIMEOUT_LIMIT_MS} (R3).`
        );
      } else if (timeout >= TIMEOUT_LIMIT_MS) {
        failures.push(`${callLocation} timeoutMs is ${timeout}; must be < ${TIMEOUT_LIMIT_MS} (R3).`);
      }
    }

    if (/\btier\s*:\s*["']premium["']/.test(call.object) && !/\bmaxTokens\s*:/.test(call.object)) {
      failures.push(`${callLocation} premium ${call.callee} is missing an explicit maxTokens cap (R2).`);
    }
  }

  if (premiumCalls.length > 0) {
    if (!config) {
      failures.push(`${relative} makes premium LLM calls but has no readable createFunction config.`);
    } else {
      const retriesExpression = getPropertyExpression(config, "retries");
      if (retriesExpression) {
        const retries = resolveNumericExpression(retriesExpression, localValues);
        if (retries == null) {
          failures.push(`${relative} premium function has unresolved retries (${retriesExpression}) (R4).`);
        } else if (retries > 1) {
          failures.push(`${relative} premium function retries is ${retries}; must be <= 1 (R4).`);
        }
      }
    }
  }

  if (eventName && userTriggeredProjectEvents.has(eventName)) {
    if (!config || !hasProjectConcurrency(config)) {
      failures.push(
        `${relative} handles user-triggered event "${eventName}" but lacks concurrency: { limit: 1, key: "event.data.project_id" } (R5).`
      );
    }
  }
}

if (failures.length > 0) {
  console.error("Agent standards check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Agent standards check passed.");
