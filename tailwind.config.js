/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // ── New token names (Phase 1+) ───────────────────────────
        bg:              "var(--bg)",
        surface:         "var(--surface)",
        "surface-2":     "var(--surface-2)",
        "surface-3":     "var(--surface-3)",
        "surface-hover": "var(--surface-hover)",
        line:            "var(--line)",
        "line-strong":   "var(--line-strong)",
        sel:             "var(--sel)",
        ink:             "var(--ink)",
        "ink-2":         "var(--ink-2)",
        "ink-3":         "var(--ink-3)",
        "ink-faint":     "var(--ink-faint)",
        accent:          "var(--accent)",
        "accent-hover":  "var(--accent-hover)",
        "accent-soft":   "var(--accent-soft)",
        pos:             "var(--pos)",
        warn:            "var(--warn)",
        neg:             "var(--neg)",
        info:            "var(--info)",
        "pos-bg":        "var(--pos-bg)",
        "warn-bg":       "var(--warn-bg)",
        "neg-bg":        "var(--neg-bg)",
        "info-bg":       "var(--info-bg)",

        // ── Legacy names — kept for backward compat during migration ──
        // Map to the same CSS vars so existing utility classes still resolve.
        // Remove after Phase 2 is complete.
        "surface-0": "var(--bg)",        // was #0d0d10
        "surface-1": "var(--surface)",   // was #141418
        brand: {
          DEFAULT: "var(--accent)",      // was #7c6dfa
          dim:     "var(--accent-hover)",// was #5a4fd4
        },
        tone: {
          ok:    "var(--pos)",           // was #4ade80
          warn:  "var(--warn)",          // was #facc15
          error: "var(--neg)",           // was #f87171
          info:  "var(--info)",          // was #60a5fa
        },
        // ink.DEFAULT / ink.muted / ink.faint kept as namespace
        // (ink.DEFAULT would clash with the flat "ink" key above in Tailwind,
        // so we use the legacy-prefixed form only for the sub-keys)
        "ink-muted": "var(--ink-2)",     // was #9090a8
        border:      "var(--line)",      // was rgba(255,255,255,0.07)
      },

      fontFamily: {
        sans:  ["var(--font-sans)",  "-apple-system", "sans-serif"],
        mono:  ["var(--font-mono)",  "ui-monospace",  "monospace"],
        serif: ["var(--font-serif)", "Georgia",       "serif"],
      },

      borderRadius: {
        xs:   "var(--r-xs)",
        sm:   "var(--r-sm)",
        md:   "var(--r-md)",
        lg:   "var(--r-lg)",
        xl:   "var(--r-xl)",
        full: "var(--r-full)",
      },

      boxShadow: {
        sm:  "var(--shadow-sm)",
        md:  "var(--shadow-md)",
        lg:  "var(--shadow-lg)",
        pop: "var(--shadow-pop)",
      },
    },
  },
  plugins: [],
};
