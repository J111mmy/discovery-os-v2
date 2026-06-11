import { isSuperAdmin } from "@/lib/auth/super-admin";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type AuthUserSummary = {
  id: string;
  email?: string;
  user_metadata?: { full_name?: string; name?: string };
};

type OrgRow = {
  id: string;
  name: string;
  slug: string | null;
};

type MemberRow = {
  org_id: string;
  user_id: string;
  role: string;
  display_name: string | null;
  joined_at: string;
};

type AccessStatusRow = {
  user_id: string;
  status: string;
  reason: string | null;
  updated_at: string | null;
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

function displayName(user: AuthUserSummary | undefined, fallback: string | null) {
  return user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? fallback ?? user?.email ?? null;
}

export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  const service = createServiceClient();

  const [pendingResult, reviewedResult, membersResult, orgsResult, statusResult, usersResult] =
    await Promise.all([
      service
        .from("access_requests")
        .select("id, name, email, phone, company, reason, status, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(100),
      service
        .from("access_requests")
        .select("id, name, email, phone, company, reason, status, created_at, reviewed_at, reviewed_by, invite_id")
        .neq("status", "pending")
        .order("reviewed_at", { ascending: false, nullsFirst: false })
        .limit(20),
      service
        .from("org_members")
        .select("org_id, user_id, role, display_name, joined_at")
        .order("joined_at", { ascending: false })
        .limit(1000),
      service.from("orgs").select("id, name, slug"),
      service.from("user_access_status").select("user_id, status, reason, updated_at"),
      service.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);

  for (const result of [pendingResult, reviewedResult, membersResult, orgsResult, statusResult]) {
    if (result.error) {
      return NextResponse.json({ error: result.error.message }, { status: 500 });
    }
  }

  if (usersResult.error) {
    return NextResponse.json({ error: usersResult.error.message }, { status: 500 });
  }

  const orgRows = (orgsResult.data ?? []) as OrgRow[];
  const memberRows = (membersResult.data ?? []) as MemberRow[];
  const statusRows = (statusResult.data ?? []) as AccessStatusRow[];

  const orgById = new Map(orgRows.map((org) => [org.id, org]));
  const userById = new Map(
    (usersResult.data.users as AuthUserSummary[]).map((user) => [user.id, user])
  );
  const statusByUserId = new Map(statusRows.map((row) => [row.user_id, row]));

  const members = memberRows.map((member) => {
    const user = userById.get(member.user_id);
    const status = statusByUserId.get(member.user_id);
    const org = orgById.get(member.org_id);

    return {
      user_id: member.user_id,
      email: user?.email ?? null,
      display_name: displayName(user, member.display_name),
      org_id: member.org_id,
      org_name: org?.name ?? "Unknown org",
      org_slug: org?.slug ?? null,
      role: member.role,
      access_status: status?.status ?? "active",
      access_reason: status?.reason ?? null,
      access_updated_at: status?.updated_at ?? null,
      joined_at: member.joined_at,
    };
  });

  return NextResponse.json({
    pending: pendingResult.data ?? [],
    reviewed: reviewedResult.data ?? [],
    members,
  });
}
