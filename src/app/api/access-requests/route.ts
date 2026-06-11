import { createHash } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const AccessRequestSchema = z.object({
  name: z.string().trim().min(1).max(160),
  email: z.string().trim().email().max(320),
  phone: z.string().trim().max(80).optional().nullable(),
  company: z.string().trim().min(1).max(180),
  reason: z.string().trim().min(1).max(1200),
  turnstile_token: z.string().trim().optional().nullable(),
  turnstileToken: z.string().trim().optional().nullable(),
  "cf-turnstile-response": z.string().trim().optional().nullable(),
  website: z.string().optional().nullable(), // honeypot
});

const SUCCESS_RESPONSE = { ok: true, status: "received" };
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const MAX_REQUESTS_PER_FINGERPRINT = 5;
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

type TurnstileVerifyResponse = {
  success?: boolean;
};

function success() {
  return NextResponse.json(SUCCESS_RESPONSE);
}

function clientIp(req: NextRequest) {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip") || "unknown";
}

function requestFingerprint(req: NextRequest) {
  const salt = process.env.ACCESS_REQUEST_RATE_LIMIT_SALT || "discos-access-request-v1";
  const userAgent = req.headers.get("user-agent") || "unknown";
  return createHash("sha256")
    .update(`${salt}:${clientIp(req)}:${userAgent}`)
    .digest("hex");
}

function isUniqueViolation(error: { code?: string; message?: string } | null) {
  return error?.code === "23505" || Boolean(error?.message?.toLowerCase().includes("duplicate"));
}

function turnstileToken(body: z.infer<typeof AccessRequestSchema>) {
  return body.turnstile_token || body.turnstileToken || body["cf-turnstile-response"];
}

async function verifyTurnstile(req: NextRequest, token: string | null | undefined) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret || !token?.trim()) return false;

  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        secret,
        response: token.trim(),
        remoteip: clientIp(req),
      }),
    });

    if (!response.ok) return false;
    const result = (await response.json()) as TurnstileVerifyResponse;
    return result.success === true;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const parsed = AccessRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const body = parsed.data;

  // Honeypot: pretend success without creating a row. This must not reveal that
  // the request was dropped.
  if (body.website?.trim()) {
    return success();
  }

  const email = body.email.toLowerCase();
  const fingerprint = requestFingerprint(req);
  const supabase = createServiceClient();

  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const { count: recentCount } = await supabase
    .from("access_requests")
    .select("id", { count: "exact", head: true })
    .eq("request_fingerprint", fingerprint)
    .gte("created_at", windowStart);

  if ((recentCount ?? 0) >= MAX_REQUESTS_PER_FINGERPRINT) {
    return success();
  }

  const turnstileOk = await verifyTurnstile(req, turnstileToken(body));
  if (!turnstileOk) {
    return success();
  }

  const { data: existingPending } = await supabase
    .from("access_requests")
    .select("id")
    .eq("email", email)
    .eq("status", "pending")
    .maybeSingle();

  if (existingPending) {
    return success();
  }

  const { error } = await supabase.from("access_requests").insert({
    name: body.name,
    email,
    phone: body.phone?.trim() || null,
    company: body.company,
    reason: body.reason,
    request_fingerprint: fingerprint,
    metadata: {
      user_agent: req.headers.get("user-agent"),
      source: "request_access",
    },
  });

  if (error && !isUniqueViolation(error)) {
    return NextResponse.json(
      { error: "Could not submit access request." },
      { status: 500 }
    );
  }

  return success();
}
