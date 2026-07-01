import { sendInviteEmail } from "@/lib/email/invite";
import { isSuperAdmin } from "@/lib/auth/super-admin";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const CustomerInviteSchema = z.object({
  email: z.string().trim().email().max(320),
  org_name: z.string().trim().min(1).max(180),
});

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

  if (error || !user) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (!(await isSuperAdmin(user.id))) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { ok: true as const, user };
}

function inviterName(user: { email?: string; user_metadata?: Record<string, unknown> }) {
  const value = user.user_metadata?.full_name ?? user.user_metadata?.name;
  return typeof value === "string" && value.trim() ? value.trim() : user.email;
}

export async function POST(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  const parsed = CustomerInviteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: provisionRows, error: provisionError } = await service.rpc(
    "provision_customer_org",
    {
      p_org_name: parsed.data.org_name,
      p_email: parsed.data.email,
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

  const appOrigin = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
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

  return NextResponse.json({
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
