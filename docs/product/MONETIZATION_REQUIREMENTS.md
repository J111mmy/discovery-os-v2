# DiscOS Monetization Requirements — Sub+Credits Tiered Pricing

Status: Decided — ready for implementation  
Owner: Product/Engineering  
Last updated: 2026-05-26  
Supersedes: Section 5 open questions in `SAAS_BILLING_ONBOARDING_REQUIREMENTS.md`

---

## 1. Decision Summary

After modelling four monetization approaches (Pay-Per-Use, Subscription + Credits, Tiered Subscription, Hybrid Min+Usage), the **Subscription + Credits** model is the chosen approach. It produces the strongest unit economics at scale, mirrors how Anthropic and Cursor price their own products, and is intuitive to customers who are already familiar with SaaS tiers.

The core mechanic:
- Every org pays a flat monthly subscription that includes a session allowance.
- Sessions consumed above the allowance are billed as credit overages, purchasable in blocks.
- Orgs that don't need overages just stay on their tier. Orgs that grow into heavy usage pay proportionally more — no hard cap, no churn incentive.

---

## 2. What Is a Session?

A session is the atomic unit of metered usage. One session is consumed whenever a user triggers a significant AI operation. This must be defined precisely so entitlement enforcement is consistent.

**Counts as one session:**

- Running discovery ingest on a source (transcript, PDF, audio) — one session per source, regardless of length.
- Generating or regenerating a session review brief.
- Composing or regenerating an artifact (one session per compose trigger, not per save).
- Synthesising a person or company digest.
- Synthesising a competitor profile.
- Running the ask/query interface — one session per question submitted.
- Generating or regenerating a frame draft.

**Does not count as a session:**

- Viewing any page, evidence, source detail, or artifact that already exists.
- Editing artifact text after it has been composed.
- Searching, filtering, or browsing evidence.
- Updating trust scope, affiliation, or metadata on existing records.
- Admin/super-admin operations.
- Background maintenance tasks (evidence grading, backfill jobs).

**Session logging:**

Every session event must be written to a `credit_ledger` table at the point of consumption, before the AI job is queued. If the entitlement check fails, no session is logged and no job is queued. Session counts are derived from `credit_ledger`, never from Inngest event counts.

---

## 3. Tier Structure

### 3.1 Subscription Tiers

| Tier | Monthly Price | Sessions Included | Target Persona |
|---|---|---|---|
| Free | $0 | 5 | Evaluation / solo trial |
| Starter | $19 | 50 | Solo PM, early-stage team |
| Growth | $49 | 130 | Active team, 1-3 PMs |
| Pro | $99 | 230 | Growing team, multiple projects |
| Team | $249 | 600 | Department-level usage |
| Enterprise | $499 | 1,300 | Large org, volume usage |

Annual pricing: 20% discount on the monthly rate, billed upfront. Monthly price × 10 for an annual subscription (e.g. Growth annual = $490/year vs $588/year monthly).

### 3.2 Overage / Credit Top-Ups

When an org exhausts its included sessions, usage is blocked unless they have a credit balance. Credits are purchased in blocks:

| Block | Price | Sessions Covered | Cost per Session |
|---|---|---|---|
| Small | $25 | 45 sessions | $0.56 |
| Medium | $50 | 91 sessions | $0.55 |
| Large | $100 | 183 sessions | $0.55 |
| XL | $200 | 367 sessions | $0.54 |

Credit blocks do not expire and carry over month to month. They are org-scoped, not user-scoped.

**Overage rate derivation:** Raw all-in cost per session ≈ $0.35 (LLM tokens + vector storage + egress). Markup of 55% → $0.35 × 1.55 = $0.5425 per session. Rounded to clean block sizes.

### 3.3 Free Tier Rules

- 5 sessions total (not per month — a one-time allowance).
- No payment required.
- No credit top-ups available on Free tier. Must upgrade to purchase credits.
- Read-only access remains after 5 sessions are exhausted.
- 14-day trial of Growth tier available: owner can activate once, no card required.
- After trial expires: falls back to Free entitlements, existing data read-only.

### 3.4 Annual Billing

- Annual subscriptions receive 20% off (equivalent to 2 months free).
- Sessions included are the same monthly allowance × 12 — there is no annual pool. Unused sessions in a given month do not roll over.
- Annual plan changes (upgrades/downgrades) handled via Stripe proration.

---

## 4. Data Model

This section extends the schema in `SAAS_BILLING_ONBOARDING_REQUIREMENTS.md` Section 7. The `org_billing` table and `billing_events` table defined there remain unchanged. The following additions are required.

