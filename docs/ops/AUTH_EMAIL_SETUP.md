# Auth Email Setup — fix rate limits, sender domain, and branding

**Owner:** Jimmy (requires Supabase Dashboard + Resend access — not doable from code)
**Created:** 2026-06-11
**Symptoms this fixes:** "email rate limit exceeded" on sign-in; auth emails sent from
`noreply@mail.app.supabase.io` instead of your domain; default (unbranded) Supabase email templates.

---

## Root cause (read first)

DiscOS has **two separate email paths**:

| Path | Transport | Sender | Status |
|---|---|---|---|
| **App invites** (`Invite` table → `src/lib/email/invite.ts` → `resend.ts`) | Resend HTTP API | `EMAIL_FROM` (your domain) | ✅ already branded |
| **Auth emails** (magic link, confirm signup, password reset) | **Supabase built-in email** | `mail.app.supabase.io` | ❌ unbranded, **rate-limited ~2–4/hr** |

Both screenshots (magic link + "Confirm your email address") are the **auth** path. Buying a domain
didn't change anything because the domain was wired into **Resend** (for invites), not into Supabase
**Auth**. Supabase's built-in auth email is meant for testing only — it has a hard low rate limit and
always sends from the Supabase domain with stock templates.

**The fix:** point Supabase Auth at your existing Resend account as **custom SMTP**. Because Resend is
already sending invites, **your domain is already verified** — so this is fast and needs no new DNS.

---

## Step 1 — Unblock delivery + fix sender (5 min, highest priority)

Supabase Dashboard → **Project Settings → Authentication → SMTP Settings** → enable **Custom SMTP**:

| Field | Value |
|---|---|
| Host | `smtp.resend.com` |
| Port | `465` (SSL) — or `587` (TLS) |
| Username | `resend` |
| Password | your **Resend API key** (`re_…`) — reuse `RESEND_API_KEY`, or mint a fresh one in Resend |
| Sender email | `noreply@<your-domain>` (must be on the **Resend-verified** domain — match the domain in `EMAIL_FROM`) |
| Sender name | `DiscOS` |

Save. This **removes the rate limit** (you're now on Resend's limits, not Supabase's built-in cap)
**and** moves the sender to your domain in one step.

> If `EMAIL_FROM` currently uses e.g. `invites@yourdomain.com`, you can either reuse that mailbox or
> add `noreply@yourdomain.com` — both work as long as the **domain** is verified in Resend. No new DNS
> needed if the domain already passes SPF/DKIM for invites (it does, since invites deliver).

## Step 2 — Raise the auth email rate limit

Supabase Dashboard → **Authentication → Rate Limits** → **"Rate limit for sending emails"**.
The built-in default is very low. With custom SMTP you can safely raise it — set it to a sane onboarding
value (e.g. **30–100 / hour**) so inviting a team doesn't trip it.

## Step 3 — Brand the templates (paste the ones in this repo)

Supabase Dashboard → **Authentication → Email Templates**. For each template, paste the matching file
from `supabase/templates/auth/` and set the subject:

| Dashboard template | File | Suggested subject |
|---|---|---|
| Magic Link | `supabase/templates/auth/magic-link.html` | `Sign in to DiscOS` |
| Confirm signup | `supabase/templates/auth/confirm-signup.html` | `Confirm your email — DiscOS` |
| Reset Password | `supabase/templates/auth/recovery.html` | `Reset your DiscOS password` |

These are DiscOS-branded (indigo `#6366F1`, "DiscOS · Evidence workspace" lockup), light-background for
deliverability across Gmail/Outlook/Apple Mail, with a button + copy-paste URL fallback. They use the
standard Supabase `{{ .ConfirmationURL }}` variable, so links keep working unchanged.

> **Note on the Supabase "Invite user" template:** DiscOS sends team invites through the app's own
> Resend path (`invite.ts`), **not** Supabase's `inviteUserByEmail`. So the dashboard "Invite user"
> template is likely unused — leave it unless you confirm a code path triggers it. If you do use it,
> reuse `confirm-signup.html` as a base.

## Step 4 — Verify

1. Send yourself a magic link → arrives **from your domain**, branded, no rate-limit error.
2. Sign up a test address → branded "Confirm your email."
3. Check Resend dashboard → **Logs** shows the auth emails flowing through Resend (proves SMTP is wired).

---

## If "templates are gone" because this is a NEW Supabase project

If you pointed the deployed app at a **new** Supabase project this morning, all auth settings reset to
defaults (templates, SMTP, rate limits are **per-project** and dashboard-stored — they don't migrate).
In that case Steps 1–3 above are exactly what re-applies them. Also re-check that the new project's
**Auth → URL Configuration → Site URL / Redirect URLs** point at the production domain (the repo
`supabase/config.toml` is local-dev only — `site_url=localhost` — and is **not** what prod uses).

## Why this isn't fixed in code

Hosted-Supabase auth SMTP, rate limits, and email templates are **dashboard/project settings**, not
version-controlled by this repo (the local `supabase/config.toml` only governs `supabase start` local
dev). The branded HTML is committed here so it's the source of truth to paste; the wiring is yours to
apply in the dashboard.
