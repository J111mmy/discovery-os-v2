import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/auth/org";
import { redirect } from "next/navigation";
import { SettingsClient } from "./SettingsClient";

export const metadata = { title: "Settings — DiscOS" };

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const orgId = await getActiveOrgId(user.id);

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

  if (orgId) {
    // Org name
    const { data: orgData } = await supabase
      .from("orgs")
      .select("name")
      .eq("id", orgId)
      .maybeSingle();
    if (orgData?.name) orgName = orgData.name;

    // Members — graceful degradation if RLS blocks
    const { data: membersData } = await supabase
      .from("org_members")
      .select("id, user_id, display_name, role, joined_at")
      .eq("org_id", orgId)
      .order("joined_at", { ascending: true });
    if (membersData) members = membersData;

    // Pending invites
    const { data: invitesData } = await supabase
      .from("org_invites")
      .select("id, email, role, expires_at, accepted_at")
      .eq("org_id", orgId)
      .is("accepted_at", null);
    if (invitesData) invites = invitesData;
  }

  return (
    <SettingsClient
      orgId={orgId ?? ""}
      orgName={orgName}
      userEmail={user.email ?? ""}
      members={members}
      invites={invites}
    />
  );
}
