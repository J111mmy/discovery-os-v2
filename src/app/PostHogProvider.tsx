"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { captureSafePageview, initPostHog } from "@/lib/posthog/client";

export function PostHogProvider() {
  const pathname = usePathname();

  useEffect(() => {
    initPostHog();
  }, []);

  useEffect(() => {
    if (!pathname) return;
    captureSafePageview(pathname);
  }, [pathname]);

  return null;
}
