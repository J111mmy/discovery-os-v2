# Design Proposal — Sign-in Gate UX (#32)

**Status:** Design proposal, ready for Opus/Codex review.
**Author:** Sonnet
**Date:** 2026-06-11
**Responds to:** `docs/briefs/design/SONNET_BRIEF_SIGNIN_GATE_UX.md`
**Pairs with:** Codex's #32 backend (`access_requests` table + RLS, request API, approve→invite /
decline, per-user `status`, capability gate)

---

## 0. Summary

Three surfaces, designed as one coherent flow because they're three views of the same state machine
(`access_requests.status` + a per-principal `status`):

```
Visitor (no account)
  → Request access  [1.1]  → access_requests row, status = 'pending'
                                      |
                          Super Admin reviews [1.2]
                          /                    \
                    Approve                  Decline
                        |                        |
              invite fired,              status = 'declined'
              account created on accept          |
                        |                         |
              status = 'active'         principal (if they
                        |                 still try to sign in)
              normal app access  ←——————→  sees "Access not granted" [1.3]
                        |
              (later) Super Admin suspends
                        |
              status = 'suspended' → "Your access is suspended" [1.3]
```

Existing chrome reused throughout:
- **Request access** is styled as the `(auth)/login` page's sibling — same centered card, brand
  block, input/button styling.
- **Access Requests queue** is styled as the existing `/admin` dashboard table (same header row,
  `divide-y divide-[var(--line)]`, hover rows, action buttons).
- **Pending / declined / suspended** pages reuse the `accept-invite/status` page's card pattern
  (centered `rounded-xl border` card with title + body + single action).

No new visual language anywhere in this proposal.

---

## 1.1 Public "Request access" page

**Route:** `/request-access` (new, public — must be added to `middleware.ts`'s `isPublic` matcher,
flagging this as an **auth-flow change for the security gate**, see §6).

### Layout
Same shell as `/login`: `min-h-screen flex items-center justify-center`, brand block (D logo +
"DiscOS / Evidence workspace"), card max-w-sm (slightly wider, `max-w-md`, to fit the extra fields
without cramping).

### Fields
| Field | Type | Required | Notes |
|---|---|---|---|
| Name | text | yes | |
| Email | email | yes | lowercased on submit, same as `org-invites` route convention |
| Phone | tel | no | optional — credibility signal, not a contact requirement |
| Company | text | yes | |
| Reason / use case | textarea, ~3 rows | yes | short — placeholder: "What are you hoping to use DiscOS for?" |

Copy above the form: *"DiscOS is currently invite-only. Tell us a bit about you and we'll be in
touch."* — sets expectations before the form, not just after.

### Submit → confirmation state
On success, replace the form with the **same "sent" pattern** the login page uses for magic-link
(centered text block, no form), but with honest copy:

> **Request received**
> Thanks — we'll review your request and be in touch at `{email}`.

**Explicitly not shown:** anything implying a magic link, instant access, or "check your email to
continue" — there is nothing to click yet. This is the brief's central honesty requirement and the
easiest place to accidentally regress into magic-link copy by reusing the login page's `sent` block
verbatim, so it's called out as its own state rather than a copy variant.

### Duplicate / abuse handling (UI side)
- **Same confirmation regardless of outcome.** Whether the email already has a pending request, an
  active account, or is brand new, the UI shows "Request received" either way — never "you already
  have an account" or "a request is already pending for this email." That's Codex's rate-limit /
  dedup logic to handle server-side; the UI must not become an email-enumeration oracle.
- **Honeypot field** (cheap, UI-only spam deterrent): an extra `display:none` input
  (`aria-hidden`, `tabindex="-1"`, name like `website`) that real users never fill in. If populated on
  submit, show the same "Request received" success state but don't actually submit — silently drops
  bot traffic without giving feedback that anything was filtered. This is additive to (not a
  replacement for) Codex's server-side rate limiting.
- **Generic error state** (network/5xx only — not validation): *"Something went wrong submitting your
  request. Please try again."* Validation errors (missing required field, invalid email) are inline,
  standard form validation — no new pattern needed.

### Login page changes
Add one line below the existing form, visible in all modes except `sent`:

> Don't have access yet? **[Request access](/request-access)**

And on `/request-access`, a matching reciprocal link back:

> Already have access? **[Sign in](/login)**

This directly answers the brief's "make the split clear" requirement with the smallest possible
change to `(auth)/login/page.tsx` (one new line, no logic change).

