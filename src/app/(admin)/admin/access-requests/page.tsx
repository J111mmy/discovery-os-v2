// /admin/access-requests — review public interest-form submissions.
import { createClient } from "@/lib/supabase/server";
import { getAllOrgsWithStats, isSuperAdmin } from "@/lib/auth/super-admin";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AccessRequestsClient } from "./access-requests-client";

export default async function AccessRequestsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  if (!(await isSuperAdmin(user.id))) redirect("/projects");

  const orgs = await getAllOrgsWithStats();
  const orgOptions = orgs.map((org) => ({
    id: org.id,
    name: org.name,
    slug: org.slug,
  }));

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/admin"
          className="mb-3 inline-flex text-xs text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]"
        >
          ← All organisations
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--ink)]">
              Access requests
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-[var(--ink-2)]">
              Review public interest-form submissions and send approved users a
              workspace invite.
            </p>
          </div>
          <span className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1 text-xs font-medium text-[var(--ink-2)]">
            Super admin only
          </span>
        </div>
      </div>

      <AccessRequestsClient orgs={orgOptions} />
    </div>
  );
}
