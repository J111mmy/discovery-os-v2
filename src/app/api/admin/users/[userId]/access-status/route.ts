import { isSuperAdmin } from "@/lib/auth/super-admin";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const StatusSchema = z.object({
  status: z.enum(["active", "suspended"]),
  reason: z.string().trim().max(1000).optional().nullable(),
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

export async function POST(req: NextRequest, { params }: { params: { userId: string } }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  const parsed = StatusSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const service = createServiceClient();

  const { data: userLookup, error: userError } = await service.auth.admin.getUserById(params.userId);
  if (userError || !userLookup.user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const now = new Date().toISOString();
  const { data, error } = await service
    .from("user_access_status")
    .upsert(
      {
        user_id: params.userId,
        status: parsed.data.status,
        reason: parsed.data.reason?.trim() || null,
        updated_by: auth.user.id,
        updated_at: now,
      },
      { onConflict: "user_id" }
    )
    .select("user_id, status, reason, updated_at")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to update access status" },
      { status: 500 }
    );
  }

  return NextResponse.json({ user: data });
}