---

## 1.2 Super Admin "Access Requests" queue

**Route:** `/admin/access-requests` (new page under `(admin)/admin/`, alongside the existing
`/admin` orgs dashboard). Add a tab/link in the admin layout nav between "Organisations" and
whatever else exists — same `isSuperAdmin` gate as `/admin` (`redirect("/projects")` if not admin,
`redirect("/login")` if not authenticated — copy the exact pattern from `admin/page.tsx` lines 22–24).

### 1.2a Pending requests list
Table, same chrome as `/admin` (`rounded-xl border ... overflow-hidden`, `<table>` with
`divide-y divide-[var(--line)]`), newest first:

| Column | Source |
|---|---|
| Requested | `created_at`, relative time (reuse `relativeTime()` helper from `admin/page.tsx`) |
| Name | `access_requests.name` |
| Email | `access_requests.email` |
| Company | `access_requests.company` |
| Phone | `access_requests.phone` (— if null) |
| Reason | `access_requests.reason` — truncate to ~80 chars with a "more" expand (no modal needed; a
  `<details>`/inline expand is enough for a short text field) |
| Actions | Approve / Decline buttons |

**Approve button:**
- Label: "Approve" (`--accent` filled button, same style as "Enter workspace" in `/admin`)
- Confirmation copy on click (inline, not a separate page — a small expand/confirm under the row, or
  a lightweight modal): *"Approving sends {name} an invite to set up their account at {email}. They'll
  get access once they accept."* — makes the consequence legible per the brief, without a full-page
  interrupt for what should be a routine action.
- After confirm: row moves out of the pending list (optimistic), success toast/inline confirmation:
  *"Invite sent to {email}."*

**Decline button:**
- Label: "Decline" (neutral/outline button, `border-[var(--line)]`, NOT styled as destructive-red —
  declining an access request is a normal outcome, not a dangerous one)
- No confirmation needed (low-stakes, reversible in the sense that the person can always ask again) —
  but the row moves to a **collapsed "Declined" section** (see below) rather than disappearing
  silently, so an admin can see recent decisions and isn't left wondering "did that work?"