### 4.1 `plans` Table (replace hardcoded constants)

```sql
create table plans (
  key            text primary key,                 -- 'free' | 'starter' | 'growth' | 'pro' | 'team' | 'enterprise'
  name           text not null,
  stripe_price_monthly_id  text unique,
  stripe_price_annual_id   text unique,
  monthly_price_usd        numeric(10,2) not null,
  annual_price_usd         numeric(10,2),          -- total annual charge
  sessions_included        int not null,
  active                   boolean not null default true,
  sort_order               int not null default 0,
  created_at               timestamptz not null default now()
);

insert into plans (key, name, monthly_price_usd, annual_price_usd, sessions_included, sort_order) values
  ('free',       'Free',       0,    null,  5,    0),
  ('starter',    'Starter',    19,   182,   50,   1),
  ('growth',     'Growth',     49,   470,   130,  2),
  ('pro',        'Pro',        99,   950,   230,  3),
  ('team',       'Team',       249,  2390,  600,  4),
  ('enterprise', 'Enterprise', 499,  4790,  1300, 5);
```

### 4.2 `credit_packages` Table

```sql
create table credit_packages (
  key           text primary key,          -- 'small' | 'medium' | 'large' | 'xl'
  name          text not null,
  price_usd     numeric(10,2) not null,
  sessions      int not null,              -- sessions this block covers
  stripe_price_id text unique,
  active        boolean not null default true,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);

insert into credit_packages (key, name, price_usd, sessions, sort_order) values
  ('small',  '$25 block',   25,  45,  0),
  ('medium', '$50 block',   50,  91,  1),
  ('large',  '$100 block',  100, 183, 2),
  ('xl',     '$200 block',  200, 367, 3);
```

### 4.3 `org_credits` Table

Tracks the credit balance per org. One row per org.

```sql
create table org_credits (
  org_id              uuid primary key references orgs(id) on delete cascade,
  sessions_balance    int not null default 0,   -- purchased credit sessions remaining
  lifetime_purchased  int not null default 0,   -- all-time sessions purchased (audit)
  updated_at          timestamptz not null default now()
);

-- RLS: org members can read their own org's credits. Only service role writes.
alter table org_credits enable row level security;

create policy "org members can read credits"
  on org_credits for select
  using (org_id = any(auth_user_org_ids()));
```

### 4.4 `credit_ledger` Table

Every session consumption and credit purchase is logged here. This is the source of truth for usage.

```sql
create table credit_ledger (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade,
  user_id         uuid references auth.users(id) on delete set null,
  project_id      uuid references projects(id) on delete set null,
  source_id       uuid references sources(id) on delete set null,
  event_type      text not null check (event_type in (
    'session_consumed',        -- deducted from subscription allowance
    'credit_consumed',         -- deducted from purchased credit balance
    'subscription_credited',   -- monthly allowance refreshed
    'credit_purchased',        -- block purchase credited
    'admin_adjustment'         -- manual override by super admin
  )),
  operation       text not null,  -- 'ingest' | 'compose' | 'ask' | 'digest_person' | 'digest_company' | 'digest_competitor' | 'session_review' | 'frame_draft'
  sessions_delta  int not null,   -- positive = credited, negative = consumed
  balance_after   int,            -- snapshot of sessions_remaining after this event
  metadata        jsonb not null default '{}',
  created_at      timestamptz not null default now()
);

create index credit_ledger_org_id_idx on credit_ledger(org_id, created_at desc);
create index credit_ledger_user_id_idx on credit_ledger(user_id, created_at desc);

-- RLS: org members can read their own org's ledger.
alter table credit_ledger enable row level security;

create policy "org members can read ledger"
  on credit_ledger for select
  using (org_id = any(auth_user_org_ids()));
```

### 4.5 `org_billing` Additions

Add the following columns to the existing `org_billing` table:

```sql
alter table org_billing
  add column if not exists billing_interval  text check (billing_interval in ('monthly', 'annual')) default 'monthly',
  add column if not exists sessions_used_this_period  int not null default 0,
  add column if not exists sessions_allowance          int not null default 5,  -- mirrors plan default
  add column if not exists trial_activated_at          timestamptz,             -- when 14-day Growth trial started
  add column if not exists trial_plan_key              text default 'growth';   -- what plan the trial gives access to
```

---

## 5. Entitlement Logic

### 5.1 Entitlement Helper (extend existing)

The `getOrgEntitlements` function defined in `SAAS_BILLING_ONBOARDING_REQUIREMENTS.md` Section 11 must be extended:

