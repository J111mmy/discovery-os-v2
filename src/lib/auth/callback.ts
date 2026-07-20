import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { clearPendingInviteCookie, PENDING_INVITE_COOKIE } from "@/lib/auth/pending-invite";
import { safeInternalPath } from "@/lib/auth/safe-internal-path";

type AuthCallbackOptions = {
  inviteToken?: string;
};

function inviteRedirect(url: URL, token: string) {
  const acceptUrl = new URL("/accept-invite", url.origin);
  acceptUrl.searchParams.set("token", token);
  const response = NextResponse.redirect(acceptUrl);
  clearPendingInviteCookie(response);
  return response;
}

export async function handleAuthCallback(req: NextRequest, options: AuthCallbackOptions = {}) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = safeInternalPath(url.searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      if (options.inviteToken) {
        return inviteRedirect(url, options.inviteToken);
      }

      const pendingInviteToken = req.cookies.get(PENDING_INVITE_COOKIE)?.value;

      if (pendingInviteToken) {
        return inviteRedirect(url, pendingInviteToken);
      }

      return NextResponse.redirect(new URL(next, url.origin));
    }
  }

  const failedUrl = new URL("/login", url.origin);
  failedUrl.searchParams.set("error", next === "/reset-password" ? "recovery_failed" : "auth_failed");
  failedUrl.searchParams.set("next", next);
  return NextResponse.redirect(failedUrl);
}
