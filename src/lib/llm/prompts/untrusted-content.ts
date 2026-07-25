export function neutralizePromptFence(value: string, fenceName: string) {
  const escapedFenceName = fenceName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<\\s*\\/?\\s*${escapedFenceName}\\b`, "gi");
  return value.replace(pattern, (match) => match.replace("<", "["));
}

export function neutralizeUntrustedSourceContentFence(value: string) {
  return neutralizePromptFence(value, "untrusted_source_content");
}
