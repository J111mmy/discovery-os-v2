// POST /api/admin/impersonate — set impersonation cookie, redirect to /projects
// DELETE /api/admin/impersonate — clear cookie, redirect to /admin
// Only callable by super admins. Cookie is HttpOnly, SameSite=Lax.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSuperAdmin, IMPERSONATE_COOKIE } from "@/lib/auth/super-admin";

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  // Session cookie — expires when browser closes. No persistent impersonation.
};

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  if (!(await isSuperAdmin(user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.formData();
  const orgId = body.get("org_id");

  if (!orgId || typeof orgId !== "string") {
    return NextResponse.json({ error: "org_id required" }, { status: 400 });
  }

  // Validate the org actually exists
  const { createServiceClient } = await import("@/lib/supabase/server");
  const serviceSupabase = createServiceClient();
  const { data: org } = await serviceSupabase
    .from("orgs")
    .select("id")
    .eq("id", orgId)
    .single();

  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 });

  const response = NextResponse.redirect(new URL("/projects", req.url));
  response.cookies.set(IMPERSONATE_COOKIE, orgId, COOKIE_OPTIONS);
  return response;
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  if (!(await isSuperAdmin(user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const response = NextResponse.redirect(new URL("/admin", req.url));
  response.cookies.delete(IMPERSONATE_COOKIE);
  return response;
}
