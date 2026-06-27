export const NO_EM_DASH_OUTPUT_RULE =
  "Never use the Unicode em dash character (U+2014) in prose you compose for user-facing text or JSON string values. Use commas, parentheses, colons, semicolons, or two short sentences instead. When quoting a person verbatim (evidence claims, extracted quotes), reproduce their exact words and original punctuation, em dashes included.";

export function appendUserFacingStyleRules(systemPrompt: string) {
  if (systemPrompt.includes("U+2014")) return systemPrompt;
  return `${systemPrompt.trim()}\n\nSTYLE LAW:\n- ${NO_EM_DASH_OUTPUT_RULE}`;
}
