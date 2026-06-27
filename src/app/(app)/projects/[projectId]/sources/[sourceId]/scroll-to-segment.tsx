"use client";

import { useEffect } from "react";

// Next.js client-side navigation (next/link) updates history without a native
// browser navigation, so the browser's built-in scroll-to-hash never fires here.
// Segments also aren't guaranteed to be in the DOM on the very first paint, so
// retry briefly rather than scrolling once on mount.
export function ScrollToSegment() {
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;

    let attempts = 0;
    const tryScroll = () => {
      const el = document.getElementById(hash);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      attempts += 1;
      if (attempts < 10) setTimeout(tryScroll, 100);
    };
    tryScroll();
  }, []);

  return null;
}
