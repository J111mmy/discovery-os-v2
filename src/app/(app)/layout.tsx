import { createClient } from "@/lib/supabase/server";
import { getImpersonatedOrgName } from "@/lib/auth/super-admin";
import Link from "next/link";
import { redirect } from "next/navigation";

interface AppLayoutProps {
  children: React.ReactNode;
}

const navItems = [
  { href: "/projects", label: "Projects" },
  { href: "/people", label: "People" },
  { href: "/companies", label: "Companies" },
  { href: "/competitors", label: "Competitors" },
];

export default async function AppLayout({ children }: AppLayoutProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Check if super admin is browsing as a specific org
  const impersonation = await getImpersonatedOrgName(user.id);

  return (
    <div className="min-h-screen bg-[var(--surface-0)] text-[var(--ink)]">
      {/* Support mode banner — only shown during impersonation */}
      {impersonation && (
        <div className="sticky top-0 z-40 flex items-center justify-between bg-red-600 px-5 py-2 text-xs font-medium text-white sm:px-8">
          <span>
            🛟 Support mode — viewing as <strong>{impersonation.orgName}</strong>
          </span>
          <form method="DELETE" action="/api/admin/impersonate">
            <button
              type="submit"
              className="rounded border border-white/40 px-2.5 py-1 text-xs font-semibold transition-colors hover:bg-white/20"
            >
              Exit
            </button>
          </form>
        </div>
      )}

      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--surface-0)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3 sm:px-8">
          <Link href="/projects" className="text-sm font-semibold text-[var(--ink)]">
            DiscOS
          </Link>
          <nav className="flex items-center gap-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--ink-muted)] transition-colors hover:bg-[var(--surface-1)] hover:text-[var(--ink)]"
              >
                {item.label}
              </Link>
            ))}
            {impersonation && (
              <Link
                href="/admin"
                className="ml-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20"
              >
                Admin ↗
              </Link>
            )}
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}
