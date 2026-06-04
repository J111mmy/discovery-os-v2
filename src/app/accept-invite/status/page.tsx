import Link from "next/link";

interface Props {
  searchParams?: {
    status?: string;
    email?: string;
  };
}

const messages: Record<string, { title: string; body: string }> = {
  "missing-token": {
    title: "Invite not found",
    body: "This invite link is missing a token.",
  },
  "not-found": {
    title: "Invite not found",
    body: "This invite may have expired or already been accepted.",
  },
  "already-accepted": {
    title: "Invite already accepted",
    body: "This invite has already been used. Go to projects to continue.",
  },
  expired: {
    title: "Invite expired",
    body: "Ask an owner or admin to send a fresh invitation.",
  },
  "insert-failed": {
    title: "Invite could not be accepted",
    body: "We couldn't add you to this workspace. Ask an owner or admin to resend the invite, or contact support.",
  },
  "finish-failed": {
    title: "Invite partly accepted",
    body: "You were added to the workspace, but we couldn't finish updating the invite record. Go to projects, or contact support if the workspace is missing.",
  },
};

export default function AcceptInviteStatusPage({ searchParams }: Props) {
  const status = searchParams?.status ?? "not-found";
  const email = searchParams?.email;
  const message =
    status === "wrong-account"
      ? {
          title: "Wrong account",
          body: email
            ? `This invite was sent to ${email}. Sign in with that email to accept it.`
            : "Sign in with the email address this invite was sent to.",
        }
      : messages[status] ?? messages["not-found"];

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--surface-0)] px-5">
      <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-6">
        <h1 className="text-xl font-semibold text-[var(--ink)]">{message.title}</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">{message.body}</p>
        <Link
          href="/projects"
          className="mt-5 inline-flex rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-dim)]"
        >
          Go to projects
        </Link>
      </div>
    </div>
  );
}
