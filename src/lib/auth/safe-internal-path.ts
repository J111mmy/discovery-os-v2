const INTERNAL_ORIGIN = "https://discos.invalid";
const DEFAULT_PATH = "/projects";

/**
 * Accept only a path that resolves back to the application origin.
 * URL parsing catches scheme-relative and backslash-normalised external URLs.
 */
export function safeInternalPath(path: string | null): string {
  if (!path || !path.startsWith("/")) return DEFAULT_PATH;

  try {
    const resolved = new URL(path, INTERNAL_ORIGIN);

    if (resolved.origin !== INTERNAL_ORIGIN) return DEFAULT_PATH;

    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return DEFAULT_PATH;
  }
}
