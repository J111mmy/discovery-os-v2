import { createClient } from "@/lib/supabase/server";
import { getImpersonatedOrgName, isSuperAdmin } from "@/lib/auth/super-admin";
import Link from "next/link";
import { redirect } from "next/navigation";
import { UserMenu } from "./components/user-menu";

interface AppLayoutProps {
  children: React.ReactNode;
}

// Primary nav — full visual weight
const primaryNavItems = [{ href: "/projects", label: "Projects" }];

// Entity registry — secondary, visually de-emphasised
const directoryItems = [
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

  const superAdmin = await isSuperAdmin(user.id);
  const impersonation = superAdmin ? await getImpersonatedOrgName(user.id) : null;

  return (
    <div className="min-h-screen bg-[var(--surface-0)] text-[var(--ink)]">
      {/* Support mode banner — only shown during impersonation */}
      {impersonation && (
        <div className="sticky top-0 z-40 flex items-center justify-between bg-red-600 px-5 py-2 text-xs font-medium text-white sm:px-8">
          <span>
            🛟 Support mode — viewing as <strong>{impersonation.orgName}</strong>
          </span>
          <form method="POST" action="/api/admin/impersonate">
            <input type="hidden" name="intent" value="exit" />
            <button
              type="submit"
              className="rounded border border-white/40 px-2.5 py-1 text-xs font-semibold transition-colors hover:bg-white/20"
            >
              Exit
            </button>
          </form>
        </div>
      )}

      <header className="sticky top-0 z-30 flex h-14 items-center border-b border-[var(--border)] bg-[var(--surface-0)]/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link href="/projects" className="text-sm font-semibold text-[var(--ink)]">
            DiscOS
          </Link>

          <nav className="flex items-center gap-1">
            {/* Primary nav */}
            {primaryNavItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--ink-muted)] transition-colors hover:bg-[var(--surface-1)] hover:text-[var(--ink)]"
              >
                {item.label}
              </Link>
            ))}

            {/* Directory — visually secondary */}
            <span className="mx-1 hidden text-xs text-[var(--ink-faint)] sm:inline">·</span>
            <div className="hidden items-center gap-0.5 sm:flex">
              {directoryItems.map((item, i) => (
                <span key={item.href} className="flex items-center">
                  <Link
                    href={item.href}
                    className="rounded-md px-2 py-1.5 text-xs font-normal text-[var(--ink-faint)] transition-colors hover:bg-[var(--surface-1)] hover:text-[var(--ink-muted)]"
                  >
                    {item.label}
                  </Link>
                  {i < directoryItems.length - 1 && (
                    <span className="text-xs text-[var(--ink-faint)]">·</span>
                  )}
                </span>
              ))}
            </div>

            {/* Admin badge — super admin only */}
            {superAdmin && (
              <Link
                href="/admin"
                className="ml-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20"
              >
                Admin ↗
              </Link>
            )}

            {/* User avatar — replaces flat Sign out button */}
            <UserMenu email={user.email ?? ""} />
          </nav>
        </div>
      </header>

      {children}
    </div>
  );
}
