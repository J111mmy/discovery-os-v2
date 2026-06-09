interface InvitePageProps {
  params: {
    token: string;
  };
}

export default function InvitePage({ params }: InvitePageProps) {
  const action = `/invite/${encodeURIComponent(params.token)}/continue`;

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

        <h1 className="text-xl font-semibold">Accept your invitation</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--ink-2)]">
          Continue to securely sign in and join the workspace.
        </p>

        <form method="POST" action={action}>
          <button
            type="submit"
            className="mt-6 w-full rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-hover)]"
          >
            Continue
          </button>
        </form>
      </div>
    </div>
  );
}
