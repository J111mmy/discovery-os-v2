"use client";

import { useEffect } from "react";
import { isPostHogEnabled, posthog } from "@/lib/posthog/client";

interface PostHogIdentifyProps {
  userId: string;
  userEmail: string | null;
  superAdmin: boolean;
}

export function PostHogIdentify({
  userId,
  userEmail,
  superAdmin,
}: PostHogIdentifyProps) {
  useEffect(() => {
    if (!isPostHogEnabled()) return;

    posthog.identify(userId, {
      email: userEmail ?? undefined,
      super_admin: superAdmin,
    });
  }, [superAdmin, userEmail, userId]);

  return null;
}
