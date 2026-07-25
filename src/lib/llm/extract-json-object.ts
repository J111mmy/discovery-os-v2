/**
 * Parse the first complete JSON object from an LLM response.
 *
 * Providers occasionally wrap valid JSON in a code fence, commentary, or a
 * second object. Reading the balanced first object preserves the valid payload
 * without accepting an incomplete response.
 */
export function extractFirstJsonObject(value: string): unknown {
  const start = value.indexOf("{");
  if (start === -1) {
    throw new Error("LLM response returned no JSON object");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < value.length; index += 1) {
    const char = value[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    if (char !== "}") continue;

    depth -= 1;
    if (depth === 0) {
      return JSON.parse(value.slice(start, index + 1)) as unknown;
    }
  }

  throw new Error("LLM response returned an incomplete JSON object");
}
