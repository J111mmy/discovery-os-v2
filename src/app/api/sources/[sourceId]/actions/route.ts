import { createClient } from "@/lib/supabase/server";
import { getOrgScopedReadForUser } from "@/lib/auth/support-read";
import { NextRequest, NextResponse } from "next/server";

interface Props {
  params: { sourceId: string };
}

async function getUserOrgId() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { read: null, status: 401 as const };
  }

  const read = await getOrgScopedReadForUser(user.id, supabase);

  if (!read) {
    return { read: null, status: 403 as const };
  }

  return { read, status: null };
}

export async function GET(_req: NextRequest, { params }: Props) {
  const { read, status } = await getUserOrgId();

  if (status === 401) {
    return NextResponse.json({ error: "Unauthorized" }, { status });
  }

  if (status === 403 || !read) {
    return NextResponse.json({ error: "No org" }, { status: 403 });
  }

  const [actionsResult, requestsResult] = await Promise.all([
    read
      .from("actions")
      .select("id, description, owner, due_note, status, created_at")
      .eq("source_id", params.sourceId)
      .order("created_at", { ascending: true }),
    read
      .from("product_requests")
      .select("id, description, requester_name, priority_signal, status, created_at")
      .eq("source_id", params.sourceId)
      .order("created_at", { ascending: true }),
  ]);

  if (actionsResult.error) {
    return NextResponse.json({ error: actionsResult.error.message }, { status: 500 });
  }

  if (requestsResult.error) {
    return NextResponse.json({ error: requestsResult.error.message }, { status: 500 });
  }

  return NextResponse.json({
    actions: actionsResult.data ?? [],
    product_requests: requestsResult.data ?? [],
  });
}
