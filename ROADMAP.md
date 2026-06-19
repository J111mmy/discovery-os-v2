# DiscOS Roadmap

Live working document. Move items up or down freely — this is the conversation surface, not a contract.

Each item has a rough size: **S** (one session), **M** (2–3 sessions), **L** (week+).

---

## 🎯 Current focus (2026-06-18) — quality before billing

> North star: *traceability is the product* (`docs/VISION.md`). Anchor lives in `CLAUDE.md` → Guiding Light. Sequence changes only by a conscious decision recorded here.

**Billing is PARKED** (Jimmy, 2026-06-18). Reason: the product cannot charge for trust it does not yet deliver, evidence + entity quality must be solid first (it currently invents junk people, misses explicitly-named people, and misspells named companies).

**Order of work now:**
1. **🔄 Ask track** (in flight, building on WO-1 ✅): WO-2 Continue-in-Ask · WO-3 Safari layout · WO-4 ontology-aware Ask · streaming backend.
2. **🔜 Entity/trust quality cluster** (next epic, the north star made real): **#41 pre-ingest speaker/org scan** (keystone) → fixes **#39** junk people, **#40** company quality, **#36** internal-speaker leak. Honor inline identity/correction notes; preserve named entities verbatim.
3. **🔜 Supporting quality/admin:** #42 admin org table bug, #38 claim-verification `created_at`, #35 Ask rendering polish, #33 staging environment (would have caught this week's prod-only 400s).
4. **⏸ Billing epic + onboarding** — parked; revisit only by conscious decision once quality holds.

Shipped since the last roadmap refresh (2026-06-04): #25 opportunities, #26 traceable compose, #30 JSON hardening, #32 invite-only sign-in gate, #35 Ask attribution (WO-1), WO-5 ingest cost fix (~40x cheaper, validated on prod). Mark older sections ✅ accordingly.

---

## Status key

| Symbol | Meaning |
|---|---|
| ✅ | Done |
| 🔄 | In progress |
| 🔜 | Next up |
| 💡 | Idea / not yet scoped |
| ⏸ | Parked — good idea, low priority right now |

---

## Immediate actions required from Jimmy

These are not build work — they are operational steps needed right now before the system works fully.

- [x] Confirm migrations `0017_actions_and_requests.sql` and `0018_competitor_digest.sql` are applied locally and remotely
- [x] Run migration SQL: `0019_research_context_and_ai_grading.sql`
- [x] Add `INNGEST_SIGNING_KEY` to Vercel environment variables — confirmed present 2026-05-24
- [x] `git add -A && git commit -m "feat: AI evidence grading backend" && git push`
- [x] Hand `CODEX_BRIEF_PROJECT_CONTEXT_UI.md` to Codex
- [x] Apply migration `0020_super_admins.sql` in Supabase SQL editor (local + remote) — applied; confirmed working 2026-06-02
- [x] Grant super admin: `INSERT INTO super_admins (user_id, granted_by) VALUES ('<your_user_uuid>', '<your_user_uuid>');` — granted; `/admin` access confirmed
- [x] `git add -A && git commit -m "feat: super admin — cross-org dashboard, org detail, impersonation" && git push` — pushed; deployed to prod (62a7510)
- [ ] **Before billing goes live:** Set a monthly spend limit on your Anthropic account (console.anthropic.com → Settings → Limits). Start at 2–3× your expected monthly LLM cost based on projected users. This is a 2-minute console action, not a build task — it's the backstop against any session entitlement bug or unexpected usage spike that slips through.

---

## ⭐ Milestone 0 — Veyor as first design-partner org (unpaid)

**Goal:** Jimmy's Veyor team all log into the *same* Veyor org and see every project in it, securely, with real confidential GC research loaded. This is the first real multi-user test. **Billing is NOT on this critical path — "unpaid" means no entitlement/Stripe work is required.** The entire billing epic below defers until after this milestone.

**Critical path: 0 → 1 → 2 → 3 → 4.**

- **0. Super admin active** — ✅ done (Jimmy confirms `/admin` access works today; migration 0020 applied, grant in place).
- **1. Security assessment (the gate, `L`)** — see active build below. Run by **Opus 4.8 as an independent reviewer** (Codex wrote the backend, so review is deliberately separated from the author). Must clear tenant isolation, RLS, super-admin/impersonation bleed, and the invite flow before teammates load confidential research.
- **2. Active org context cleanup (`S`)** — pulled UP out of the billing epic; it is the functional blocker for cross-project team access. See item below.
- **3. Resolve blocker findings** from the assessment.
- **4. Invite the team** — 🔄 **IN PROGRESS (2026-06-04).** Test member (`onetendegrees+member@gmail.com`) manually added to org via SQL workaround (accept-invite journey was interrupted by magic-link sign-in; `next=` param dropped). Awaiting email rate-limit reset to confirm sign-in + project visibility. Two Codex tasks queued before real teammates are invited: (a) fix `next=` param persistence through magic-link auth; (b) convert `accept-invite/page.tsx` from Server Component to Server Action so `setActiveOrgId` cookie actually persists. Migration `0025_standardize_membership_policies.sql` (34 policy cleanup, authored + Opus-reviewed) pending apply after invite test confirmed.

