import { createClient } from "@/lib/supabase/server";
import { IMPERSONATE_COOKIE } from "@/lib/auth/super-admin";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  const response = NextResponse.redirect(new URL("/login", req.url));
  response.cookies.delete(IMPERSONATE_COOKIE);
  return response;
}
