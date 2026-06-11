import { createServiceClient } from "@/lib/supabase/server";

export type AccessStatus = "active" | "pending" | "declined" | "suspended";

export type AccessCheck =
  | { ok: true; status: "active" }
  | { ok: false; status: Exclude<AccessStatus, "active">; error: string };

export type AccessPrincipal = {
  id: string;
  email?: string | null;
};

function normalizeStatus(value: unknown): AccessStatus | null {
  return value === "active" ||
    value === "pending" ||
    value === "declined" ||
    value === "suspended"
    ? value
    : null;
}

export function accessRedirectPath(status: AccessStatus) {
  if (status === "suspended") return "/access-suspended";
  if (status === "declined") return "/access-declined";
  if (status === "pending") return "/access-pending";
  return "/projects";
}

export async function getPrincipalAccessStatus(
  principal: AccessPrincipal
): Promise<AccessStatus> {
  const supabase = createServiceClient();

  const { data: statusRow, error: statusError } = await supabase
    .from("user_access_status")
    .select("status")
    .eq("user_id", principal.id)
    .maybeSingle();

  if (statusError) throw new Error(`Failed to read access status: ${statusError.message}`);
  if (statusRow?.status === "suspended") return "suspended";

  const { data: superAdmin, error: superAdminError } = await supabase
    .from("super_admins")
    .select("user_id")
    .eq("user_id", principal.id)
    .maybeSingle();

  if (superAdminError) {
    throw new Error(`Failed to read super admin status: ${superAdminError.message}`);
  }
  if (superAdmin) return "active";

  const { data: membership, error: membershipError } = await supabase
    .from("org_members")
    .select("id")
    .eq("user_id", principal.id)
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    throw new Error(`Failed to read membership status: ${membershipError.message}`);
  }
  if (membership) return "active";

  const email = principal.email?.trim().toLowerCase();
  if (!email) return "pending";

  const { data: request, error: requestError } = await supabase
    .from("access_requests")
    .select("status")
    .eq("email", email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (requestError) {
    throw new Error(`Failed to read access request status: ${requestError.message}`);
  }

  return normalizeStatus(request?.status) ?? "pending";
}

export async function requireActiveAccess(
  principal: AccessPrincipal
): Promise<AccessCheck> {
  const status = await getPrincipalAccessStatus(principal);
  if (status === "active") return { ok: true, status };

  return {
    ok: false,
    status,
    error:
      status === "suspended"
        ? "Access suspended."
        : status === "declined"
        ? "Access not granted."
        : "Access pending review.",
  };
}