> **Onboarding runbook — invite-only.** Never tell a teammate to "just sign up." Self-signup + first-project creation auto-provisions a *new isolated org* (`ensureUserOrg` in `src/lib/auth/org.ts`, called from `projects/new/actions.ts:29`). Teammates must arrive through an invite link, which correctly attaches them to the existing org (`accept-invite/page.tsx:77`).

### Org-model findings from initial code review (2026-05-31, Opus)

| ID | Severity | Finding | Action |
|---|---|---|---|
| GOOD | — | Tenancy is **not** domain-based. Boundary = explicit `org_members` rows + RLS. Email domain only sets a new org's default display name (`org.ts:25`). | No change. Disproves the domain-tenancy worry. |
| ORG-1 | High (verify) | `accept-invite` inserts `org_members` via the **regular** client (`accept-invite/page.tsx:77`), depending on RLS. Confirm RLS permits the invited insert but **forbids a user self-inserting a membership into an arbitrary `org_id`** (would be a critical self-join hole). | Assessment task; fix RLS or move to service-role insert with server-side invite validation. |
| ORG-2 | Med (verify) | `org_invites` read by token via regular client (`:42`). Confirm RLS read policy can't be abused to enumerate invites. | Assessment task. |
| ORG-3 | Med (verify) | Super admin gets **unrestricted, no-org-filter** project access when not impersonating (`org.ts:110-119`). Intentional support path. | Confirm `isSuperAdmin` is strictly table-backed and unreachable by non-admins. |

---

## Now — active build

### ✅ Security technical assessment — full audit pass
**Completed 2026-06-03.** Verdict: LOW risk. Invite-only for Veyor milestone.
**Output:** `SECURITY_ASSESSMENT_MILESTONE_0.md` — executive summary, 7-row findings table, tenant isolation proof (dynamic, anon key + real JWT). All blocker/high/med findings RESOLVED. SEC-RLS-2 (34 inline `org_members` subqueries) authored as `0025_standardize_membership_policies.sql` — Opus-reviewed + approved, pending apply after Jimmy invite test.
**Residual (non-blocking):** 0025 apply, Vercel env audit (Codex), Inngest signing-key confirmation (Codex).
**Size:** L

