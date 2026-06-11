// Supabase auth middleware — refreshes session on every request
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";

type CookieToSet = {
  name: string;
  value: string;
  options: CookieOptions;
};

type AccessStatus = "active" | "pending" | "declined" | "suspended";

function accessPath(status: AccessStatus) {
  if (status === "suspended") return "/access-suspended";
  if (status === "declined") return "/access-declined";
  if (status === "pending") return "/access-pending";
  return "/projects";
}

function isAccessStatus(value: unknown): value is AccessStatus {
  return value === "active" || value === "pending" || value === "declined" || value === "suspended";
}

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session — required for Server Components to read auth state
  const { data: { user } } = await supabase.auth.getUser();

  // Redirect unauthenticated users away from protected routes
  const path = request.nextUrl.pathname;
  const isPublic =
    path.startsWith("/login") ||
    path.startsWith("/auth") ||
    path.startsWith("/invite") ||
    path.startsWith("/accept-invite") ||
    path.startsWith("/request-access") ||
    path.startsWith("/access-pending") ||
    path.startsWith("/access-declined") ||
    path.startsWith("/access-suspended") ||
    path.startsWith("/callback") ||
    path.startsWith("/api/access-requests") ||
    path.startsWith("/api/auth/sign-out") ||
    path.startsWith("/api/auth/signout") ||
    path.startsWith("/api/inngest"); // Inngest sync requires no auth cookies

  if (!user && !isPublic) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (user && !isPublic) {
    const { data, error } = await supabase.rpc("current_access_status");
    const status = isAccessStatus(data) ? data : error ? "pending" : "pending";

    if (status !== "active") {
      return NextResponse.redirect(new URL(accessPath(status), request.url));
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