```ts
type OrgEntitlements = {
  // ... existing fields ...
  plan_key: string;
  billing_interval: 'monthly' | 'annual';
  sessions_allowance: number;        // included in subscription this period
  sessions_used: number;             // consumed from allowance this period
  sessions_remaining: number;        // allowance - used (floor 0)
  credit_sessions: number;           // purchased credit balance
  total_sessions_available: number;  // sessions_remaining + credit_sessions
  can_use_product: boolean;
  can_ingest: boolean;
  can_compose: boolean;
  can_ask: boolean;
  can_run_digest: boolean;
  can_purchase_credits: boolean;     // false on Free tier
  is_trial: boolean;
  trial_ends_at: string | null;
  reason?: 'trial_expired' | 'no_sessions' | 'past_due' | 'canceled';
};
```

### 5.2 Session Deduction Flow

Every operation that consumes a session must follow this exact sequence. Do not deviate.

```
1. Load org entitlements (single DB call combining org_billing + org_credits)
2. If can_[operation] is false → return 402/403 with reason
3. If total_sessions_available < 1 → return 402 with { code: 'no_sessions', credit_purchase_url }
4. Begin DB transaction:
   a. Determine source: 'subscription' if sessions_remaining > 0, else 'credit'
   b. If source = 'subscription':
      - UPDATE org_billing SET sessions_used_this_period = sessions_used_this_period + 1
   c. If source = 'credit':
      - UPDATE org_credits SET sessions_balance = sessions_balance - 1
   d. INSERT INTO credit_ledger (event_type, operation, sessions_delta = -1, ...)
5. Commit transaction
6. Queue Inngest job / proceed with operation
```

Use a Postgres function for steps 4a–4d to keep the deduction atomic:

```sql
create or replace function consume_session(
  p_org_id uuid,
  p_user_id uuid,
  p_project_id uuid,
  p_source_id uuid,
  p_operation text
) returns jsonb language plpgsql security definer as $$
declare
  v_billing    org_billing%rowtype;
  v_credits    org_credits%rowtype;
  v_source     text;
  v_delta_col  text;
begin
  -- Lock both rows
  select * into v_billing from org_billing where org_id = p_org_id for update;
  select * into v_credits from org_credits where org_id = p_org_id for update;

  -- Check available
  if (v_billing.sessions_allowance - v_billing.sessions_used_this_period) > 0 then
    v_source := 'subscription';
    update org_billing
      set sessions_used_this_period = sessions_used_this_period + 1,
          updated_at = now()
      where org_id = p_org_id;
  elsif coalesce(v_credits.sessions_balance, 0) > 0 then
    v_source := 'credit';
    update org_credits
      set sessions_balance = sessions_balance - 1,
          updated_at = now()
      where org_id = p_org_id;
  else
    return jsonb_build_object('ok', false, 'reason', 'no_sessions');
  end if;

  insert into credit_ledger
    (org_id, user_id, project_id, source_id, event_type, operation, sessions_delta)
  values
    (p_org_id, p_user_id, p_project_id, p_source_id,
     case when v_source = 'subscription' then 'session_consumed' else 'credit_consumed' end,
     p_operation, -1);

  return jsonb_build_object('ok', true, 'source', v_source);
end;
$$;
```

### 5.3 Monthly Allowance Reset

On subscription renewal (`invoice.payment_succeeded` webhook), reset the period counter:

```sql
update org_billing
set
  sessions_used_this_period = 0,
  current_period_start = :period_start,
  current_period_end   = :period_end,
  updated_at           = now()
where org_id = :org_id;

insert into credit_ledger (org_id, event_type, operation, sessions_delta)
values (:org_id, 'subscription_credited', 'renewal', :sessions_allowance);
```

---

## 6. Credit Purchase Flow

Credit top-ups use Stripe Payment Intents (one-time payment), not subscriptions.

### 6.1 API Route

```
POST /api/billing/credits/checkout
```

Request:
```json
{ "org_id": "uuid", "package_key": "medium" }
```

Requirements:
- Auth required. Owner or admin only.
- Look up `credit_packages` by `package_key`.
- Create a Stripe Checkout session in `payment` mode (not `subscription`).
- Line item: the credit package Stripe price ID.
- Metadata: `{ org_id, package_key, sessions }`.
- Success URL: `${APP_URL}/settings/billing?credits=success`.
- On `checkout.session.completed` webhook: credit `org_credits.sessions_balance` and write to ledger.

### 6.2 Webhook Handler Addition

Add to the existing webhook handler (`POST /api/stripe/webhook`):

