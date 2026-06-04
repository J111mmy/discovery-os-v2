import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ACTIVE_ORG_COOKIE } from "@/lib/auth/org";
import {
  clearPendingInviteCookie,
  PENDING_INVITE_COOKIE,
  setPendingInviteCookie,
} from "@/lib/auth/pending-invite";
import { createClient } from "@/lib/supabase/server";

type InviteStatus =
  | "missing-token"
  | "not-found"
  | "already-accepted"
  | "expired"
  | "wrong-account"
  | "insert-failed"
  | "finish-failed";

type AcceptInviteStatus =
  | "accepted"
  | "already-member"
  | "already-accepted"
  | "not-authenticated"
  | "not-found"
  | "expired"
  | "wrong-account";

type AcceptInviteResult = {
  status: AcceptInviteStatus;
  org_id: string | null;
  message: string | null;
};

function statusRedirect(req: NextRequest, status: InviteStatus, params?: Record<string, string>) {
  const url = new URL("/accept-invite/status", req.url);
  url.searchParams.set("status", status);
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }

  const response = NextResponse.redirect(url);
  clearPendingInviteCookie(response);
  return response;
}

function projectsRedirect(req: NextRequest, orgId: string) {
  const response = NextResponse.redirect(new URL("/projects", req.url));
  response.cookies.set(ACTIVE_ORG_COOKIE, orgId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  clearPendingInviteCookie(response);
  return response;
}

function loginRedirect(req: NextRequest, token: string) {
  const url = new URL("/login", req.url);
  url.searchParams.set("next", "/accept-invite");

  const response = NextResponse.redirect(url);
  setPendingInviteCookie(response, token);
  return response;
}

export async function GET(req: NextRequest) {
  const cookieStore = await cookies();
  const url = new URL(req.url);
  const queryToken = url.searchParams.get("token");
  const token =
    queryToken && queryToken.length > 0
      ? queryToken
      : cookieStore.get(PENDING_INVITE_COOKIE)?.value;

  if (!token) {
    return statusRedirect(req, "missing-token");
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return loginRedirect(req, token);
  }

  const { data, error } = await supabase.rpc("accept_invite", { p_token: token });
  const result = (Array.isArray(data) ? data[0] : data) as AcceptInviteResult | undefined;

  if (error || !result) {
    return statusRedirect(req, "insert-failed");
  }

  if (result.status === "accepted" || result.status === "already-member") {
    if (!result.org_id) {
      return statusRedirect(req, "finish-failed");
    }

    return projectsRedirect(req, result.org_id);
  }

  if (result.status === "not-authenticated") {
    return loginRedirect(req, token);
  }

  if (result.status === "not-found") {
    return statusRedirect(req, "not-found");
  }

  if (result.status === "already-accepted") {
    return statusRedirect(req, "already-accepted");
  }

  if (result.status === "expired") {
    return statusRedirect(req, "expired");
  }

  if (result.status === "wrong-account") {
    return statusRedirect(req, "wrong-account");
  }

  return statusRedirect(req, "insert-failed");
}
