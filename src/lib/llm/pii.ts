// Deterministic PII redaction — runs before any LLM call
// Stores raw_content and redacted_content separately in the DB.
// Never send raw_content to an LLM.

// Patterns are additive — extend as needed
const PII_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Email addresses
  { pattern: /[\w.+\-]+@[\w\-]+\.[a-z]{2,}/gi, replacement: "[EMAIL]" },
  // Phone numbers (international + local formats)
  { pattern: /(?:\+?\d[\s\-.]?){7,15}/g, replacement: "[PHONE]" },
  // UK National Insurance numbers
  { pattern: /\b[A-Z]{2}\s?\d{6}\s?[A-D]\b/g, replacement: "[NI_NUMBER]" },
  // Credit card numbers (loose 16-digit)
  { pattern: /\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/g, replacement: "[CARD_NUMBER]" },
  // URLs with auth tokens
  { pattern: /https?:\/\/[^\s]*(?:token|key|secret|api)[^\s]*/gi, replacement: "[REDACTED_URL]" },
];

export function redactPII(text: string): string {
  let result = text;
  for (const { pattern, replacement } of PII_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

export function hasSignificantPII(text: string): boolean {
  return PII_PATTERNS.some(({ pattern }) => {
    pattern.lastIndex = 0; // reset global regex state
    return pattern.test(text);
  });
}
