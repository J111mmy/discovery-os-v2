// Admin layout — super admin only. No impersonation active here.
import { createClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/auth/super-admin";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const admin = await isSuperAdmin(user.id);
  if (!admin) redirect("/projects");

  return (
    <div className="min-h-screen bg-[var(--surface-0)] text-[var(--ink)]">
      <header className="sticky top-0 z-30 border-b border-red-900/40 bg-red-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3 sm:px-8">
          <div className="flex items-center gap-3">
            <span className="rounded bg-red-600 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-white">
              Super admin
            </span>
            <Link href="/admin" className="text-sm font-semibold text-white">
              DiscOS Admin
            </Link>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/projects"
              className="text-xs font-medium text-red-300 transition-colors hover:text-white"
            >
              ← Back to app
            </Link>
            <form method="POST" action="/api/auth/sign-out">
              <button
                type="submit"
                className="rounded-lg border border-red-400/40 px-3 py-1.5 text-xs font-medium text-red-200 transition-colors hover:border-red-200 hover:text-white"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
        {children}
      </main>
    </div>
  );
}
