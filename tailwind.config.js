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
        surface: {
          0: "#0d0d10",
          1: "#141418",
          2: "#1c1c22",
          3: "#25252d",
        },
        brand: {
          DEFAULT: "#7c6dfa",
          dim: "#5a4fd4",
        },
        tone: {
          ok: "#4ade80",
          warn: "#facc15",
          error: "#f87171",
          info: "#60a5fa",
        },
        ink: {
          DEFAULT: "#e8e8f0",
          muted: "#9090a8",
          faint: "#5a5a72",
        },
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
    },
  },
  plugins: [],
};
