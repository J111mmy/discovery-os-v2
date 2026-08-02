"use server";

import { setActiveOrgId } from "@/lib/auth/org";
import { revalidatePath } from "next/cache";

// Calls the existing setActiveOrgId (src/lib/auth/org.ts) unchanged — this
// action only triggers it from the org switcher UI (#203). getActiveOrgId
// re-validates the cookie against the caller's own org_members rows before
// trusting it, so this cannot switch a user into an org they don't belong to.
export async function switchOrgAction(orgId: string) {
  await setActiveOrgId(orgId);
  revalidatePath("/", "layout");
}
