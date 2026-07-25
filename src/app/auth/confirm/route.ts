import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeInternalPath } from "@/lib/auth/safe-internal-path";

function redirectWithoutCaching(target: URL) {
  const response = NextResponse.redirect(target);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

function recoveryFailure(url: URL, next: string) {
  const loginUrl = new URL("/login", url.origin);
  loginUrl.searchParams.set("error", "recovery_failed");
  loginUrl.searchParams.set("next", next);
  return redirectWithoutCaching(loginUrl);
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const next = safeInternalPath(url.searchParams.get("next"));

  if (!tokenHash || type !== "recovery") {
    return recoveryFailure(url, next);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "recovery",
  });

  if (error) {
    return recoveryFailure(url, next);
  }

  return redirectWithoutCaching(new URL(next, url.origin));
}