### 💡 #9 — Companies area: categorisation (NEEDS JIMMY PRODUCT DECISION, not a build yet)
**Status correction (2026-06-04):** Inline field editing **already exists** — `company-profile-editor.tsx` does per-field save-on-blur (name, website, industry, size, notes) via `PATCH /api/companies/[companyId]`. The "make it editable" half of #9 is shipped.
**The actual open question (from issue #9):** the Companies list conflates distinct categories — real customer companies, potential integrations (EC3, SharePoint), Jimmy's own company (Veyor), and competitors (Procore). Jimmy explicitly said "we need to discuss before applying solutions." Options to decide: tabs/categories on companies, a `company_type` field, or folding competitors into this surface. **No Codex brief until the categorisation model is decided with Jimmy.**
**Size:** TBD (depends on the decision)

### 🔜 #14 — MD → HTML document surface (prerequisite for AI-Improve)
**Why:** The artifact/document surface currently renders Markdown. Moving to HTML: (a) unlocks the AI-Improve diff view and richer document editing; (b) is required before text-selection AI-Improve (#18) is safe (MD byte-offset mapping is brittle under edits).
**Security note (C5 from Gate 3 review):** Once `proposed_content` can be HTML, unsanitised AI output is a stored-XSS vector. Server-side HTML sanitisation (allowlist on `proposed_content` at write and render) must land with this migration. Tracked on this issue.
**Dependency for:** AI-Improve thin slice — do not start that build until #14 is deployed.
**Size:** S

### 🔜 AI-Improve — thin first slice (#10: AI-assisted document revision)
**Design gates passed:** Gate 1 ✅ frame agreed · Gate 2 ✅ look & feel (`GATE2_AI_IMPROVE.html` prototype approved) · Gate 3 ✅ security (`GATE3_SECURITY_REVIEW_AI_PROPOSALS.md`, conditional pass C1–C7, 2026-06-04).
**What Gate 4 builds (whole-document only):**
- `ai_proposals` table (migration — Codex authors, Opus reviews before apply)
- Accept RPC — `SECURITY INVOKER` (C1); stale-state guard → 409 (C5); immutable content columns (C3)
- `/api/artifacts/[id]/improve` route — auth gate per C6; prompt fencing per C4; rate-limit stub per C7
- UI: "Improve" button on document scope + diff panel + Accept / Try again / Keep original (per Gate 2 prototype)
- `artifact_versions.from_proposal_id` FK — audit loop closes from day one
**Deferred:** Text-selection improve (#18 — brittle until #14 ships). Duplicate-person merge (#1 — graph consequences, much later).
**Gate 4 decision:** Jimmy uses it on real content → decides whether pattern rolls to next surface.
**Dependency:** #14 must be deployed first.
**Security:** All C1–C7 from `GATE3_SECURITY_REVIEW_AI_PROPOSALS.md` must be implemented. `ai_proposals` migration gets same before-apply Opus review as every DB change.
**Size:** M

### 🔜 Stripe billing + self-serve onboarding
**Why:** The app needs to become a real product — users should be able to sign up, create a workspace, start a trial, and subscribe without Jimmy's involvement.
**Pricing model decided:** Subscription + Credits (mirrors Anthropic/Cursor pricing). Flat monthly tier with included session allowance; credit top-ups for overages. Sessions are the metered unit — one session per ingest, compose, synthesis, ask query, or digest trigger.

**Tiers:** Free (5 sessions), Starter $19/50, Growth $49/130, Pro $99/230, Team $249/600, Enterprise $499/1,300. Annual = 20% off (monthly × 10). Credit blocks from $25/45 sessions to $200/367 sessions — no expiry, org-scoped.

**What to build:**
- `0021_billing_schema.sql` — `org_subscriptions`, `credit_ledger`, `stripe_events` tables
- `0022_credit_system.sql` — Postgres functions for session consumption and entitlement checks
- Stripe webhook handler (`/api/stripe/webhook`) — subscription lifecycle events
- Checkout + customer portal routes (`/api/billing/checkout`, `/api/billing/portal`)
- Entitlement enforcement in API routes — check session budget before queuing any AI job
- `/onboarding` flow — explicit org creation, plan selection, trial start, first project CTA
- `/settings/billing` — current plan, session usage, credit balance, upgrade/top-up
- Admin billing section in `/admin/orgs/[orgId]` — current plan, force-upgrade, grant credits
- UI banners for trial countdown, usage warnings, hard-blocked state

**How API costs work:** Anthropic bills monthly in arrears on a single account — no pre-buying tokens. All customer usage flows through one Anthropic API key; the `credit_ledger` table tracks cost attribution per org. The session entitlement system (`consume_session` Postgres function) blocks any API call the moment an org's session budget is exhausted, which handles the *volume* spike risk. The residual risk is cost variance *within* a session (a 3-hour transcript costs ~10× more than a 10-minute one, both count as one session). An Anthropic account-level monthly spend limit is a one-minute console setting that acts as the final backstop — not a build task, just an operational action before go-live (see below).

**Reference docs:** `MONETIZATION_REQUIREMENTS.md`, `SAAS_BILLING_ONBOARDING_REQUIREMENTS.md`, `CODEX_BRIEF_ORG_ONBOARDING_BILLING.md`
**Dependency:** Security assessment should complete first — billing touches auth, org creation, and entitlements, which must be clean before money flows through them.
**Size:** L (multi-session, probably 3–4 Codex sessions)

### ✅ Internal speaker flagging (backend)
**What was built:** `affiliation` field on people table, ingest pipeline now queries internal people before extraction and passes them to Claude so their turns are treated as context, not evidence. New source types (`customer_interview`, `sales_call`, `usability_study`, `internal_meeting`) parse as conversations. Ingest API route updated to accept new values.

### ✅ Internal speaker flagging (UI) + source type dropdown
**What was built (Codex, 31cc401):** Affiliation badge on people list, one-click affiliation toggle on person detail page, source type dropdown updated to human labels (`Customer interview`, `Sales call`, etc.), `PATCH /api/people/[personId]/affiliation` with org_id guard.

---

## Next — high priority

### ✅ Architecture, reliability, and security hardening — audit complete
**What was audited:** All 20 API routes, 13 Inngest functions, 18 migrations, LLM client, and full event graph.
**One fix applied:** `artifacts/[id]/status/route.ts` was missing `org_id` scoping on the artifact query — any authenticated user could access any artifact by UUID. Fixed by adding org membership lookup and `.eq("org_id", membership.org_id)`.
**Everything else passed:**
- RLS: all 18 tables enabled, all policies use `auth_user_org_ids()` correctly
- Service-role: strict separation — Inngest functions only, API routes auth first
- LLM payloads: no credentials or internal IDs sent to model; transcript content intentional
- Event graph: all 13 functions catch errors, log to `agent_runs`, idempotent where needed
**Remaining (not blocking, future work):**
- Observability UI: surface `agent_runs` so users can see job status per source/project
- Prompt/schema Zod validation on every agent output
- Shared server query helpers to enforce `org_id` consistency
- Golden transcript regression test suite
- `INNGEST_SIGNING_KEY` now present in Vercel env — confirmed 2026-05-24
**Reference:** See [ARCHITECTURE_SECURITY_HARDENING.md](ARCHITECTURE_SECURITY_HARDENING.md).
**Size:** L

### ✅ Rich people profiles
**What was built:** `synthesise-person.ts` Inngest function, `person-digest-v1` prompt, migration 0014, `POST /api/people/[personId]/synthesise`. UI shipped by Codex (8b19ede): "Intelligence brief" section on person detail page, `DigestRefreshButton` client component, date of last generation shown.

### ✅ Rich company profiles
**What was built:** `synthesise-company.ts` Inngest function, `company-digest-v1` prompt, migration 0016. UI shipped by Codex (a0e2e4b + 139da19): company detail page with digest, people roster, project links, evidence mentions, Refresh digest button. Person detail pages now link company names through to the company profile.
**Architecture note:** Company detail page fetches via `GET /api/companies/[companyId]` (API route + server component both query the same shape). Fine for now; worth consolidating into a shared server helper once this layer settles.

### ✅ Rich competitor profiles + battle cards
**What was built:** `synthesise-competitor.ts` Inngest function, `competitor-digest-v1` prompt, migration 0018, `POST /api/competitors/[competitorId]/synthesise`, competitor list/detail pages, digest refresh button, evidence mentions, and a battle card with AI-filled fields plus editable `your_counter` and `one_proof_point`.
**Still future:** Win/loss records after deals involving a competitor — log why you won or lost and which gap was decisive.
**Size:** M

### ✅ Compose via Inngest
**What was built:** `compose-artifact.ts` Inngest function. Route handler creates stub artifact, fires `artifact/compose.requested`, returns `artifact_id` immediately. Editor polls `/api/artifacts/[id]/status` every 2 seconds until done or failed. No timeout risk on large evidence sets.
**Size:** M

### ✅ Session review skill
**What was built:** `session-review.ts` Inngest function, `session-review-v1` prompt, chained from ingest. 6-section narrative brief: Summary / What they want / Product reactions / Friction / Notable quotes / Follow-up. UI shipped by Codex (852f6ff): session brief card on source detail page, artifact detail page with markdown rendering.

---

## 🔜 SaaS billing and monetisation — next major milestone

**When this ships, DiscOS can take a credit card from a stranger and guide them to their first discovery session without any help from Jimmy.**

Pricing model decided: **Sub+Credits tiered subscription** — flat monthly fee with included session allowance, credit top-up blocks for overages. Full spec in `MONETIZATION_REQUIREMENTS.md`. Build instructions in `CODEX_BRIEF_ORG_ONBOARDING_BILLING.md`.

Estimated build: **17–19 engineering days (~4 weeks full-time).**

### ✅ Active org context cleanup → **moved to Milestone 0, done (commit f2b8b97, deployed 62a7510)**
**What was built:** `getActiveOrgId()` helper (`src/lib/auth/org.ts`) — impersonation cookie → `disco_active_org` cookie → `joined_at`-first deterministic fallback. `setActiveOrgId` fires on accept-invite + org creation. All ad-hoc first-row org lookups replaced. Opus audited: no remaining unscoped lookups.
**Known gap (non-blocking):** `setActiveOrgId` silently fails when called from a Server Component (Next.js App Router limitation — try/catch swallows the error). Single-membership users are unaffected (fallback resolves correctly). Multi-org users need the accept-invite Server Component → Server Action conversion (Codex task, queued for Milestone 0 close-out).
**Size:** S

### ✅ Invite acceptance — RLS authz path + delivery (DONE, validated 2026-06-04)
**Why:** Live test (2026-06-04) proved invitees **cannot accept their own invite**. Two RLS walls: `org_invites` SELECT is owner/admin-only (0023) → invitee can't read their invite (`not-found`); `org_members` INSERT is owner/admin-only (0012) → invitee can't add themselves (`insert-failed`). 0025 does NOT fix this. The route hardening (commit d8a0671) was necessary but insufficient.
**Fix (shipped):** `SECURITY DEFINER` RPC `accept_invite(p_token)` — escalates in one place, authorizes caller by `auth.jwt()->>'email'` vs invite email; no widened invitee RLS. Plus delivery fix: carry invite token in redirect **path**, not the dropped `next` query param.
**Outcome:** migration `0027` + route refactor Opus-reviewed & applied; member2 went `No projects yet` → org's 3 projects (`memberships: 1`, `accepted_at` stamped). Acceptance path confirmed working.
**Reference:** `CODEX_BRIEF_INVITE_RLS_AND_DELIVERY.md`.
**Note:** acceptance only fires via the invite link (token in path) or pending-invite cookie — a plain `/login` magic link authenticates but does NOT accept (e.g. member4 stuck pending until sent to `/accept-invite?token=…`). Onboarding must route invitees through the invite link.
**Size:** M

### ⛔ Invite email delivery — branded app-sent email (built, Opus-approved; BLOCKED on Resend config + live Gate #0)
**Why:** Confirmed 2026-06-04 — Supabase's built-in email service is "testing only" and hard-throttled (a few/hour, per project). We hit `email rate limit exceeded` (surfaced in the Invite UI), blocking end-to-end invite testing. Built-in template also says "Sign in" and can't be reworded (it serves normal login too).
**Fix (shipped, awaiting deploy):** invite path now uses `auth.admin.generateLink()` (no Supabase email sent) + app-sent **branded** email via Resend. Off Supabase's email *send* throttle; correct "You've been invited to DiscOS" copy; one click. `invite`→`magiclink` type fallback for new vs existing users. **Codex built it (5 files); Opus reviewed the diff 2026-06-05 — APPROVED, cleared to commit + push.** Reference: `CODEX_BRIEF_BRANDED_INVITE_EMAIL.md`.
**Remaining (Jimmy-side):**
1. Resend account + `RESEND_API_KEY`/`EMAIL_FROM` in Vercel (free tier: 100/day, no domain needed via `onboarding@resend.dev`; swap to own domain when bought).
2. **Live Gate #0 (make-or-break):** first real click must land on `/auth/callback/<token>?code=…`. If `#access_token=…`/implicit-flow shape, resolve flow type before trusting prod.
3. Existing-user invite exercises the `magiclink` fallback; missing-env returns clean failure with no link leak.
**Separate, complementary (config, not blocking this):** custom SMTP in Supabase → Auth → SMTP Settings fixes sender + throttle for *normal `/login`* magic links (still Supabase-sent). Different surface from the invite email above.
**Backlog (non-blocking):** repeated invites to same email pile up duplicate pending `org_invites` rows (member3/member4 live data) — future `on conflict`/dedupe ticket.
**Size:** S (Resend config) + done (branded email code) + S (optional Supabase SMTP for login mail)

### 🔜 Billing schema — plans, credits, ledger
**Why:** Foundation for everything. No billing UI or enforcement can be built without the schema.
**What:** Migrations 0021 and 0022. `plans`, `credit_packages`, `org_credits`, `credit_ledger` tables. `consume_session` and `credit_sessions` Postgres functions. Backfill existing orgs as Growth trial.
**Reference:** Task 1 in `CODEX_BRIEF_ORG_ONBOARDING_BILLING.md`, Sections 4 and 5 in `MONETIZATION_REQUIREMENTS.md`
**Size:** S

### 🔜 Org onboarding flow
**Why:** New users currently land with no workspace and no guidance. Needs explicit workspace creation → trial activation → first project path.
**What:** `/onboarding/workspace` → `/onboarding/trial` → `/onboarding/first-project`. Middleware redirect for users with no org. Trial activation without a card (14-day Growth trial).
**Reference:** Task 3 in `CODEX_BRIEF_ORG_ONBOARDING_BILLING.md`, Section 9 in `SAAS_BILLING_ONBOARDING_REQUIREMENTS.md`
**Size:** M

### 🔜 Stripe checkout, portal, and webhook
**Why:** The payment rails. Without these, subscriptions and credit purchases cannot be processed.
**What:** `POST /api/billing/checkout` (subscription), `POST /api/billing/portal`, `POST /api/billing/credits/checkout` (one-time credit blocks). Webhook handler for all subscription lifecycle events. Idempotent event processing via `billing_events` table.
**Reference:** Tasks 4 and 5 in `CODEX_BRIEF_ORG_ONBOARDING_BILLING.md`
**Size:** M

### 🔜 Session entitlement enforcement
**Why:** Without server-side gating, paying and non-paying users get the same access. This is the moment billing becomes real.
**What:** `getOrgEntitlements()` helper. `consumeSession()` call added to ingest, compose, ask, digest, and frame draft routes. 402 responses with clear `code: no_sessions` error shape for the UI to act on.
**Reference:** Task 6 in `CODEX_BRIEF_ORG_ONBOARDING_BILLING.md`, Section 7 in `MONETIZATION_REQUIREMENTS.md`
**Size:** M

### 🔜 Billing UI — settings page, session counter, banners
**Why:** Users need to see their plan, session usage, and credit balance. Owners need to manage billing and buy credits without calling anyone.
**What:** `/settings/billing` page with plan info, session progress bar, credit purchase grid, usage history. Session counter in nav. Global billing banners (trial expiring, payment failed, no sessions). Disabled states on operation buttons.
**Reference:** Task 7 in `CODEX_BRIEF_ORG_ONBOARDING_BILLING.md`, Section 8 in `SAAS_BILLING_ONBOARDING_REQUIREMENTS.md`
**Size:** M

### 🔜 Admin billing view
**Why:** Support tooling. Jimmy needs to be able to inspect any org's billing state, resync from Stripe, add sessions manually, and extend trials.
**What:** Billing section added to `/admin/orgs/[orgId]`. Resync from Stripe, add sessions (admin adjustment), extend trial — all with audit trail.
**Reference:** Task 8 in `CODEX_BRIEF_ORG_ONBOARDING_BILLING.md`, Section 12 in `SAAS_BILLING_ONBOARDING_REQUIREMENTS.md`
**Size:** S

---

## Pricing model — decided

| Tier | Monthly | Sessions included |
|---|---|---|
| Free | $0 | 5 (one-time, not monthly) |
| Starter | $19 | 50 |
| Growth | $49 | 130 |
| Pro | $99 | 230 |
| Team | $249 | 600 |
| Enterprise | $499 | 1,300 |

Credit top-ups: $25 / $50 / $100 / $200 blocks. Do not expire. Org-scoped.
Annual: 20% discount (monthly price × 10).

Full model decision rationale in `MONETIZATION_REQUIREMENTS.md`.

> ⚠️ **Pricing needs a reassessment before billing ships (Jimmy, 2026-05-31).** Two concerns: (1) the Sub+Credits model with six tiers may be more complicated than it needs to be; (2) the **signup backfill problem** — a new user's first instinct is to bulk-load their entire history of old research, which collides head-on with a 5-session free tier. A user with 30 archived transcripts is hard-blocked on day one. Options to think through: a one-time onboarding "import allowance" separate from the monthly session meter, a higher/uncapped trial window for initial backfill, or pricing the first bulk import differently. **Do not finalise tiers until this is resolved.** Parked deliberately late — revisit at the start of the billing epic, not before.

---

## Medium priority

### ✅ Action extraction
**What was built:** `extract-actions.ts` Inngest function, `action-extraction-v1` prompt, migration 0017 (`actions` + `product_requests` tables with RLS), `GET /api/sources/[sourceId]/actions`, `PATCH /api/actions/[actionId]`, source detail actions checklist with optimistic status updates, and product requests on both source detail and project overview.
**Size:** S

### ✅ Frame auto-generation from first transcript
**What was built:** `draft-frame.ts` Inngest function, `frame-draft-v1` prompt, migration 0015 (`frame_draft` jsonb + `frame_draft_generated_at` on projects), chained from `ingest-source`. UI shipped by Codex (8b19ede): draft banner in project settings (the app's frame surface) with Accept/Discard controls. `PATCH /api/projects/[projectId]` updated to accept partial updates safely, fixing a latent bug where omitted fields could null settings.
**Size:** S

### 🔜 Project settings page UX overhaul
**Why:** The settings page form has broken textarea behaviour (fixed height with scrollbars), misaligned navigation, paired fields at different heights, and a "Suggest from evidence" button that only fills the Research focus section — leaving Project Frame, Operating Style, and GTM Context empty. Post-save, there is no prompt to re-assess existing evidence against the updated criteria.
**What:** Five targeted fixes: auto-expanding textareas (CSS grid mirror pattern), equal-height paired fields, nav/content alignment at max-w-[780px], expanded "Suggest from evidence" that fills all 9 fields in one AI call, and a persistent post-save banner with a "Re-assess now" action that fires a new `regrade-evidence` Inngest function. New route: `POST /api/projects/[projectId]/regrade`.
**Reference:** `CODEX_BRIEF_PROJECT_SETTINGS_UX.md` — full spec with implementation patterns for each fix.
**Size:** M

### 💡 Adjacent signal routing UI
**Why:** When Claude detects that a signal from one transcript is relevant to a different project, it sets `adjacent_project_hint` in the evidence metadata. But there's no UI to surface or act on this.
**What:** On the evidence detail page and workspace overview, show "Signal relevant to: [Project Name] →" with a one-click route button that copies the evidence reference to the other project.
**Size:** S

### ✅ Claim citations in composed artifacts
**What was built:** Compose prompt updated to instruct Claude to embed `[N]` inline citation markers. `parseCitationMap` in `draft.ts` resolves `N → evidence_id`. `citation_map` stored in `artifact.metadata`. `GET /api/artifacts/[id]/citations` returns citation records with content, speaker, source title. UI shipped by Codex (8bbd577): `ArtifactViewer` client component renders `[N]` as superscript chips, click opens a popover showing the quote + speaker + source. Clicking outside or pressing Escape closes the popover. "Built from N sources" footer. Server component outer page preserved.
**Size:** M

### ✅ Evidence confidence scoring improvements
**What was built:** `src/lib/confidence.ts` utility with four weighted signals: evidence depth (30pts), source diversity (30pts — 4 sources from different sessions > 30 records from 1 source), recency (20pts — decays from 30→60→90→180 days), synthesis breadth (20pts — themes + problems). Project overview updated to use the new model. Weakest signal drives the "Next:" coaching hint.

### ✅ Ask / query interface improvements
**What was built:** `POST /api/ask` route replaces the raw `/api/query` endpoint for the ask page. Retrieves up to 20 semantically relevant evidence records via pgvector, passes them to Claude (standard tier) with the question and project frame/research context, returns a sourced narrative answer with inline `[N]` citations. `ask-interface.tsx` updated: answer renders at the top with superscript citation chips that scroll and auto-expand the corresponding source card. Sources shown as collapsible cards below — only cited records, in citation order. Trust scope toggle retained. Graceful handling for no-evidence and no-citation edge cases.
**Prompt version:** `ask-v1` in `src/lib/llm/prompts/ask.ts`.
**Size:** M

### 💡 Org settings — output preferences and compliance controls
**Why:** Different orgs have different house styles and legal obligations. A B2B SaaS team may want em-dash-free output. An org handling EU customer data may need GDPR-compliant anonymisation. These should be configurable per org, not hardcoded.
**What:** `org_settings` table (jsonb blob, keyed by setting name). Settings UI at `/settings/org` accessible to owners/admins. Initial settings:
- **Writing style** — "No em dashes in AI output", preferred punctuation style, tone (formal / neutral / conversational)
- **GDPR / compliance mode** — when enabled: (a) all new evidence is anonymised before storage (speaker names replaced with roles, e.g. "Participant A"), (b) people records cannot store real names without explicit consent flag, (c) exports include a data-subject disclaimer
- **Participant anonymisation** — manual toggle per person: replaces their name in all rendered evidence with "Participant [N]" without altering the underlying record (display-layer only, reversible)
- **Data residency reminder** — informational flag noting which Supabase region the org's data is in (read-only, no enforcement needed yet)

Settings are read by the LLM prompt builder at compose and ingest time. Writing style prefs go into the system prompt. Compliance mode triggers a separate anonymisation pass before evidence is stored.
**Size:** M

### ✅ Intelligence processing UI
**Why:** After upload, the pipeline is a black box. Users can't see whether entity extraction ran, why synthesis is slow, or what failed. The `agent_runs` table has all the data — it just needs surfacing.
**Backend done:** `GET /api/agent-runs?source_id=&project_id=&limit=` — returns typed `AgentRunSummary[]` with human-readable `output_summary`, `duration_ms`, and error. Handles all 11 agent types.
**UI done:** Source detail pages now show an ambient "Insights being built" card only while processing is running or needs attention. Project overview shows a compact recent-activity pulse.
**Size:** S

### ✅ AI evidence grading (auto-trust)
**Why:** Users shouldn't have to manually review hundreds of evidence snippets. The AI grades each piece against the project's research context and auto-trusts what's clearly relevant — users only see the handful that need a human call.
**Backend done:** Migration 0019 (`research_context` on projects; `ai_trust_grade`, `ai_trust_reason`, `ai_graded_at` on evidence). `grade-evidence.ts` Inngest function (batches of 20, cheap tier, idempotent). Chained from `ingest-source` after every ingest. Auto-sets `trust_scope = trusted` for 'trusted' grade when context is set. Conservative fallback: no context → everything graded 'uncertain'.
**UI done:** Project settings now has a Research focus section (goals, outcomes, buyers, scope in/out, research questions). Evidence review shows "Needs a look" / "Low signal" recommendations, inline keep/dismiss actions, a review nudge for uncertain evidence, and a one-session prompt to add research focus when evidence exists without context.
**Size:** M

---

## Lower priority / future

### ✅ Super admin system
**What was built:** Full cross-org support layer for Jimmy as operator.
- **Migration 0020** — `super_admins(user_id, granted_at, granted_by)` table. RLS enabled but no policies — accessible only via service role key. Zero blast radius: no regular user queries can touch it.
- **`src/lib/auth/super-admin.ts`** — `isSuperAdmin()`, `getImpersonatedOrgId()`, `getImpersonatedOrgName()`, `getAllOrgsWithStats()`, `getOrgDetail()`. All cross-org queries go through the service client.
- **`src/lib/auth/org.ts`** updated — `getUserOrgIds()` and `getProjectForUser()` check impersonation state first, so super admin browsing as an org sees exactly what that org sees.
- **Admin layout + pages** — `/admin` (org table: name, member count, sources, last activity, last run status), `/admin/orgs/[orgId]` (members, projects, recent agent runs). Protected by `isSuperAdmin()` check on every page.
- **Impersonation route** — `POST /api/admin/impersonate` sets HttpOnly `disco_impersonate_org` cookie (session-scoped, secure in prod). `DELETE` clears it. Super admin status re-verified on both endpoints.
- **Support banner** — sticky red banner in the main app layout when impersonating: "🛟 Support mode — viewing as [Org Name]" with an Exit button. "Admin ↗" link added to nav.
**Security:** Cookie is never trusted without first verifying `super_admins` table. Impersonation is always session-scoped (no persistent impersonation across browser closes).
**To activate:** Apply migration 0020 in Supabase, then `INSERT INTO super_admins (user_id, granted_by) VALUES ('<jimmy_uuid>', '<jimmy_uuid>')` via service role.
**Size:** M

### ⏸ Bring Your Own Key (BYOK) — enterprise / power-user option
**Why:** Some customers (larger teams, enterprises) already have their own Anthropic or OpenAI accounts and will prefer to use them. BYOK means their API calls don't touch your Anthropic account at all — your LLM cost for those orgs drops to zero, making their sessions almost pure margin.
**How it works:** Owner pastes their API key into org settings. App stores it encrypted (Supabase vault or similar). All LLM calls for that org use the customer's key instead of the platform key. Customer pays Anthropic directly; they don't pay session credits for LLM-heavy operations (though a reduced platform fee still applies to cover Supabase/support).
**Why parked:** Adds friction at signup and requires maintaining two code paths in the LLM client. Not worth it until the standard managed-account model is proven and there's a specific enterprise customer asking for it. Revisit when the first customer raises it.
**Size:** M

### ⏸ GTM cascade
**Why:** After each ingest, beta candidate signals and outreach gaps should propagate automatically to GTM artifacts. Important for closing the loop from discovery to sales motion.
**What:** After ingest, check for positive evidence with beta interest signals → update beta candidate table → flag missing outreach drafts → optionally sync to CRM/Confluence.
**Size:** L

### ⏸ Skill configs in database
**Why:** Agent prompts should be overridable per org without a code deploy. Currently all prompts are hardcoded in `src/lib/llm/prompts/`.
**What:** `skill_configs` table. Resolution order: org override in DB → code default. UI for prompt editing (admin only). Prompt version tracking so stale overrides are flagged when the code default changes.
**Size:** M

### ⏸ Meta-review / self-improvement loop
**Why:** The system should learn from corrections. If Jimmy consistently edits Claude's output in a certain way, that pattern should surface as a proposed prompt improvement.
**What:** Monthly scheduled Inngest job reads `agent_runs` logs, clusters correction patterns, surfaces proposals to the user. Approved changes update `skill_configs`. Nothing auto-applies.
**Size:** L

### ⏸ Agent observability dashboard
**Why:** When a workflow feels stuck, users should not have to inspect terminal output or Inngest manually. The app should explain what happened.
**What:** Project/source-level processing timeline backed by `agent_runs`: job name, status, started/completed times, output counts, errors, skipped reasons, and safe retry buttons. This should cover ingest, session review, action extraction, synthesis, gap detection, compose, verification, and profile digests.
**Size:** M

### ⏸ Schema reconciliation migration
**Why:** CLAUDE.md flags several naming inconsistencies: `source_segment_id` vs `segment_id`, legacy source kind values, `frame` still as text not jsonb. These don't break anything yet but will cause confusion as the schema grows.
**What:** Migration that aligns column names with the canonical spec. Requires coordinated update of all TypeScript types, API routes, and Inngest functions that reference the changed columns.
**Size:** M (careful — touching many files)

### ⏸ Prototype and testing tracking
**Why:** Phases 5–6 of the discovery loop (Ideas → Prototyping → Testing) have no schema yet. Concepts, prototypes, and test results need to live somewhere.
**What:** `prototypes`, `concepts`, `test_sessions` tables. Prototype feedback ingest variant that captures both evidence AND test result records from the same session.
**Size:** L

### ⏸ Linear and Jira connectors
**Why:** Action extraction is useful standalone, but the real value is when personal commitments route to Linear and product requests route to Jira Product Discovery automatically.
**What:** Plugin/MCP connector for both. Sync is additive — if connectors unavailable, save locally and show "External Sync Pending."
**Size:** L

### ⏸ Post-launch monitoring loop
**Why:** Usage signals from live products should route back into discovery automatically. Phase 11 in the spec — closes the loop.
**What:** Monitoring source type ingestion. Usage data pulled from product analytics tools and treated as evidence with its own classification. Feeds back into synthesis alongside interview evidence.
**Size:** L

---

## Decisions and open questions

| Question | Status |
|---|---|
| Should internal meeting evidence be stored at all, or excluded entirely? | Open — currently excluded from evidence but could be stored as `classification: internal_signal` |
| Should the session review brief replace the evidence count on source cards, or sit alongside it? | Open |
| Prototype and concept tracking: build now or wait until evidence quality is solid? | Parked — evidence quality first |
| Should competitor battle cards be manually authored, AI-drafted, or both? | Open — leaning AI-drafted with human review |
| Should `frame` be converted from text to jsonb now or wait for schema reconciliation? | Open — doing it mid-project is risky; lean toward waiting |

---

---

## Recommended sequencing (RE-LOCKED 2026-06-18 — quality before billing)

> Supersedes the 2026-06-04 "billing next" sequence. Conscious decision by Jimmy: park billing until evidence/entity quality is trustworthy.

1. **Ask track** (in flight) — WO-2 Continue-in-Ask, WO-3 Safari layout, WO-4 ontology-aware Ask, streaming backend. Closes the most visible surface.
2. **Entity/trust quality cluster** — #41 pre-ingest speaker/org scan (keystone) → #39 junk people, #40 company quality, #36 internal-speaker leak. This is the north star (traceable, trustworthy evidence) made real, and a prerequisite to charging anyone.
3. **Supporting quality/admin/infra** — #42 admin org bug, #38 verify `created_at`, #33 staging environment, plus the smaller UX backlog.
4. **⏸ Billing epic + self-serve onboarding** — PARKED. The full spec below stays intact; revisit only by conscious decision once quality holds.

*Last updated: 2026-06-18. The live steering wheel is `CLAUDE.md` → Guiding Light; this file is the detailed sequence; GitHub Issues is the backlog; `docs/VISION.md` is the north star. If a feature is built, mark it ✅ here.*
