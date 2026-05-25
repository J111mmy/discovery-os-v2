import { createServiceClient } from "@/lib/supabase/server";
import { getImpersonatedOrgId, isSuperAdmin } from "./super-admin";

export interface AuthUser {
  id: string;
  email?: string;
  user_metadata?: { full_name?: string; name?: string };
}

export interface UserOrg {
  id: string;
  name?: string;
  role?: string;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function orgNameFromEmail(email?: string) {
  const domain = email?.split("@")[1]?.split(".")[0];
  if (!domain) return "My Organization";
  return domain.charAt(0).toUpperCase() + domain.slice(1);
}

export function projectSlugFromName(name: string) {
  return slugify(name) || "project";
}

export async function getUserOrgIds(userId: string): Promise<string[]> {
  // Super admin impersonation: if they have an active impersonation cookie,
  // return just that org so the rest of the app behaves as if they're a member.
  const impersonatedOrgId = await getImpersonatedOrgId(userId);
  if (impersonatedOrgId) return [impersonatedOrgId];

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", userId)
    .order("joined_at", { ascending: true });

  if (error) throw new Error(`Failed to load organization membership: ${error.message}`);
  return (data ?? []).map((membership: { org_id: string }) => membership.org_id);
}

export async function ensureUserOrg(user: AuthUser): Promise<UserOrg> {
  const supabase = createServiceClient();
  const existingOrgIds = await getUserOrgIds(user.id);

  if (existingOrgIds[0]) {
    return { id: existingOrgIds[0] };
  }

  const baseName = orgNameFromEmail(user.email);
  const baseSlug = slugify(baseName) || "org";
  let org: { id: string; name: string } | null = null;
  let lastError: string | null = null;

  for (let attempt = 0; attempt < 5 && !org; attempt += 1) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
    const { data, error } = await supabase
      .from("orgs")
      .insert({ name: baseName, slug })
      .select("id, name")
      .single();

    if (data) org = data;
    if (error) lastError = error.message;
  }

  if (!org) {
    throw new Error(`Failed to create organization${lastError ? `: ${lastError}` : ""}`);
  }

  const displayName =
    user.user_metadata?.full_name ?? user.user_metadata?.name ?? user.email ?? null;

  const { error: memberError } = await supabase.from("org_members").insert({
    org_id: org.id,
    user_id: user.id,
    role: "owner",
    display_name: displayName,
  });

  if (memberError) {
    throw new Error(`Failed to create organization membership: ${memberError.message}`);
  }

  return { id: org.id, name: org.name, role: "owner" };
}

export async function getProjectForUser<T = Record<string, unknown>>(
  userId: string,
  projectId: string,
  select: string
): Promise<T | null> {
  // Super admin with no impersonation cookie: allow access to any project
  // by skipping the org membership check entirely.
  const admin = await isSuperAdmin(userId);
  const impersonatedOrgId = await getImpersonatedOrgId(userId);

  const supabase = createServiceClient();

  if (admin && !impersonatedOrgId) {
    // Unrestricted super admin access — no org_id filter
    const { data, error } = await supabase
      .from("projects")
      .select(select)
      .eq("id", projectId)
      .single();
    if (error) return null;
    return data as T;
  }

  const orgIds = impersonatedOrgId ? [impersonatedOrgId] : await getUserOrgIds(userId);
  if (orgIds.length === 0) return null;

  const { data, error } = await supabase
    .from("projects")
    .select(select)
    .eq("id", projectId)
    .in("org_id", orgIds)
    .single();

  if (error) return null;
  return data as T;
}
