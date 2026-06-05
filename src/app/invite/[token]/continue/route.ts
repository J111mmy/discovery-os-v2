import { createInviteActionLink } from "@/lib/auth/invite-action-link";
import { createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

interface Props {
  params: {
    token: string;
  };
}

function statusRedirect(req: NextRequest, status: string) {
  const url = new URL("/accept-invite/status", req.url);
  url.searchParams.set("status", status);
  return NextResponse.redirect(url, 303);
}

export async function POST(req: NextRequest, { params }: Props) {
  const token = params.token;

  if (!token) {
    return statusRedirect(req, "missing-token");
  }

  const serviceSupabase = createServiceClient();
  const { data: invite, error } = await serviceSupabase
    .from("org_invites")
    .select("email, expires_at, accepted_at")
    .eq("token", token)
    .single();

  if (error || !invite) {
    return statusRedirect(req, "not-found");
  }

  if (invite.accepted_at) {
    return statusRedirect(req, "already-accepted");
  }

  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return statusRedirect(req, "expired");
  }

  const requestOrigin = new URL(req.url).origin;
  const appOrigin = process.env.NEXT_PUBLIC_APP_URL || requestOrigin;
  const redirectTo = `${appOrigin}/auth/callback/${encodeURIComponent(token)}`;

  try {
    const actionLink = await createInviteActionLink(invite.email, redirectTo);
    return NextResponse.redirect(actionLink, 303);
  } catch {
    return statusRedirect(req, "insert-failed");
  }
}
