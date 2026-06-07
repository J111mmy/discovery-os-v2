# Codex Brief — Accept-Invite Flow Hardening (Milestone 0 close-out)

> ⛔ **SECURITY GATE APPLIES (non-negotiable).** Before committing/pushing any change to auth, RLS/migrations, public routes, middleware, or service-role usage, post the diff and wait for Opus's written **APPROVED**. See `AGENTS.md` → "SECURITY REVIEW GATE". This overrides anything below.

**Author:** Opus 4.8 (PM / security reviewer) · **Date:** 2026-06-04
**Gate:** This is auth-boundary code. **Opus reviews the diff before merge.** State your intended change and wait for the OK before writing.
**Priority:** Blocks inviting real Veyor teammates. Do this before the team is invited.

---

## What went wrong (observed, not theoretical)

A real invited user (`onetendegrees+member@gmail.com`) clicked their invite link, authenticated via magic link, and landed in the app with **zero org memberships** — `accepted_at: null`, `total_memberships: 0`. The accept-invite page never completed. They saw "No projects yet." We had to manually `INSERT` the membership via SQL to unblock them.

Three distinct defects combined to produce this. All three need fixing.

---

## Defect 1 — The invite token is lost across the magic-link round trip

**Current chain (looks correct in code, fails in practice):**
- `accept-invite/page.tsx:40` — unauthenticated → `redirect("/login?next=" + encodeURIComponent("/accept-invite?token=" + token))`
- `login/page.tsx:33` — threads `next` into `emailRedirectTo: ".../auth/callback?next=" + encodeURIComponent(next)`
- `auth/callback/route.ts:8,14` — reads `next`, redirects to it after `exchangeCodeForSession`

The code is right. The most likely real-world failure is the **Supabase redirect-URL allowlist** silently stripping the query string (a well-known Supabase gotcha): if the `emailRedirectTo` URL with its `?next=...` query doesn't match an allowlisted redirect pattern, Supabase falls back to the Site URL and the `next` param vanishes → user lands on `/projects`, accept-invite never runs.

**Two-part fix:**

**(a) Config — Jimmy's task, not Codex.** Verify Supabase Dashboard → Authentication → URL Configuration → Redirect URLs includes the production callback with a wildcard that covers query strings (e.g. `https://project-jwkct.vercel.app/auth/callback*` and the localhost equivalent). I'll route this to Jimmy.

**(b) Code — make the flow resilient so it does NOT depend on `next` surviving.** Carry the invite token in a server-set HttpOnly cookie instead of (or in addition to) the `next` param:
- When an unauthenticated user hits the invite, set an HttpOnly cookie `disco_pending_invite=<token>` (short TTL, e.g. 1 hour) **server-side**, then redirect to `/login`.
- In `auth/callback/route.ts`, after `exchangeCodeForSession` succeeds, check for `disco_pending_invite`. If present → redirect to `/accept-invite?token=<token>` (now authenticated, so it completes), and clear the cookie. Otherwise fall back to `next`.

A cookie set server-side survives the Supabase round trip; a query param threaded through a third-party redirect allowlist does not reliably. **Note:** setting a cookie requires a cookie-capable context — see Defect 2. This is why the entry point likely needs to become a Route Handler.

---

## Defect 2 — `setActiveOrgId` silently no-ops in a Server Component

`accept-invite/page.tsx` is a **Server Component**. Server Components cannot mutate cookies in the Next.js App Router. `setActiveOrgId` (`org.ts:85-100`) wraps `cookieStore.set` in a `try/catch` that **swallows the failure**:

```ts
try { cookieStore.set(ACTIVE_ORG_COOKIE, orgId, {...}); }
catch { /* Server Components cannot mutate cookies */ }
```

So line 92's `await setActiveOrgId(invite.org_id)` does nothing. Today this is masked because a freshly-joined user has exactly one membership, so `getActiveOrgId`'s `joined_at`-first fallback resolves correctly. But it is a latent bug the moment a user belongs to more than one org (which invited users inherently can).

**Fix:** the membership write + `setActiveOrgId` must run in a cookie-capable context — a **Server Action** or a **Route Handler**, not a Server Component. Pick whichever fits the codebase conventions best. My lean: make `/accept-invite` a Route Handler (`route.ts`) that does the mutation and sets cookies, redirecting to a thin status page for the friendly message states. A Server Action triggered by a "Join {Org}" button is also acceptable.

---

## Defect 3 — The membership insert has no error handling

`accept-invite/page.tsx:77-84`:

```ts
if (!existingMember) {
  await supabase.from("org_members").insert({ org_id, user_id, role, display_name });
}
```

No error capture. If the RLS policy rejects the insert (or any DB error occurs), the user proceeds to `redirect("/projects")` with **no membership and no error shown** — exactly the silent failure we saw.

**Fix:** capture the insert result. On error, render an `InviteMessage` with a clear failure state ("We couldn't add you to {Org}. Ask an owner to re-send the invite, or contact support."). Never redirect to `/projects` on a failed insert.

---

## Non-negotiable constraints

1. **Keep the user-scoped client for the membership insert.** The insert relies on the `"invited users can join orgs"` RLS policy, verified safe in the Milestone 0 security assessment (ORG-1). **Do NOT switch to `createServiceClient()` to "fix" a silent failure.** If the insert fails under RLS for a legitimate invite, that's a real signal to surface — and the security assessment confirmed the policy permits the valid case and forbids self-join into an arbitrary org. Service-role would bypass that boundary.
2. **Preserve all existing friendly states:** missing token, invite not found, already accepted, expired, wrong account. They must still render their `InviteMessage` UI (or an equivalent status page if you move to a Route Handler).
3. **Token still validated server-side** against `org_invites` (org_id, email match to `auth.uid()` email, `accepted_at` null, not expired) before any write. Don't trust the cookie token any more than the query token — it's still validated against the DB row.
4. **`disco_pending_invite` cookie:** HttpOnly, SameSite=Lax, Secure in prod, short TTL, cleared on completion.

---

## Definition of done

- An invited user who is NOT already signed in can click the invite link, complete magic-link auth, and land **as a member of the correct org seeing its projects** — with no manual SQL.
- An already-signed-in invited user clicking the link completes immediately.
- A failed membership insert shows an error, never a silent redirect.
- `setActiveOrgId` actually persists the cookie (verify the `disco_active_org` cookie is set after accept).
- Existing status messages still work.
- Jimmy has confirmed the Supabase redirect-URL allowlist (config task, tracked separately).

---

## Files in scope
- `src/app/accept-invite/page.tsx` (likely becomes a Route Handler + thin status page, or page + Server Action)
- `src/app/(auth)/callback/route.ts` (add `disco_pending_invite` check)
- `src/lib/auth/org.ts` (`setActiveOrgId` is fine as-is once called from a cookie-capable context; no change required there unless you want to drop the now-misleading try/catch comment)

**Reminder:** state your intended approach (Route Handler vs Server Action, cookie name/TTL) and wait for Opus OK before writing code.
