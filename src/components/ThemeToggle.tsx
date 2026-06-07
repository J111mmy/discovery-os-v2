"use client";

import { useEffect, useState } from "react";

type Theme = "dark" | "light";

/**
 * Phase-0 theme toggle.
 * Reads/writes localStorage("discos-theme") and sets [data-theme] on <html>.
 * Rendered as a fixed debug button until Phase 1 moves it into the rail.
 *
 * Phase 1: remove the fixed-position wrapper; export just the inner toggle
 * button and render it inside RailV2's footer.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Read the current theme set by the no-flash inline script
    const current =
      (document.documentElement.getAttribute("data-theme") as Theme) ||
      (localStorage.getItem("discos-theme") as Theme) ||
      "dark";
    setTheme(current);
    setMounted(true);
  }, []);

  function apply(next: Theme) {
    setTheme(next);
    localStorage.setItem("discos-theme", next);
    document.documentElement.setAttribute("data-theme", next);
  }

  // Don't render until client-side to avoid hydration mismatch
  if (!mounted) return null;

  return (
    // Phase-0 test position — fixed bottom-right.
    // Phase 1: remove this wrapper; render the <button> inside the rail.
    <div
      style={{
        position: "fixed",
        bottom: "20px",
        right: "20px",
        zIndex: 9999,
      }}
    >
      <button
        onClick={() => apply(theme === "dark" ? "light" : "dark")}
        aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "8px 12px",
          borderRadius: "var(--r-sm)",
          background: "var(--surface-2)",
          border: "1px solid var(--line-strong)",
          color: "var(--ink-2)",
          fontSize: "12px",
          fontFamily: "var(--font-sans)",
          fontWeight: 500,
          cursor: "pointer",
          boxShadow: "var(--shadow-md)",
          transition: "background 0.15s, color 0.15s",
        }}
      >
        {theme === "dark" ? (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/>
              <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
              <line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
              <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
            </svg>
            Light
          </>
        ) : (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
            Dark
          </>
        )}
      </button>
    </div>
  );
}
