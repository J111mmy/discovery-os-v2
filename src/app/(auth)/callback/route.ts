import { handleAuthCallback } from "@/lib/auth/callback";
import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  return handleAuthCallback(req);
}
