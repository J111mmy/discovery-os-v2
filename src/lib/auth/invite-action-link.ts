import { createServiceClient } from "@/lib/supabase/server";

type InviteLinkType = "invite" | "magiclink";

export class InviteActionLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InviteActionLinkError";
  }
}

function getErrorMessage(error: unknown) {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return sanitizeErrorMessage(message);
  }

  return "Could not generate invite link";
}

function sanitizeErrorMessage(message: string) {
  return message
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]");
}

function isAlreadyRegisteredError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();

  return [
    "already registered",
    "already been registered",
    "already exists",
    "user already exists",
    "user already registered",
    "email_exists",
  ].some((fragment) => message.includes(fragment));
}

async function generateActionLink(
  authAdmin: ReturnType<typeof createServiceClient>["auth"]["admin"],
  type: InviteLinkType,
  email: string,
  redirectTo: string
) {
  const { data, error } = await authAdmin.generateLink({
    type,
    email,
    options: { redirectTo },
  });

  if (error) {
    throw error;
  }

  const actionLink = data.properties?.action_link;

  if (!actionLink) {
    throw new InviteActionLinkError("Supabase did not return an invite action link");
  }

  return actionLink;
}

export async function createInviteActionLink(
  email: string,
  redirectTo: string
): Promise<string> {
  const serviceSupabase = createServiceClient();

  try {
    return await generateActionLink(serviceSupabase.auth.admin, "invite", email, redirectTo);
  } catch (error) {
    if (!isAlreadyRegisteredError(error)) {
      throw new InviteActionLinkError(getErrorMessage(error));
    }
  }

  try {
    return await generateActionLink(serviceSupabase.auth.admin, "magiclink", email, redirectTo);
  } catch (error) {
    throw new InviteActionLinkError(getErrorMessage(error));
  }
}
