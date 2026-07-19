const MAX_REPORT_BYTES = 16 * 1024;

type CspReport = Record<string, unknown>;

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function urlOrigin(value: unknown): string | null {
  const raw = stringValue(value);
  if (!raw) return null;
  if (raw === "inline" || raw === "eval") return raw;

  try {
    return new URL(raw).origin;
  } catch {
    return raw.startsWith("/") ? "self" : "unparseable";
  }
}

function urlPath(value: unknown): string | null {
  const raw = stringValue(value);
  if (!raw) return null;

  try {
    return new URL(raw).pathname;
  } catch {
    return raw.startsWith("/") ? raw.slice(0, 256) : null;
  }
}

function firstReport(payload: unknown): CspReport | null {
  if (Array.isArray(payload)) {
    const first = payload[0];
    if (first && typeof first === "object" && "body" in first) {
      const body = (first as { body?: unknown }).body;
      return body && typeof body === "object" ? (body as CspReport) : null;
    }
    return first && typeof first === "object" ? (first as CspReport) : null;
  }

  if (!payload || typeof payload !== "object") return null;
  const legacy = (payload as { "csp-report"?: unknown })["csp-report"];
  if (legacy && typeof legacy === "object") return legacy as CspReport;
  return payload as CspReport;
}

async function readBoundedBody(request: Request): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return "";

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    totalBytes += value.byteLength;
    if (totalBytes > MAX_REPORT_BYTES) return null;
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(body);
}

export async function POST(request: Request) {
  const body = await readBoundedBody(request);
  if (body === null) {
    return new Response(null, { status: 413, headers: { "cache-control": "no-store" } });
  }

  if (body.trim()) {
    try {
      const report = firstReport(JSON.parse(body));
      if (report) {
        console.warn("[csp-report] violation", {
          blockedOrigin: urlOrigin(report["blocked-uri"] ?? report.blockedURL),
          documentPath: urlPath(report["document-uri"] ?? report.documentURL ?? report.url),
          effectiveDirective: stringValue(
            report["effective-directive"] ?? report.effectiveDirective
          ),
          violatedDirective: stringValue(
            report["violated-directive"] ?? report.violatedDirective
          ),
          sourceOrigin: urlOrigin(report["source-file"] ?? report.sourceFile),
        });
      }
    } catch {
      console.warn("[csp-report] invalid report payload");
    }
  }

  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  });
}
