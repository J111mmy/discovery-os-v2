import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Newsreader } from "next/font/google";
import { PostHogProvider } from "./PostHogProvider";
import "./globals.css";

// Newsreader — document bodies only (loaded via next/font/google for self-hosting)
const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-newsreader",
  display: "swap",
});

export const metadata: Metadata = {
  title: "DiscOS",
  description: "Evidence intelligence for product teams",
};

// Inline script that runs before React hydration to avoid a theme flash.
// Reads localStorage("discos-theme"), falls back to "dark".
const noFlashScript = `(function(){try{var t=localStorage.getItem('discos-theme')||'dark';document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      // data-theme set to dark here; the no-flash inline script overrides it
      // with the persisted value before the browser paints.
      data-theme="dark"
      // suppressHydrationWarning: data-theme is mutated by the inline script
      // before hydration, so React's SSR string and client DOM will differ.
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable} ${newsreader.variable}`}
    >
      <head>
        {/* No-flash theme init — must be before any paint */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script dangerouslySetInnerHTML={{ __html: noFlashScript }} />
      </head>
      <body>
        <PostHogProvider />
        {children}
      </body>
    </html>
  );
}
