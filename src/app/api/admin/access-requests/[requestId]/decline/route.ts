import { isSuperAdmin } from "@/lib/auth/super-admin";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const DeclineSchema = z.object({
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

export async function POST(req: NextRequest, { params }: { params: { requestId: string } }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  const parsed = DeclineSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from("access_requests")
    .update({
      status: "declined",
      reviewed_at: new Date().toISOString(),
      reviewed_by: auth.user.id,
      review_note: parsed.data.note?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.requestId)
    .eq("status", "pending")
    .select("id, status, reviewed_at")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Access request not found or already reviewed" },
      { status: 404 }
    );
  }

  return NextResponse.json({ request: data });
}
