# CODEX BRIEF — Turn on org invites (Cut #2)

**Author:** Opus (PM). **Implementer:** Codex. **Reviewer/gate:** Opus.
**Branch:** `feat/cut-2`. **Status:** GATED — do not commit/push until Opus posts **APPROVED**.

---

## Goal

Enable the org-invite **send** UI. The backend already exists and is
security-reviewed (C3-clean). The form is deliberately disabled with a "Coming
soon" banner. This task wires the form to the existing route and removes the
banner. **No backend security shape changes.**

## What already exists (do NOT change its security shape)

- `src/app/api/org-invites/route.ts` — authenticated POST. Validates body
  (XOR `project_id`/`org_id`, email, role ∈ admin|member), checks the caller is
  an `owner`/`admin` of the org via `org_members`, inserts one `org_invites`
  row, emails an `acceptUrl` built from `NEXT_PUBLIC_APP_URL`. **Reviewed.
  Leave it alone** unless a real bug surfaces — and if it does, STOP and flag,
  don't fix it inline (it's gated).
- `/invite/[token]` acceptance surface + `accept_invite(p_token)` RPC — already
  built. **Do not touch** (gated: public route + auth escalation).

## Scope (frontend wiring only)

File: `src/app/(app)/settings/SettingsClient.tsx`, "team" tab, the
`{/* Invite — coming soon */}` block (currently ~lines 269–324).

1. Remove the `opacity/pointerEvents/disabled/tabIndex={-1}` lock and the
   "Coming soon / not yet wired" banner.
2. Make the form interactive with local state: `email`, `role`
   (`member`|`admin`), `submitting`, `error`, `success`.
3. On submit → `POST /api/org-invites` with
   `{ org_id: orgId, email, role }` (the component already receives `orgId` as a
   prop — use it; do **not** send `project_id`).
4. Success (200): clear the email field, surface a success line, and refresh the
   pending list — simplest correct approach is `router.refresh()` (the server
   `page.tsx` already queries `org_invites`). Optimistic local insert is
   acceptable but refresh is the safe default.
5. Errors — show the route's message inline:
   - 400 → invalid email / validation
   - 401 → not signed in
   - 403 → "Only owners and admins can invite teammates"
   - 500 → may be "Invite created, but email send failed: …" — show verbatim.
6. **Role-gate the form in the UI.** Only `owner`/`admin` should see an enabled
   form; `member`/`viewer` see a short "Ask an owner or admin to invite people"
   note. The current user's role isn't passed today — add it: in
   `src/app/(app)/settings/page.tsx`, derive the caller's membership role
   (match `user.id` against the `org_members` query already run) and pass
   `currentUserRole` into `SettingsClient`. This is a read-only prop, ungated.

## Verification (Codex runs on dev BEFORE requesting review)

Dev: Node 22, `npm run dev` (port 4321). Prove the full loop once:

1. As an owner/admin, send an invite to a test address.
2. Confirm a row lands in `org_invites` and the email is sent (or logged in dev).
3. Confirm `acceptUrl` host = `NEXT_PUBLIC_APP_URL` (not localhost in a prod-like
   env; localhost is fine in dev).
4. Open `/invite/[token]` → accept → confirm an `org_members` row is created via
   the `accept_invite` RPC (NOT a service-client write).
5. As a `member`, confirm the form is hidden/disabled with the note.

## Gate / hand-off

This change activates the invite + acceptance loop end-to-end, so it's gated.
When the wiring is done and the loop verified, **post the diff to
`docs/security/OPUS_SECURITY_CHANNEL.md` and wait for Opus's APPROVED before
`git commit`/`git push`.** Specifically call out: did you touch anything beyond
`SettingsClient.tsx` and the `currentUserRole` prop in `settings/page.tsx`? If
yes, list it.

**Out of scope / do not touch:** `/invite` acceptance route, `accept_invite`
RPC, `org-invites/route.ts` security logic, middleware, RLS, any migration.