```ts
case 'checkout.session.completed': {
  const session = event.data.object;
  // Only handle credit purchases (mode = 'payment'), not subscriptions
  if (session.mode !== 'payment') break;
  const { org_id, package_key, sessions } = session.metadata;
  // Credit the org
  await supabase.rpc('credit_sessions', {
    p_org_id: org_id,
    p_sessions: Number(sessions),
    p_package_key: package_key,
    p_stripe_session_id: session.id,
  });
  break;
}
```

Corresponding Postgres function:

```sql
create or replace function credit_sessions(
  p_org_id           uuid,
  p_sessions         int,
  p_package_key      text,
  p_stripe_session_id text
) returns void language plpgsql security definer as $$
begin
  insert into org_credits (org_id, sessions_balance, lifetime_purchased)
  values (p_org_id, p_sessions, p_sessions)
  on conflict (org_id) do update set
    sessions_balance    = org_credits.sessions_balance + p_sessions,
    lifetime_purchased  = org_credits.lifetime_purchased + p_sessions,
    updated_at          = now();

  insert into credit_ledger (org_id, event_type, operation, sessions_delta, metadata)
  values (p_org_id, 'credit_purchased', 'top_up', p_sessions,
          jsonb_build_object('package_key', p_package_key, 'stripe_session_id', p_stripe_session_id));
end;
$$;
```

---

## 7. Enforcement Points

Every route or server action that triggers a session-consuming operation must call `consume_session` before queuing the Inngest job. Callers must not proceed if `consume_session` returns `ok: false`.

| Route / Action | Operation string | Notes |
|---|---|---|
| `POST /api/ingest` | `'ingest'` | Before `ingest/source.requested` event |
| `POST /api/ingest/retry` | `'ingest'` | Same as above |
| `POST /api/compose/draft` | `'compose'` | Before `artifact/compose.requested` |
| `POST /api/ask` | `'ask'` | Before calling LLM |
| `POST /api/people/[id]/synthesise` | `'digest_person'` | Before `person/synthesise.requested` |
| `POST /api/companies/[id]/synthesise` | `'digest_company'` | Before Inngest event |
| `POST /api/competitors/[id]/synthesise` | `'digest_competitor'` | Before Inngest event |
| `POST /api/sources/[id]/session-review` | `'session_review'` | If triggered manually |
| Frame draft (auto on first ingest) | `'frame_draft'` | Only on first ingest; charged once per project |

Frame draft on first ingest: do not charge for the auto-generated frame draft separately from the ingest. The ingest session covers it. Only charge if the user manually re-generates the frame draft.

---

## 8. UI Requirements

### 8.1 Billing Page (`/settings/billing`)

Must show:

- Current plan name + price + billing interval.
- Sessions used / sessions included (progress bar).
- Credit balance (purchased sessions remaining).
- Trial status + days remaining if in trial.
- Button: **Manage billing** → Stripe Customer Portal.
- Button: **Upgrade plan** → Stripe Checkout (plan upgrade).
- Section: **Buy more sessions** → credit package grid with Buy buttons.
- Section: **Usage history** → last 30 credit ledger events, paginated.

### 8.2 Global Session Counter (nav or header)

Show a compact sessions-remaining indicator in the app shell for all logged-in users. Format: `"47 sessions left"` or `"Credits: 91"` if on credits. Update optimistically after each operation.

On zero sessions: show a warning banner: **"You've used all your sessions. [Buy credits] or [Upgrade plan] to continue."**

### 8.3 Disabled States

When `can_[operation]` is false, the triggering button must be visually disabled with a tooltip explaining why. Do not silently fail.

Example: Ingest button when out of sessions → greyed out, tooltip "No sessions remaining — buy credits or upgrade".

### 8.4 Usage History Component

Table columns: Date | Operation | Project | User | Sessions drawn from | Balance after.

Filter by: operation type, user, date range.

Accessible to: owner and admin only.

### 8.5 Free Tier Upgrade Prompt

After session 3 of 5 on the Free tier, show a persistent (non-blocking) nudge: **"You've used 3 of your 5 free sessions. Upgrade to Starter ($19/month) to keep going."** After session 5, block and require upgrade.

---

## 9. Stripe Configuration

### 9.1 Products and Prices to Create in Stripe

**Subscription products (one Stripe product per tier):**

For each tier: create a Stripe Product. Attach two Prices: monthly recurring and annual recurring (billed upfront as one payment).

Naming convention: `DiscOS [Tier Name]` e.g. `DiscOS Growth`.

**Credit package products (one-time payments):**

Create one Stripe Product: `DiscOS Session Credits`. Attach four one-time Prices: $25, $50, $100, $200.

Do not create separate products per credit block — one product, multiple prices.

### 9.2 Environment Variables Required

