# Promotion Run — Cut: Sign-in Gate (#32) — 2026-06-11

**Owner/driver:** Opus (PM). **SQL + deploy executor:** Jimmy. **Code:** Codex (backend/gated) / Sonnet (design-lane).
Follows `docs/ops/PRODUCTION_PROMOTION_CHECKLIST.md`. One cut = one promotion.

---

## 0. What ships in this cut

The **only new production behavior is the #32 invite-only sign-in gate.** (The #25 opportunity agent, #30 hardening, and P3 are already on `main` from earlier — not part of this cut's behavior change; #25 stays dormant/manual-trigger.)

In scope (the #32 packet, currently uncommitted in the working tree):
- `supabase/migrations/0031_access_gate.sql` (already applied to prod — §2)
- `src/middleware.ts` — post-auth `current_access_status()` gate + redirects
- `src/app/api/access-requests/route.ts` — public request endpoint **+ Turnstile siteverify**
- `src/app/api/admin/access-requests/*`, `src/app/api/admin/users/[userId]/access-status` — admin queue + suspend
- `src/lib/auth/access.ts` + `requireActiveAccess()` backstops on every token-spending route/action
- `src/app/(auth)/login/page.tsx` — `shouldCreateUser:false` + reciprocal link
- `src/app/(auth)/request-access/page.tsx` (Sonnet) + Turnstile widget
- `src/app/access-pending|declined|suspended/*`, `src/app/access-state-card.tsx`
- `supabase/config.toml` — `enable_signup=false`

**Explicitly EXCLUDED from the commit:** `src/app/(app)/projects/[projectId]/workspace-client.tsx` (dirty from unrelated design work — Codex flagged; must not ride this cut). Scope the commit to the files above only.

---

## 1. Security gate (Opus owns) — ✅ DONE

- [x] `0031` + `current_access_status()` reviewed — RLS-deny-all on new tables, SECURITY DEFINER with `set search_path`, identity from `auth.uid()`/JWT, `revoke anon`/`grant authenticated`, fail-closed `pending`.
- [x] `middleware.ts` gate reviewed — `isPublic` exemptions avoid redirect loops, fail-closed on RPC error.
- [x] Public `POST /api/access-requests` reviewed — zod-bounded, honeypot, IP/UA rate-limit, pending-dedupe, uniform `success()` (no enumeration oracle).
- [x] Turnstile siteverify reviewed — verifies before insert, fails closed, anti-enumeration preserved.
- [x] `requireActiveAccess()` backstops every token-spending route; `/api/query` side door closed.
- [ ] **Final pre-merge re-scan** of `main…<cut tip>` immediately before merge (catch anything new).

## 2. DB precondition — ✅ DONE

- [x] `0031_access_gate.sql` applied to **production** (Jimmy, "fired successfully").
- [ ] Confirm at smoke-test: `current_access_status()` returns `active` for a known member (so the gate doesn't bounce real users).
- Additive-only; no Migration B / tightening deferred work in this cut.

## 3. Env / config — ✅ (confirm live on deploy)

- [x] `NEXT_PUBLIC_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` set in Vercel prod + `.env.local`. ⚠️ **Missing secret = form silently stores nothing.** Take effect on this deploy.
- [x] Supabase hosted dashboard: **Allow new users to sign up = OFF**, manual linking off, anonymous off (saved). Confirm email off = fine for invite/magic-link.
- [ ] `NEXT_PUBLIC_APP_URL = https://www.getdiscos.com` present (drives invite links).
- [x] Cloudflare Turnstile widget: Managed mode, hostname `getdiscos.com`.

## 4. Build / hygiene (on the cut)

- [x] `npm run type-check` + `npm run build` green (Codex + Sonnet confirmed).
- [ ] Re-confirm `npm run build` green on the committed cut tip (post-commit, scoped).
- [ ] Commit is scoped to §0 files — `workspace-client.tsx` NOT included.

## 5. Deploy + smoke test (getdiscos.com, post-merge) — the critical ones

- [ ] **An ACTIVE user (you) reaches `/projects` and is NOT bounced to `/access-pending`.** ← the highest-risk check; the middleware fails closed, so this proves `0031` + the RPC are live and correct.
- [ ] An authenticated org-less test account lands on `/access-pending` (gate works).
- [ ] `/request-access` renders the Turnstile widget; a real submission creates a row visible in the admin queue (proves `TURNSTILE_SECRET_KEY` is live — not a black hole).
- [ ] An existing invited member signs in normally (magic-link / password) — unaffected.
- [ ] A token-spending action (e.g. ingest) by a non-active principal is refused by `requireActiveAccess`.

## 6. Rollback

- [ ] Vercel **instant rollback** to the previous deployment if any smoke step fails. Code rollback is instant.
- [ ] `0031` is additive — no DB rollback needed; leaving the new tables/function in place is harmless even if code is rolled back.

---

## Execution order (no shortcuts)
1. Codex commits the §0 packet (scoped) to `codex/spec-research-ontology`.
2. Opus: final pre-merge re-scan (§1 last box) + build re-confirm (§4).
3. **Jimmy executes the merge to `main`** (= Vercel deploy) on Opus's greenlight. Opus does not push `main` unilaterally.
4. Both: run §5 smoke tests on getdiscos.com. Roll back (§6) on any failure.
