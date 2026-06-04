import type { NextResponse } from "next/server";

export const PENDING_INVITE_COOKIE = "disco_pending_invite";
export const PENDING_INVITE_MAX_AGE_SECONDS = 60 * 60;

export function setPendingInviteCookie(response: NextResponse, token: string) {
  response.cookies.set(PENDING_INVITE_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: PENDING_INVITE_MAX_AGE_SECONDS,
    path: "/",
  });
}

export function clearPendingInviteCookie(response: NextResponse) {
  response.cookies.set(PENDING_INVITE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: "/",
  });
}
