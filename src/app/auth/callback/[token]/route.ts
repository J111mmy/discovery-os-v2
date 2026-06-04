import { handleAuthCallback } from "@/lib/auth/callback";
import { NextRequest } from "next/server";

interface Props {
  params: {
    token: string;
  };
}

export async function GET(req: NextRequest, { params }: Props) {
  return handleAuthCallback(req, { inviteToken: params.token });
}
