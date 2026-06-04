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

  const { data: invite, error: inviteError } = await supabase
    .from("org_invites")
    .select("id, org_id, email, role, accepted_at, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (inviteError || !invite) {
    return statusRedirect(req, "not-found");
  }

  if (invite.accepted_at) {
    return statusRedirect(req, "already-accepted");
  }

  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return statusRedirect(req, "expired");
  }

  if (user.email?.toLowerCase() !== invite.email.toLowerCase()) {
    return statusRedirect(req, "wrong-account", { email: invite.email });
  }

  const { data: existingMember, error: memberLookupError } = await supabase
    .from("org_members")
    .select("id, org_id, user_id")
    .eq("org_id", invite.org_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (memberLookupError) {
    return statusRedirect(req, "insert-failed");
  }

  if (!existingMember) {
    const { error: insertError } = await supabase.from("org_members").insert({
      org_id: invite.org_id,
      user_id: user.id,
      role: invite.role,
      display_name: user.user_metadata?.full_name ?? user.email ?? null,
    });

    if (insertError) {
      return statusRedirect(req, "insert-failed");
    }
  }

  const { error: updateError } = await supabase
    .from("org_invites")
    .update({ accepted_at: new Date().toISOString() })
    .eq("org_id", invite.org_id)
    .eq("id", invite.id);

  if (updateError) {
    return statusRedirect(req, "finish-failed");
  }

  return projectsRedirect(req, invite.org_id);
}
