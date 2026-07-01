"use client";

import { useEffect } from "react";
import { isPostHogEnabled, posthog } from "@/lib/posthog/client";

interface PostHogProjectContextProps {
  orgId: string;
  projectId: string;
}

export function PostHogProjectContext({
  orgId,
  projectId,
}: PostHogProjectContextProps) {
  useEffect(() => {
    if (!isPostHogEnabled()) return;

    posthog.group("org", orgId);
    posthog.register({
      org_id: orgId,
      project_id: projectId,
    });

    return () => {
      posthog.unregister("project_id");
      posthog.unregister("org_id");
    };
  }, [orgId, projectId]);

  return null;
}
