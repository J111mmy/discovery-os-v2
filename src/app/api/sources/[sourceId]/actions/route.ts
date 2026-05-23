import { createClient } from "@/lib/supabase/server";
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
    return { supabase, orgId: null, status: 401 as const };
  }

  const { data: membership } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", user.id)
    .order("joined_at", { ascending: true })
    .limit(1)
    .single();

  if (!membership?.org_id) {
    return { supabase, orgId: null, status: 403 as const };
  }

  return { supabase, orgId: membership.org_id as string, status: null };
}

export async function GET(_req: NextRequest, { params }: Props) {
  const { supabase, orgId, status } = await getUserOrgId();

  if (status === 401) {
    return NextResponse.json({ error: "Unauthorized" }, { status });
  }

  if (status === 403 || !orgId) {
    return NextResponse.json({ error: "No org" }, { status: 403 });
  }

  const [actionsResult, requestsResult] = await Promise.all([
    supabase
      .from("actions")
      .select("id, description, owner, due_note, status, created_at")
      .eq("org_id", orgId)
      .eq("source_id", params.sourceId)
      .order("created_at", { ascending: true }),
    supabase
      .from("product_requests")
      .select("id, description, requester_name, priority_signal, status, created_at")
      .eq("org_id", orgId)
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
