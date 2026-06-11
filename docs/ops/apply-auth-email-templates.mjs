#!/usr/bin/env node
/**
 * Apply DiscOS branded auth email templates to the hosted Supabase project via
 * the Management API. Updates ONLY the mailer template/subject fields — it does
 * NOT touch site_url, redirect URLs, SMTP, rate limits, or any other auth config.
 *
 * Why this exists: `supabase config push` is all-or-nothing and would push the
 * repo's localhost site_url to prod, breaking auth redirects. This script is the
 * safe, surgical alternative.
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx node docs/ops/apply-auth-email-templates.mjs
 *
 * Get a token: Supabase Dashboard → Account → Access Tokens → Generate new token.
 * Project ref is read from NEXT_PUBLIC_SUPABASE_URL or SUPABASE_PROJECT_REF.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");

const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
if (!token) {
  console.error(
    "Missing SUPABASE_ACCESS_TOKEN. Generate one at Supabase → Account → Access Tokens, then:\n" +
      "  SUPABASE_ACCESS_TOKEN=sbp_xxx node docs/ops/apply-auth-email-templates.mjs"
  );
  process.exit(1);
}

const ref =
  process.env.SUPABASE_PROJECT_REF?.trim() ||
  (process.env.NEXT_PUBLIC_SUPABASE_URL || "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
if (!ref) {
  console.error("Could not determine project ref. Set SUPABASE_PROJECT_REF=dzrhyultmmsbxwgmkwyw");
  process.exit(1);
}

const read = (p) => readFileSync(join(repoRoot, p), "utf8");

// Management API auth-config field names → our template files + subjects.
const body = {
  mailer_subjects_magic_link: "Sign in to DiscOS",
  mailer_templates_magic_link_content: read("supabase/templates/auth/magic-link.html"),
  mailer_subjects_confirmation: "Confirm your email — DiscOS",
  mailer_templates_confirmation_content: read("supabase/templates/auth/confirm-signup.html"),
  mailer_subjects_recovery: "Reset your DiscOS password",
  mailer_templates_recovery_content: read("supabase/templates/auth/recovery.html"),
};

const url = `https://api.supabase.com/v1/projects/${ref}/config/auth`;
console.log(`Patching auth email templates for project ${ref} (templates only)…`);

const res = await fetch(url, {
  method: "PATCH",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});

if (!res.ok) {
  const text = await res.text();
  console.error(`Failed (${res.status}): ${text}`);
  process.exit(1);
}

console.log("✓ Applied: Magic Link, Confirm signup, Reset Password templates + subjects.");
console.log("Verify by sending yourself a magic link from the sign-in page.");
