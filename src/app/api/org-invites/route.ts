import { getProjectForUser } from "@/lib/auth/org";
import { sendInviteEmail } from "@/lib/email/invite";
import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const InviteSchema = z.object({
  project_id: z.string().uuid().optional(),
  org_id: z.string().uuid().optional(),
  email: z.string().email(),
  role: z.enum(["admin", "member"]).default("member"),
}).refine((value) => Boolean(value.project_id) !== Boolean(value.org_id), {
  message: "Provide either project_id or org_id.",
  path: ["project_id"],
});

function getInviterName(user: { user_metadata?: Record<string, unknown> }) {
  const metadataName = user.user_metadata?.full_name ?? user.user_metadata?.name;

  if (typeof metadataName === "string" && metadataName.trim()) {
    return metadataName.trim();
  }

  return undefined;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = InviteSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  let orgId = parsed.data.org_id;

  if (parsed.data.project_id) {
    const project = await getProjectForUser<{ id: string; org_id: string }>(
      user.id,
      parsed.data.project_id,
      "id, org_id"
    );

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    orgId = project.org_id;
  }

  if (!orgId) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  const { data: membership } = await supabase
    .from("org_members")
    .select("id, org_id, user_id, role")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .single();

  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return NextResponse.json({ error: "Only owners and admins can invite teammates" }, { status: 403 });
  }

  const { data: invite, error: inviteError } = await supabase
    .from("org_invites")
    .insert({
      org_id: orgId,
      email: parsed.data.email.toLowerCase(),
      role: parsed.data.role,
    })
    .select("id, org_id, email, role, token, expires_at")
    .single();

  if (inviteError || !invite) {
    return NextResponse.json({ error: inviteError?.message ?? "Failed to create invite" }, { status: 500 });
  }

  const requestOrigin = new URL(req.url).origin;
  const appOrigin = process.env.NEXT_PUBLIC_APP_URL || requestOrigin;
  const acceptUrl = `${appOrigin}/invite/${encodeURIComponent(invite.token)}`;

  const { data: org } = await supabase
    .from("orgs")
    .select("name")
    .eq("id", orgId)
    .single();

  try {
    await sendInviteEmail({
      to: invite.email,
      acceptUrl,
      orgName: org?.name ?? "your DiscOS workspace",
      inviterName: getInviterName(user),
      role: invite.role,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown email send failure";
    return NextResponse.json(
      { error: `Invite created, but email send failed: ${message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    invite: {
      id: invite.id,
      email: invite.email,
      role: invite.role,
      expires_at: invite.expires_at,
    },
  });
}
