export function neutralizeUntrustedSourceContentFence(value: string) {
  return value.replace(/<\s*\/?\s*untrusted_source_content\b/gi, (match) =>
    match.replace("<", "[")
  );
}
