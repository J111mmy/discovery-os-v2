import { createClient } from "@/lib/supabase/server";
import { setActiveOrgId } from "@/lib/auth/org";
import Link from "next/link";
import { redirect } from "next/navigation";

interface Props {
  searchParams?: { token?: string };
}

function InviteMessage({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--surface-0)] px-5">
      <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-6">
        <h1 className="text-xl font-semibold text-[var(--ink)]">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">{body}</p>
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

export default async function AcceptInvitePage({ searchParams }: Props) {
  const token = searchParams?.token;

  if (!token) {
    return <InviteMessage title="Invite not found" body="This invite link is missing a token." />;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/accept-invite?token=${token}`)}`);
  }

  const { data: invite } = await supabase
    .from("org_invites")
    .select("id, org_id, email, role, accepted_at, expires_at")
    .eq("token", token)
    .single();

  if (!invite) {
    return <InviteMessage title="Invite not found" body="This invite may have expired or already been accepted." />;
  }

  if (invite.accepted_at) {
    redirect("/projects");
  }

  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return <InviteMessage title="Invite expired" body="Ask an owner or admin to send a fresh invitation." />;
  }

  if (user.email?.toLowerCase() !== invite.email.toLowerCase()) {
    return (
      <InviteMessage
        title="Wrong account"
        body={`This invite was sent to ${invite.email}. Sign in with that email to accept it.`}
      />
    );
  }

  const { data: existingMember } = await supabase
    .from("org_members")
    .select("id, org_id, user_id")
    .eq("org_id", invite.org_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!existingMember) {
    await supabase.from("org_members").insert({
      org_id: invite.org_id,
      user_id: user.id,
      role: invite.role,
      display_name: user.user_metadata?.full_name ?? user.email ?? null,
    });
  }

  await supabase
    .from("org_invites")
    .update({ accepted_at: new Date().toISOString() })
    .eq("org_id", invite.org_id)
    .eq("id", invite.id);

  await setActiveOrgId(invite.org_id);

  redirect("/projects");
}
