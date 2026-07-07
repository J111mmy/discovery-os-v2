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
type AccessGateResult =
  | { kind: "status"; status: AccessStatus }
  | { kind: "unavailable"; reason: "timeout" | "rpc_error" | "invalid_status" };

const ACCESS_STATUS_TIMEOUT_MS = 1500;

function accessPath(status: AccessStatus) {
  if (status === "suspended") return "/access-suspended";
  if (status === "declined") return "/access-declined";
  if (status === "pending") return "/access-pending";
  return "/projects";
}

function isAccessStatus(value: unknown): value is AccessStatus {
  return value === "active" || value === "pending" || value === "declined" || value === "suspended";
}

async function getAccessGateResult(
  supabase: ReturnType<typeof createServerClient>
): Promise<AccessGateResult> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<AccessGateResult>((resolve) => {
    timeoutId = setTimeout(
      () => resolve({ kind: "unavailable", reason: "timeout" }),
      ACCESS_STATUS_TIMEOUT_MS
    );
  });

  const rpc = Promise.resolve(supabase.rpc("current_access_status"))
    .then(({ data, error }) => {
      if (error) {
        console.error("[access-gate] current_access_status failed", {
          message: error.message,
        });
        return { kind: "unavailable", reason: "rpc_error" } as const;
      }

      if (!isAccessStatus(data)) {
        console.error("[access-gate] current_access_status returned invalid status", {
          status: data,
        });
        return { kind: "unavailable", reason: "invalid_status" } as const;
      }

      return { kind: "status", status: data } as const;
    })
    .catch((error) => {
      console.error("[access-gate] current_access_status threw", {
        message: error instanceof Error ? error.message : String(error),
      });
      return { kind: "unavailable", reason: "rpc_error" } as const;
    });

  try {
    return await Promise.race([rpc, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
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
    path.startsWith("/access-unavailable") ||
    path.startsWith("/callback") ||
    path.startsWith("/api/access-requests") ||
    path.startsWith("/api/auth/sign-out") ||
    path.startsWith("/api/auth/signout") ||
    path.startsWith("/api/inngest"); // Inngest sync requires no auth cookies

  if (!user && !isPublic) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (user && !isPublic) {
    const gate = await getAccessGateResult(supabase);

    if (gate.kind === "unavailable") {
      return NextResponse.redirect(new URL("/access-unavailable", request.url));
    }

    if (gate.status !== "active") {
      return NextResponse.redirect(new URL(accessPath(gate.status), request.url));
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
