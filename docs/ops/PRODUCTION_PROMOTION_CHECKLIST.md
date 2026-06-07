# Production Promotion Checklist — DiscOS → getdiscos.com

**Owner / driver:** Opus (PM). **SQL + deploy executor:** Jimmy. **Code fixes:** Codex (backend/gated) / Sonnet (design-lane).
**Created:** 2026-06-07. **Status:** Cut #1 (rebrand + #14 + invites) — pre-flight.

This is the gate between feature branches and the live site. Nothing reaches `getdiscos.com` except through this checklist. One cut = one promotion; we re-run this list for each future cut.

---

## 0. The core decision — what ships in Cut #1

`main` (← what Vercel deploys to production) is stranded at `8cf9a82` — the **pre-rebrand app**. That is why the live site shows none of this sprint's work.

`feat/phase-1-rail` contains, in order:

| Commit | Content | Ship in Cut #1? |
|---|---|---|
| …→ `c3e8560` | #14 store-side sanitiser, backfill, prompt hardening, org-invites | ✅ (reviewed, gate-passed 2026-06-07) |
| `6ade2e7` | Phase 2 token sweep + disabled invite form | ✅ design-lane |
| `ebd3dc8` | 2A markup contract + BarChart CSS | ✅ design-lane |
| `13adb0b` | 2C ⌘K palette | ✅ design-lane (no new sink/endpoint) |
| `5dfc7a3` | **WIP** structural-port checkpoint (modals/directory/pipeline/workspace) | ❌ **unfinished — must NOT ship** |
| `ba8aeda` | docs reorg | n/a (not served) |

**DECISION: Cut #1 is `main … 13adb0b`.** The WIP structural ports (`5dfc7a3`) are excluded — they ship in a later cut when each surface is finished and gated. Mechanism: branch `release/cut-1` off `13adb0b`, PR → `main`, Opus gates, merge, Vercel deploys.

---

## 1. Security gate (Opus owns) — ✅ DONE 2026-06-07

- [x] #14 store-side + render-side sanitiser reviewed (B1/B2) — gate-pass recorded in `OPUS_SECURITY_CHANNEL.md`.
- [x] org-invites route reviewed (C3 — user-scoped, no `accept_invite`/service-client write).
- [x] Prompt hardening (A4) + claim cap reviewed.
- [x] 2A/2C confirmed design-lane: no new `dangerouslySetInnerHTML`, no new endpoint, no `createServiceClient`, no middleware/auth touch (`git diff c3e8560..13adb0b`).
- [ ] Final pre-merge re-scan of `main…release/cut-1` immediately before merge (catch anything that lands between now and the cut).

## 2. DB precondition — **BLOCKER** (Jimmy confirms, then runs if needed)

The #14 code **writes and reads `content_html`**. If production's DB lacks that column, the documents path errors on first write.

- [ ] **Confirm which database the backfill + 0028/0029 ran against** — production, or a dev/staging DB? (The backfill used `.env.local` creds.)
- [ ] If it was **not** production: on the **prod** DB, in order — apply `0028` (add nullable `content_html`) → run the backfill script → apply `0029` (precondition gate, must return zero nulls).
- [ ] Migration **B** (tighten `content_html` NOT NULL + drop `content_md`) stays **deferred** — explicitly NOT part of Cut #1.

## 3. Env / config (Jimmy confirms in Vercel + Cloudflare)

- [ ] `NEXT_PUBLIC_APP_URL = https://www.getdiscos.com` — drives invite `acceptUrl`; wrong value sends invites to the wrong host.
- [ ] Supabase URL + anon key, **service-role key** (Inngest background jobs need it), LLM provider key(s), email/Resend key, Inngest keys — all present in Vercel **production** env.
- [ ] `getdiscos.com` added as a custom domain on the Vercel project (not just pointed at Cloudflare).
- [ ] Cloudflare: SSL **Full (strict)**; proxy → Vercel; **do not cache** authenticated `/` app routes or `/api/*` (cache static assets only). Verify no "always-online"/aggressive caching on app routes.

## 4. Build / hygiene (run on the cut)

- [ ] `npm run build` green on `release/cut-1` (type-check + build).
- [ ] No `window.DATA` / mock reads in shipped code (grep).
- [ ] Inngest functions deploy/register against prod (compose-artifact, ingest, extract-entities) — confirm the prod Inngest app is wired.

## 5. Deploy + smoke test (on getdiscos.com, post-merge)

- [ ] App shell loads — rail renders, theme toggle + persistence work, light/dark both intentional.
- [ ] Open a document → reader renders **sanitised** `content_html`, **citations intact**, fail-closed path not triggered.
- [ ] ⌘K palette opens; Ask returns a real answer via `api/ask`; Jump navigates.
- [ ] Invite flow end-to-end: send invite (email arrives, link points at getdiscos.com) → accept → membership created via `accept_invite`.
- [ ] Ingest a source → claims extracted, no internal-speaker leak regression (Jake case).

## 6. Rollback

- [ ] Vercel **instant rollback** to the previous deployment if any smoke-test step fails. (Code rollback is instant; a *migration* rollback is not — that's why 0028 is additive/safe and Migration B is deferred.)

---

## Post-Cut-1

Structural ports (2B/2D/2E/2F/2G/2H) continue on `feat/phase-1-rail`. Each finished + gated surface promotes in **Cut #2+** via this same checklist. 2A's sanitiser-allowlist expansion, when it lands, is a mandatory B2 review before its cut.
