import { createClient } from "@/lib/supabase/server";
import { getOrgScopedReadForUser } from "@/lib/auth/support-read";
import { redirect } from "next/navigation";
import { SettingsClient } from "./SettingsClient";

export const metadata = { title: "Settings — DiscOS" };

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const read = await getOrgScopedReadForUser(user.id, supabase);
  const orgId = read?.orgId ?? null;

  let orgName = "My Organization";
  let members: {
    id: string;
    user_id: string;
    display_name: string | null;
    role: string;
    joined_at: string;
  }[] = [];
  let invites: {
    id: string;
    email: string;
    role: string;
    expires_at: string | null;
    accepted_at: string | null;
  }[] = [];
  let currentUserRole: string | null = null;

  if (read) {
    // Org name
    const { data: orgData } = await read
      .org("name")
      .maybeSingle();
    if (orgData?.name) orgName = orgData.name;

    // Members — graceful degradation if RLS blocks
    const { data: membersData } = await read
      .from("org_members")
      .select("id, user_id, display_name, role, joined_at")
      .order("joined_at", { ascending: true });
    if (membersData) {
      members = membersData;
      currentUserRole = members.find((member) => member.user_id === user.id)?.role ?? null;
    }

    // Pending invites
    const { data: invitesData } = await read
      .from("org_invites")
      .select("id, email, role, expires_at, accepted_at")
      .is("accepted_at", null);
    if (invitesData) invites = invitesData;
  }

  return (
    <SettingsClient
      orgId={orgId ?? ""}
      orgName={orgName}
      userEmail={user.email ?? ""}
      currentUserRole={currentUserRole}
      members={members}
      invites={invites}
    />
  );
}
