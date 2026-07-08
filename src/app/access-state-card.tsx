import Link from "next/link";

export default function AccessStateCard({
  title,
  body,
  actionHref,
  actionLabel,
  signOutLabel = "Sign out",
}: {
  title: string;
  body: string;
  actionHref?: string;
  actionLabel?: string;
  signOutLabel?: string;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] px-5 text-[var(--ink)]">
      <div className="w-full max-w-md rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent)] text-lg font-bold text-white">
            D
          </div>
          <div>
            <div className="text-base font-semibold">DiscOS</div>
            <div className="text-xs text-[var(--ink-2)]">Evidence workspace</div>
          </div>
        </div>

        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--ink-2)]">{body}</p>

        <div className="mt-6 flex flex-wrap gap-3">
          {actionHref && actionLabel ? (
            <Link
              href={actionHref}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              {actionLabel}
            </Link>
          ) : null}

          <form method="POST" action="/api/auth/sign-out">
            <button
              type="submit"
              className="rounded-lg border border-[var(--line)] px-4 py-2 text-sm font-medium text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]"
            >
              {signOutLabel}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
