# Sonnet Design Brief — Sign-in gate UX (#32)

**Status:** Design brief, ready for Sonnet. Produces a design proposal for Opus/Codex review.
**Author:** Opus (PM)
**Date:** 2026-06-11
**Issue:** [#32](https://github.com/J111mmy/discovery-os-v2/issues/32) — Gate sign-in: admin-reviewed access
**Pairs with:** Codex's #32 backend (access_requests table, request API, status + capability gate)

---

## 0. Why
Sign-in is fully self-serve today, so anyone can mint an account and spend tokens. We're moving to
**admin-reviewed, invite-only** access: no account exists until Jimmy approves it. This needs three
designed surfaces. The team is *not* being invited until this ships, so this gates the front door
before the gate matters.

## 1. Surfaces to design

### 1.1 Public "Request access" page (replaces the open signup affordance)
- The login page currently offers self-serve magic-link/password. Self-signup goes away; in its place,
  a **"Request access"** path for people who don't yet have an account.
- Fields: **name, email, phone, company, short reason/use-case.** Keep it short and credible — this is
  a real person asking to be let in, not a marketing form.
- **Honest confirmation state:** after submit, "Request received — we'll be in touch." No account, no
  "check your email for a magic link" (there's nothing to click yet). Don't imply instant access.
- Public + unauthenticated, so design for abuse resistance affordances (the backend rate-limits; the
  UI shouldn't leak whether an email already exists).
- Returning/approved users still need the normal sign-in. Make the split clear: "Already have access?
  Sign in" vs "Need access? Request it."

### 1.2 Super Admin "Access Requests" queue
- Lives in the existing admin area (`src/app/(admin)/admin`). A reviewer queue: list of pending
  requests with all captured fields + timestamp, newest first.
- Per request: **Approve** (→ fires an invite via the existing invite flow) and **Decline**. Make the
  consequence legible ("Approving sends them an invite to set up their account").
- Also surface **existing users with their status** (`active` / `suspended`) so the admin can
  **suspend** someone instantly — design that control to be deliberate (it cuts off access), not a
  stray click.
- Empty state ("No pending requests"), and post-action states (approved/declined moved out of pending).

### 1.3 Pending / declined / suspended account states
- If a principal somehow reaches the app without being `active` (edge cases, or post-decline), they see
  an honest **"Your access is pending review"** / **"Access not granted"** state — not a broken app or a
  silent dead-end. No token-spending UI is reachable from these states.

## 2. Principles
- **Honest about what happens next** — never imply access or email-magic when the real next step is a
  human reviewing. This is the same honesty bar as the rest of DiscOS.
- **Reuse existing chrome** — the auth page styling and the admin-area patterns already exist; this is
  not a new visual language. The request form should feel like the sign-in page's sibling.
- **The destructive/grant actions read as deliberate** — approve and especially suspend change who can
  spend money; design them with appropriate weight and confirmation.

## 3. Coordination with Codex (#32 backend)
- Codex owns: `access_requests` table + RLS, the request API (rate-limited), approve→invite / decline
  actions, the per-user `status`, and the **capability gate** at every token-spending route/agent.
- You own the three surfaces above + their states. Name the exact fields/states you need; if a state
  needs a backend signal that isn't there yet (e.g. a `status` value), flag it as a dependency rather
  than assuming.
- **Optional domain auto-approve** (e.g. `@veyordigital.com` skips the queue) — design the queue so an
  auto-approved internal user simply never appears in it; no special UI needed, but don't design
  anything that assumes every user passed through the queue.

## 4. Deliverable
A design proposal in `docs/briefs/design/` (same format as your other proposals): the three surfaces,
all states (loading/empty/error/pending/declined/suspended), exact data each reads/writes, and open
decisions for Opus/Codex. Flag anything that touches auth flows so it routes through the security gate.
