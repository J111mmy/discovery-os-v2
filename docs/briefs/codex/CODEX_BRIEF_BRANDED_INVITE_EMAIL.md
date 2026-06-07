# Codex brief — Branded, app-sent invite email (one-click, one email)

> ⛔ **SECURITY GATE APPLIES (non-negotiable).** Before committing/pushing any change to auth, RLS/migrations, public routes, middleware, or service-role usage, post the diff and wait for Opus's written **APPROVED**. See `AGENTS.md` → "SECURITY REVIEW GATE". This overrides anything below.

**Author:** Opus 4.8 (security reviewer / PM gate)
**Date:** 2026-06-04
**Status:** APPROVED TO BUILD — Opus reviews the diff (route + email module + any new env wiring) BEFORE commit/merge. Codex does not self-clear security work.

## Why
Invites currently ride `supabase.auth.signInWithOtp()` (org-invites/route.ts:67), which:
- sends Supabase's built-in **"Magic Link"** email — copy says *"Your sign-in link / Sign in"*, sender is `noreply@mail.app.supabase.io` with a "powered by Supabase" footer;
- is **hard-throttled** — we hit `email rate limit exceeded` during testing (2026-06-04), which now blocks invite testing entirely;
- can't be reworded, because that template also serves normal login.

We want the **invitation** to be a branded DiscOS email with correct copy ("You've been invited to DiscOS"), one click to accept, and **off Supabase's email-sending throttle** for invites. (Precise: Supabase still **generates and validates** the auth link; only **delivery** moves to Resend, which has its own sending limits and deliverability concerns. We are not "fully unthrottled" — we're off Supabase's *send* throttle for this path.)

## Recommended design — `admin.generateLink()` + app-sent email via Resend

Generate the auth action link server-side **without sending** Supabase's email, then send our **own** branded email containing that link. One email, one click, fully on-brand, and off Supabase's email-*sending* throttle for invites (Supabase still mints/validates the link; Resend handles delivery under its own limits).

**Flow (in `api/org-invites/route.ts`, after the existing owner/admin authorization + invite-row insert — keep those exactly as they are, user-scoped):**
1. Build `redirectTo = ${appOrigin}/auth/callback/${encodeURIComponent(invite.token)}` (the path-based callback we already ship — do NOT reintroduce a nested `?next=`).
2. Using an **admin (service-role) client**, call `auth.admin.generateLink({ type, email: invite.email, options: { redirectTo } })` and capture `data.properties.action_link`.
   - **Type selection — `invite` first, with a real fallback (not "unless invalid").** Use `type: "invite"` as the primary path: it's semantically an invitation, and `generateLink` is explicitly designed for links delivered via a custom email provider. BUT the two link types have a **bidirectional pre-existence constraint** that *will* surface in live use: `invite` errors if the invitee **already has an auth user** (re-invites, or someone already a member of another org); `magiclink` errors if the user **does not yet exist**. So do **not** hardcode one. Try `invite`; on a "user already registered"–style error, fall back to `magiclink`. (A pre-check via `admin.listUsers`/get-user-by-email to choose the type up front is equally acceptable.) Note for testing: fresh `+test` addresses always succeed on `invite`, so the existing-user case is the one a naive single-type implementation silently breaks — exercise it.
   - Treat `action_link` as a **one-click credential** the moment you capture it (see non-negotiables): email body only, never logged, never returned in the API response.
3. Send a branded email via **Resend** to `invite.email` with that `action_link` as the "Accept your invitation" CTA. Subject + body say it's a DiscOS invitation (who invited them / which workspace, if available), not a sign-in.
4. On send failure, keep the current behaviour: surface `"Invite created, but email send failed: <reason>"` (don't silently succeed).
5. Remove the `signInWithOtp` call from the invite path (replaced by the above). Leave the normal `/login` magic-link flow untouched.

The invitee clicks the CTA → Supabase verifies → `/auth/callback/<token>?code=…` → existing shared handler exchanges the code → internal redirect to `/accept-invite?token=…` → `accept_invite` RPC → `/projects`. Nothing in the accept/RPC chain changes.

## Security non-negotiables (I will check each in review)
- **Service-role scope:** the admin client is used **only** for `generateLink`, and **only after** the existing owner/admin authorization check passes. Do NOT use the admin/service client for the `org_invites` insert or any data read/write — those stay on the user-scoped client. This is a scoped auth-admin operation, not an RLS-boundary bypass.
- **Never leak the action link:** it is a one-click credential. It goes **only** into the email body. Do NOT return it in the API JSON response, do NOT log it (no `console.log`, no error payloads echoing it).
- **Escape all interpolation in the email HTML:** org name, inviter name, email, role — any value placed into HTML must be escaped to prevent HTML/header injection. Use a templating helper that escapes by default; never string-concatenate raw user-controlled values into HTML or into email headers (subject/From).
- **Secrets via env only:** `RESEND_API_KEY` (and any `EMAIL_FROM`) from `process.env`, never committed. Add to `.env.local` (gitignored) and document the Vercel env var in the PR description — do not print the value.
- **Don't weaken the redirect:** `redirectTo` must be the internal path-based callback; keep it within the app origin. The `safeInternalPath` open-redirect guard and the path-based token handling stay as-is.
- **Graceful failure:** Resend/generateLink errors must surface to the inviter (existing error shape) — never leave an invite that looks sent but wasn't.
- **No new PII in logs:** don't log full invitee emails at info level beyond what's already done.

## What changes
- `src/app/api/org-invites/route.ts` — swap `signInWithOtp` for `generateLink` + branded send; keep auth check + invite insert intact.
- New `src/lib/email/` (or similar) — a small Resend client wrapper + one invite-email template (escaped interpolation). Reusable for future transactional emails.
- `RESEND_API_KEY` / `EMAIL_FROM` env wiring (documented, not committed).

## Out of scope
- Don't touch the `accept_invite` RPC, the accept-invite route, or `/auth/callback/[token]` — they're validated and working.
- Custom SMTP in Supabase (Auth → SMTP Settings) is a **separate, complementary** Jimmy/config task: it fixes the sender + throttle for *normal login* magic links (which still go through Supabase). This brief only owns the invite email. Note in the PR that both exist.
- Don't change roles/permissions on who can invite.

## Test gate (after Opus reviews the diff)
0. **Link-shape gate — run FIRST, make-or-break.** On the first real click, confirm the `action_link` lands on `/auth/callback/<token>?code=…` (a **query param**). The shared callback reads `?code=` and calls `exchangeCodeForSession`. If it instead arrives as a hash fragment (`#access_token=…`) or a `?token=…&type=…` shape, the server-side callback **cannot read it** — that means the project is on the implicit (not PKCE) flow, and we must resolve the flow type BEFORE polishing the email or anything else. Do not proceed past this until the shape is confirmed.
1. Owner invites a fresh `+test` address → invitee receives a **DiscOS-branded** email (correct copy, our sender once `EMAIL_FROM`/domain set), not a Supabase "Sign in" email.
2. One click on the CTA → authenticates → lands on `/projects` accepted (membership created, `accepted_at` stamped). No second email required.
3. Throttle: send several invites in quick succession → no `email rate limit exceeded` (we're off Supabase's built-in email *sending* for invites — note Resend enforces its own limits, so this proves the Supabase throttle is gone, not that sending is unlimited).
4. Negative: Resend key missing/invalid → inviter sees a clear "email send failed" message; the action link never appears in logs or the API response.
5. Existing invite acceptance, wrong-account, expired, and normal `/login` flows still work unchanged.