```
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_PRICE_FREE=                    (optional — no checkout needed)
STRIPE_PRICE_STARTER_MONTHLY=
STRIPE_PRICE_STARTER_ANNUAL=
STRIPE_PRICE_GROWTH_MONTHLY=
STRIPE_PRICE_GROWTH_ANNUAL=
STRIPE_PRICE_PRO_MONTHLY=
STRIPE_PRICE_PRO_ANNUAL=
STRIPE_PRICE_TEAM_MONTHLY=
STRIPE_PRICE_TEAM_ANNUAL=
STRIPE_PRICE_ENTERPRISE_MONTHLY=
STRIPE_PRICE_ENTERPRISE_ANNUAL=
STRIPE_PRICE_CREDITS_25=
STRIPE_PRICE_CREDITS_50=
STRIPE_PRICE_CREDITS_100=
STRIPE_PRICE_CREDITS_200=
NEXT_PUBLIC_APP_URL=
```

Store price IDs in the `plans` and `credit_packages` tables, not only in env vars. Env vars are the seed source; the DB is the runtime source.

---

## 10. Analytics and Observability

### 10.1 What to Track

The credit ledger provides a complete audit trail. Build the following derived metrics for the admin view:

- **Sessions consumed per org per month** — detect orgs at risk of churning due to hitting limits.
- **Credit purchase rate** — what % of orgs on each tier buy credits vs. upgrade.
- **Operation breakdown** — which operations consume the most sessions (ingest, compose, ask, etc.).
- **Free → paid conversion** — time from account creation to first subscription.

### 10.2 Admin Billing View

Extend the existing super admin panel (`/admin/orgs/[orgId]`) to show:

- Subscription plan + status + period end.
- Sessions used this period / allowance.
- Credit balance.
- Last 20 credit ledger events.
- Button: **Resync from Stripe** (re-fetches subscription object and updates `org_billing`).
- Button: **Add sessions** (admin adjustment, writes to ledger with `admin_adjustment` type and records the super admin user ID in metadata).
- Button: **Extend trial** (sets `trial_ends_at` forward, requires a reason field for audit).

---

## 11. Build Estimate

This is an honest estimate for a single focused engineer (or Codex running well-structured briefs):

| Phase | Work | Size | Days |
|---|---|---|---|
| 0 | Active org context cleanup (prereq from existing doc) | S | 1 |
| 1 | Schema migrations (plans, credit_packages, org_credits, credit_ledger, org_billing additions) | S | 1 |
| 2 | `consume_session` and `credit_sessions` Postgres functions + entitlement helper update | S | 1 |
| 3 | Org onboarding flow (workspace creation, billing step, first project) | M | 2 |
| 4 | Stripe subscription checkout + portal routes | M | 2 |
| 5 | Stripe webhook handler (subscription events + credit purchase) | M | 2 |
| 6 | Entitlement enforcement in all API routes (gating) | M | 2 |
| 7 | Billing UI (settings page, session counter, buy credits, usage history) | M | 2-3 |
| 8 | Global banners, disabled states, upgrade nudges | S | 1 |
| 9 | Admin billing view extension | S | 1 |
| 10 | Testing, Stripe test mode scenarios, production smoke test | M | 2 |

**Total estimate: 17–19 focused engineering days (~4 weeks full-time, 6 weeks at 60% pace).**

The work can be parallelised: phases 1–2 unblock everything. Phases 3–5 can run in parallel. Phases 6–9 depend on 3–5 being done. Phase 10 is continuous.

---

## 12. Open Questions Resolved

These were listed as open in `SAAS_BILLING_ONBOARDING_REQUIREMENTS.md` Section 20. All are now answered.

| Question | Decision |
|---|---|
| What is the first paid plan and price? | Starter $19/month, Growth $49/month. Growth is the primary target tier. |
| Is trial card-required? | No card for 14-day Growth trial. Card required for paid subscription. |
| Should billing be per seat or flat per org? | Flat per org (subscription) + per-session usage credits. No per-seat pricing at launch. |
| What should happen to existing orgs at rollout? | Backfill as `trialing` with a 14-day trial of Growth. Owner prompted to subscribe on next login. |
| Should usage limits be enforced immediately or only displayed? | Enforced server-side. UI also shows disabled states. No grace on sessions — but read access always preserved. |
| What is the final production domain? | TBD — not blocking billing implementation. |
| Are beta/internal orgs free forever? | Super admin can set `plan_key = 'internal'` on `org_billing` with unlimited sessions via `admin_adjustment`. |
| Should compose be moved fully to Inngest before billing launch? | Already done — compose runs via Inngest. No change needed. |
