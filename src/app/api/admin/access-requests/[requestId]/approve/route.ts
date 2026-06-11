import { sendInviteEmail } from "@/lib/email/invite";
import { isSuperAdmin } from "@/lib/auth/super-admin";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const ApproveSchema = z.object({
  org_id: z.string().uuid(),
  role: z.enum(["admin", "member"]).default("member"),
  note: z.string().trim().max(1000).optional().nullable(),
});

async function requireSuperAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return { ok: false as const, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!(await isSuperAdmin(user.id))) {
    return { ok: false as const, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { ok: true as const, user };
}

function inviterName(user: { email?: string; user_metadata?: Record<string, unknown> }) {
  const value = user.user_metadata?.full_name ?? user.user_metadata?.name;
  return typeof value === "string" && value.trim() ? value.trim() : user.email;
}

export async function POST(req: NextRequest, { params }: { params: { requestId: string } }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  const parsed = ApproveSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: accessRequest, error: requestError } = await service
    .from("access_requests")
    .select("id, name, email, status")
    .eq("id", params.requestId)
    .single();

  if (requestError || !accessRequest) {
    return NextResponse.json({ error: "Access request not found" }, { status: 404 });
  }

  if (accessRequest.status !== "pending") {
    return NextResponse.json({ error: "Access request already reviewed" }, { status: 409 });
  }

  const { data: org } = await service
    .from("orgs")
    .select("id, name")
    .eq("id", parsed.data.org_id)
    .single();

  if (!org) {
    return NextResponse.json({ error: "Organisation not found" }, { status: 404 });
  }

  const { data: invite, error: inviteError } = await service
    .from("org_invites")
    .insert({
      org_id: org.id,
      email: accessRequest.email,
      role: parsed.data.role,
    })
    .select("id, token, email, role, expires_at")
    .single();

  if (inviteError || !invite) {
    return NextResponse.json(
      { error: inviteError?.message ?? "Failed to create invite" },
      { status: 500 }
    );
  }

  const appOrigin = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  const acceptUrl = `${appOrigin}/invite/${encodeURIComponent(invite.token)}`;

  try {
    await sendInviteEmail({
      to: invite.email,
      acceptUrl,
      orgName: org.name,
      inviterName: inviterName(auth.user),
      role: invite.role,
    });
  } catch (error) {
    await service.from("org_invites").delete().eq("id", invite.id);
    const message = error instanceof Error ? error.message : "Unknown email send failure";
    return NextResponse.json({ error: `Invite email failed: ${message}` }, { status: 500 });
  }

  const { data: reviewed, error: reviewError } = await service
    .from("access_requests")
    .update({
      status: "approved",
      reviewed_at: new Date().toISOString(),
      reviewed_by: auth.user.id,
      review_note: parsed.data.note?.trim() || null,
      invite_id: invite.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", accessRequest.id)
    .eq("status", "pending")
    .select("id, status, reviewed_at, invite_id")
    .single();

  if (reviewError || !reviewed) {
    await service.from("org_invites").delete().eq("id", invite.id);
    return NextResponse.json(
      { error: reviewError?.message ?? "Failed to mark request approved" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    request: reviewed,
    invite: {
      id: invite.id,
      email: invite.email,
      role: invite.role,
      expires_at: invite.expires_at,
    },
  });
}
