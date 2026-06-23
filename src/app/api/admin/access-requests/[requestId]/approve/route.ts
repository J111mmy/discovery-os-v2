import { sendInviteEmail } from "@/lib/email/invite";
import { isSuperAdmin } from "@/lib/auth/super-admin";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const NewOrgApproveSchema = z.object({
  mode: z.literal("new_org"),
  org_name: z.string().trim().min(1).max(180),
  role: z.literal("owner").default("owner"),
  note: z.string().trim().max(1000).optional().nullable(),
});

const ExistingOrgApproveSchema = z.object({
  mode: z.literal("existing_org").default("existing_org"),
  org_id: z.string().uuid(),
  role: z.enum(["admin", "member"]).default("member"),
  note: z.string().trim().max(1000).optional().nullable(),
});

const ApproveSchema = z.union([NewOrgApproveSchema, ExistingOrgApproveSchema]);

type ProvisionedOrgInvite = {
  org_id: string;
  org_name: string;
  org_slug: string;
  invite_id: string;
  invite_token: string;
  invite_email: string;
  invite_role: "owner";
  expires_at: string;
};

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

async function markApproved(input: {
  requestId: string;
  reviewerId: string;
  note?: string | null;
  inviteId: string;
}) {
  const service = createServiceClient();
  return service
    .from("access_requests")
    .update({
      status: "approved",
      reviewed_at: new Date().toISOString(),
      reviewed_by: input.reviewerId,
      review_note: input.note?.trim() || null,
      invite_id: input.inviteId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.requestId)
    .eq("status", "pending")
    .select("id, status, reviewed_at, invite_id")
    .single();
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
    .select("id, name, email, company, status")
    .eq("id", params.requestId)
    .single();

  if (requestError || !accessRequest) {
    return NextResponse.json({ error: "Access request not found" }, { status: 404 });
  }

  if (accessRequest.status !== "pending") {
    return NextResponse.json({ error: "Access request already reviewed" }, { status: 409 });
  }

  const appOrigin = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;

  if (parsed.data.mode === "new_org") {
    const { data: provisionRows, error: provisionError } = await service.rpc(
      "provision_customer_org",
      {
        p_org_name: parsed.data.org_name,
        p_email: accessRequest.email,
      }
    );
    const provision = Array.isArray(provisionRows)
      ? (provisionRows[0] as ProvisionedOrgInvite | undefined)
      : (provisionRows as ProvisionedOrgInvite | null);

    if (provisionError || !provision) {
      return NextResponse.json(
        { error: provisionError?.message ?? "Failed to provision organisation" },
        { status: 500 }
      );
    }

    const acceptUrl = `${appOrigin}/invite/${encodeURIComponent(provision.invite_token)}`;

    try {
      await sendInviteEmail({
        to: provision.invite_email,
        acceptUrl,
        orgName: provision.org_name,
        inviterName: inviterName(auth.user),
        role: provision.invite_role,
      });
    } catch (error) {
      await service.from("orgs").delete().eq("id", provision.org_id);
      const message = error instanceof Error ? error.message : "Unknown email send failure";
      return NextResponse.json({ error: `Invite email failed: ${message}` }, { status: 500 });
    }

    const { data: reviewed, error: reviewError } = await markApproved({
      requestId: accessRequest.id,
      reviewerId: auth.user.id,
      note: parsed.data.note,
      inviteId: provision.invite_id,
    });

    if (reviewError || !reviewed) {
      await service.from("orgs").delete().eq("id", provision.org_id);
      return NextResponse.json(
        { error: reviewError?.message ?? "Failed to mark request approved" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      request: reviewed,
      org: {
        id: provision.org_id,
        name: provision.org_name,
        slug: provision.org_slug,
      },
      invite: {
        id: provision.invite_id,
        email: provision.invite_email,
        role: provision.invite_role,
        expires_at: provision.expires_at,
      },
    });
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

  const { data: reviewed, error: reviewError } = await markApproved({
    requestId: accessRequest.id,
    reviewerId: auth.user.id,
    note: parsed.data.note,
    inviteId: invite.id,
  });

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