### 1.2b Recently-decided section (approved/declined history)
Below the pending list, a collapsed/secondary section: *"Recently reviewed"* — last ~20
approved/declined requests, with their resolved status as a small pill (`--pos` "Invited" /
`--ink-2` "Declined") and *when* + *by whom* if that's tracked. This answers "post-action states" from
the brief (§1.2's "approved/declined moved out of pending") concretely — they don't vanish, they move
to a visible history list, which also gives the admin an audit trail for "did I already review this
person."

### 1.2c Existing users — status + suspend
Separate section/table below the requests queue: **"Team members"** (or per-org, see open decision
in §7) — lists users with their current `status`:

| Column | Source |
|---|---|
| Name / email | from `org_members` / `auth.users` join (existing pattern, see `getOrgDetail` member query) |
| Org | org name (if cross-org view) |
| Role | `org_members.role` |
| Status | `active` (default, no badge — quiet) / `suspended` (`--neg` badge, "Suspended") |
| Actions | "Suspend" (if active) / "Reactivate" (if suspended) |

**Suspend is the one genuinely destructive control in this design** (per the brief: "cuts off access
... design that control to be deliberate, not a stray click"):
- Button styled `--neg` (red), label "Suspend access"
- **Requires a confirmation modal** (not an inline expand like Approve/Decline) — modal copy:
  *"Suspend {name}'s access? They'll be signed out and won't be able to use DiscOS until reactivated.
  This doesn't delete their data."* Two buttons: "Cancel" / "Suspend access" (red, the only red button
  in this whole design — reserved for this one action so it stands out).
- **Reactivate** is the inverse, styled neutral/outline (not `--accent` — reactivating isn't a
  "positive create" action like Approve, it's undoing a suspension), with a one-line inline confirm
  (no modal — re-enabling is lower-stakes than cutting off).

### Empty states
- No pending requests: *"No pending requests."* (plain text, same treatment as `/admin`'s "No
  organisations yet.")
- No recently-reviewed history: section simply doesn't render (don't show an empty "Recently
  reviewed" shell with nothing in it).

---

## 1.3 Pending / declined / suspended account states

Three new routes, all **public** (reached by an authenticated-but-not-yet-active principal — the
person has a valid session but no `active` status), styled like `accept-invite/status`'s card
(centered `max-w-md`, `rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6`):

| Route | Condition | Title | Body | Action |
|---|---|---|---|---|
| `/access-pending` | `access_requests.status = 'pending'` (or principal has no `org_members` row and no resolved request — edge case) | "Your access is pending review" | "We've received your request and a team member will review it shortly. You'll get an email once you're approved." | "Sign out" (outline button — reuses existing `/api/auth/sign-out`) |
| `/access-declined` | `access_requests.status = 'declined'` | "Access not granted" | "Your request to access DiscOS wasn't approved. If you think this is a mistake, contact your DiscOS admin." | "Sign out" |
| `/access-suspended` | principal `status = 'suspended'` | "Your access has been suspended" | "Your account access has been paused. Contact your DiscOS admin if you believe this is a mistake." | "Sign out" |

**No nav, no sidebar, no token-spending UI reachable** — these are dead-end pages by design, same
visual isolation as `accept-invite/status` (which already has zero app chrome, confirmed by reading
that file — it's just the centered card on `bg-[var(--bg)]`).

### Where the redirect happens
`middleware.ts` is the natural place (it already runs on every request and already does the
unauthenticated→`/login` redirect at lines 49–51). After the existing `getUser()` call, for an
authenticated user, check their `status` (see §5 for the data shape) and redirect to the matching
`/access-*` route if not `active` — **except** for requests already targeting `/access-*`, `/login`,
`/api/auth/sign-out`, etc. (avoid a redirect loop, same guard shape as the existing `isPublic` list).

This is a **middleware change touching the auth gate** — flagged for security review in §6.

---

## 2. States summary

| Surface | Loading | Empty | Error | Success |
|---|---|---|---|---|
| Request access form | n/a (client form, no initial fetch) | n/a | "Something went wrong submitting your request. Please try again." (network/5xx only) | "Request received" — see §1.1 |
| Access Requests queue (pending) | Skeleton rows (reuse `SkeletonBlock` pattern from the problem-drawer work) | "No pending requests." | "We could not load access requests. Try again." (same literal-error convention as `/problems`) | row removed + moves to Recently reviewed |
| Recently reviewed | — | section not rendered | (covered by the queue's error state — one fetch) | — |
| Team members / suspend | Skeleton rows | n/a (always at least the current admin) | "We could not load team members. Try again." | status pill updates in place |
| `/access-pending` `/access-declined` `/access-suspended` | n/a (server-resolved before render) | n/a | n/a — if the principal's status can't be determined, default to `/access-pending` copy (fail toward "wait for review," never toward granting access) | — |

---

## 3. Data needed (for Codex — naming the shapes, not prescribing implementation)

### `access_requests` (new table, per brief)
```
id            uuid pk
name          text not null
email         text not null
phone         text null
company       text not null
reason        text not null
status        text not null default 'pending'   -- 'pending' | 'approved' | 'declined'
created_at    timestamptz not null default now()
reviewed_at   timestamptz null
reviewed_by   uuid null references auth.users(id)
```
- UI reads: all fields, for the pending list and the recently-reviewed list (`status != 'pending'`,
  ordered by `reviewed_at desc limit 20`).
- UI writes (via Approve/Decline actions): `status`, `reviewed_at`, `reviewed_by`.
- Index on `(status, created_at)` for the pending-list query.

### Per-principal `status` (the capability-gate field)
The brief refers to this as "the per-user `status`" (`active`/`suspended`, plus implicitly
`pending`/`declined` pre-account). **Where this field lives is Codex's call** — options are a new
column on `org_members`, or a new lightweight `user_status` / `profiles` table keyed on
`auth.users.id` (since a suspended principal might span multiple orgs, or have zero org rows yet if
they're `pending`/`declined` and no account/org was ever provisioned).

What the **UI needs**, regardless of where it lives:
- A way to read, for the currently-authenticated principal (in middleware), one of:
  `active | pending | declined | suspended` — drives the §1.3 redirect.
- A way to read, for the admin queue, the same value **per existing user** (for the "Team members"
  table) plus a write path for `suspended ⇄ active`.

### Optional domain auto-approve (§1.2 of the brief, "no special UI needed")
Confirmed in this design: **no UI surface for this at all**. An auto-approved
`@veyordigital.com` signup never creates an `access_requests` row (or creates one that's immediately
`status = 'approved', reviewed_by = null`) — either way it never appears in the pending list, and the
"Recently reviewed" list either excludes `reviewed_by IS NULL` rows or shows them with a quiet
"Auto-approved (domain)" label instead of an admin name. I'd lean toward **excluding** auto-approved
rows from "Recently reviewed" entirely — that list's purpose is "what did *I* (the admin) decide
recently," and auto-approvals aren't decisions. Flagging as a one-line open decision in §7.

---

## 4. What touches the auth/security gate (flag for C5-style review)

Per the brief's "flag anything that touches auth flows":

1. **`middleware.ts`** — two changes: (a) add `/request-access` to the `isPublic` matcher; (b) new
   post-auth `status` check + redirect to `/access-pending|declined|suspended`. (b) is the
   higher-stakes one — it's a new branch in the function that currently gates the entire app.
2. **New public write endpoint** for `access_requests` (POST from `/request-access`) — unauthenticated,
   rate-limited, must not leak email-existence (per §1.1). This is squarely Codex's #32 backend but the
   UI's "always show the same success state" behavior is load-bearing for the no-enumeration
   property and should be reviewed alongside the endpoint, not as a UI-only afterthought.
3. **Admin approve action** — "fires an invite via the existing invite flow" means it calls (or
   reuses the logic behind) `POST /api/org-invites`, which today requires the caller to be an
   `owner`/`admin` **member of the target org** (see `org-invites/route.ts` lines 67–75). A super
   admin approving an access request is not necessarily a member of the org the new user should land
   in — see open decision in §7 (which org). Whatever the answer, the approve action needs its own
   authorization path (super-admin-scoped), not a reuse of the member-scoped invite check as-is.
4. **Suspend/reactivate action** — needs to actually deny access (capability gate at token-spending
   routes, per Codex's scope) *and* ideally invalidate the existing session so a suspended user is
   signed out promptly rather than waiting for token expiry. Session invalidation on suspend is worth
   confirming with Codex — if it's not feasible immediately, the `/access-suspended` middleware
   redirect (§1.3) still prevents *use* of the app even with a live session, which may be sufficient
   for v1.

---

## 5. Open decisions for Opus/Codex

1. **Which org does an approved requester land in?** The brief says Approve "fires an invite via the
   existing invite flow," which is org-scoped (`org_invites.org_id`). Three options:
   - (a) Approve creates a **new org** for the requester (named from their `company` field, owner
     role) — closest to today's self-serve behavior (auto-org-on-first-signup, per
     `src/lib/auth/org.ts`'s domain-derived org naming), just gated by approval first.
   - (b) Approve invites them into a **specific existing org**, chosen by the admin at approve-time
     (adds an org picker to the Approve confirmation in §1.2a).
   - (c) Approve invites them into **veyordigital's own org** as a guest/member (if access requests
     are mostly "let this person into our existing workspace" rather than "let this person create
     their own tenant").
   I'd default to **(a)** as it requires the least new UI (no picker) and matches the existing
   auto-provision pattern, but this is a product decision about what DiscOS *is* to a new requester
   (their own tenant vs. a seat in an existing one) — not mine to assume.
2. **Where does per-principal `status` live** (§3) — new column vs. new table — and does it need to
   support a principal with **zero** `org_members` rows (true for `pending`/`declined` requesters who
   were never provisioned an org)? This shapes whether the middleware check in §1.3 can be a simple
   join or needs a separate lookup.
3. **Auto-approved domain signups in "Recently reviewed"** (§3) — exclude entirely, or show with an
   "Auto-approved (domain)" label? I lean exclude.
4. **Cross-org scope of the "Team members" table** (§1.2c) — is this global (all orgs, super-admin
   view) or per-org? Given `/admin` today is already a cross-org super-admin surface, I assumed
   global with an Org column, but if the realistic team size is small (one org, veyordigital) a flat
   per-org list without the Org column is simpler and I'd happily drop that column.
5. **Session invalidation on suspend** (§4.4) — confirm whether this is feasible now or whether the
   middleware redirect alone is the v1 enforcement.

---

## 6. Out of scope

- Email content/templates for the approval invite (reuses existing `sendInviteEmail` per the brief —
  no new email design here).
- Self-service "resend my request" / status-check page for requesters (the brief's confirmation copy
  sets expectations as one-shot — "we'll be in touch" — no requester-facing status page proposed).
- Bulk approve/decline (the queue is expected to be small; one-at-a-time actions per §1.2a are
  sufficient for v1).
