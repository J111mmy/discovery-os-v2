"use client";

import posthog from "posthog-js";

const POSTHOG_TOKEN = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com";
const REPLAY_ENABLED = process.env.NEXT_PUBLIC_POSTHOG_REPLAY_ENABLED !== "false";

let initialized = false;

function safePath(pathname: string) {
  return pathname
    .replace(/\/auth\/callback\/[^/]+/g, "/auth/callback/[token]")
    .replace(/\/invite\/[^/]+/g, "/invite/[token]");
}

export function isPostHogEnabled() {
  return Boolean(POSTHOG_TOKEN);
}

export function sanitizeAnalyticsUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl, window.location.origin);
    return `${url.origin}${safePath(url.pathname)}`;
  } catch {
    return safePath(rawUrl.split("?")[0] ?? rawUrl);
  }
}

export function initPostHog() {
  if (initialized || !POSTHOG_TOKEN || typeof window === "undefined") return;

  posthog.init(POSTHOG_TOKEN, {
    api_host: POSTHOG_HOST,
    defaults: "2026-05-30",
    capture_pageview: false,
    capture_pageleave: true,
    disable_session_recording: !REPLAY_ENABLED,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: [
        ".reader",
        ".doc-scroll",
        ".artifact-body",
        ".evidence-card",
        ".evidence-content",
        ".transcript-content",
        ".source-content",
        ".ask-answer",
        ".ph-sensitive",
        "[data-ph-sensitive='true']",
      ].join(", "),
      maskCapturedNetworkRequestFn: (request) => {
        if (request.name) {
          request.name = sanitizeAnalyticsUrl(request.name);
        }
        return request;
      },
    },
  });

  initialized = true;
}

export function captureSafePageview(pathname: string) {
  if (!isPostHogEnabled()) return;
  initPostHog();

  const currentUrl = sanitizeAnalyticsUrl(`${window.location.origin}${pathname}`);
  posthog.capture("$pageview", {
    $current_url: currentUrl,
    pathname: safePath(pathname),
  });
}

export { posthog };
