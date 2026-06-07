# Codex Brief — Org Onboarding + Stripe Billing

> ⛔ **SECURITY GATE APPLIES (non-negotiable).** Before committing/pushing any change to auth, RLS/migrations, public routes, middleware, or service-role usage, post the diff and wait for Opus's written **APPROVED**. See `AGENTS.md` → "SECURITY REVIEW GATE". This overrides anything below.

## Goal

Turn DiscOS into a self-serve, billable product. A new user should be able to sign up, create a workspace, start a 14-day trial, and reach their first discovery session — without any manual intervention from Jimmy.

This brief implements the **Sub+Credits tiered pricing model** decided in `MONETIZATION_REQUIREMENTS.md`. Read that document before starting. The full billing data model and session consumption logic is specified there. This brief translates it into concrete implementation tasks.

**Read first:**
- `MONETIZATION_REQUIREMENTS.md` — pricing decisions, data model, Postgres functions
- `SAAS_BILLING_ONBOARDING_REQUIREMENTS.md` — architecture constraints, existing schema, Stripe requirements
- `CLAUDE.md` — existing codebase conventions

---

## Scope

**Files you own this brief:**

- `src/app/(app)/onboarding/` — new directory, all files
- `src/app/(app)/settings/billing/` — new directory, all files
- `src/app/api/billing/` — new directory (checkout, portal, credits routes)
- `src/app/api/stripe/webhook/route.ts` — new file
- `src/lib/billing/` — new directory (entitlements, session consumption, plan config)
- `src/lib/auth/org.ts` — extend active-org resolution (Task 1)
- `src/components/billing/` — new directory (session counter, banners, upgrade prompts)
- Supabase migrations: `0021_billing_schema.sql`, `0022_credit_system.sql`
- `src/app/(app)/admin/orgs/[orgId]/page.tsx` — extend with billing section (Task 7)

**Files you must NOT touch:**

- `src/lib/llm/` — all prompt files, LLM client
- `src/lib/inngest/` — Inngest function logic (only add `consume_session` calls to route handlers, not inside functions)
- Any existing migration files (`0001` through `0020`)
- `src/app/(app)/projects/` — no changes to project pages unless explicitly stated in a task
- `src/app/api/admin/` — do not modify existing admin routes

**Working agreement:** one commit per task, prefixed `billing:`. Run `npm run type-check` and `npm run build` before each commit. Never break the existing API contract — all changes are additive. Test with Stripe CLI and test mode cards.

---

## Task 0 — Active org context cleanup (prereq)

### Why this must go first

Several top-level pages currently resolve the user's active org by taking the first row from `org_members`. This breaks once a user can belong to multiple orgs (which billing enables — invited users join an existing org). The billing entitlement checks only work correctly if every request knows which org it belongs to.

### What to change

**File:** `src/lib/auth/org.ts`

Add or replace `getActiveOrgId(userId)`:

```ts
export async function getActiveOrgId(userId: string): Promise<string | null> {
  // 1. Check impersonation cookie (super admin flow — already exists, keep it)
  const impersonatedOrgId = await getImpersonatedOrgId();
  if (impersonatedOrgId) return impersonatedOrgId;

  // 2. Check session cookie for last-active org
  // Store org selection in a short-lived cookie 'disco_active_org'
  const cookieStore = cookies();
  const cookieOrgId = cookieStore.get('disco_active_org')?.value;
  if (cookieOrgId) {
    // Verify membership is still valid
    const { data } = await supabase
      .from('org_members')
      .select('org_id')
      .eq('user_id', userId)
      .eq('org_id', cookieOrgId)
      .single();
    if (data) return data.org_id;
  }

  // 3. Fall back to sole membership (most common case for early users)
  const { data } = await supabase
    .from('org_members')
    .select('org_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  return data?.org_id ?? null;
}
```

Add `setActiveOrgId(orgId)` — sets the `disco_active_org` cookie (HttpOnly, SameSite=Lax, 30-day expiry).

**Update all server components and API routes** that currently do their own `org_members` lookup to use `getActiveOrgId(userId)` instead. Do a global search for `.from('org_members').select(...).eq('user_id', userId).single()` and replace.

### How to verify

- User with one org: works exactly as before.
- User invited to a second org: can switch via a future org-switcher; for now, their active org is whichever they joined first.
- Super admin impersonation: still overrides everything.

---

## Task 1 — Database migrations

### Migration 0021 — Billing schema additions

File to create: `supabase/migrations/0021_billing_schema.sql`

This migration adds the `plans` and `credit_packages` tables, the credit columns to `org_billing`, and the onboarding state columns to `orgs`. Copy the exact SQL from `MONETIZATION_REQUIREMENTS.md` Sections 4.1, 4.2, and the `org_billing` additions in Section 4.5. Then add:

```sql
-- Seed plan data (Stripe price IDs populated later via env vars / admin)
-- See MONETIZATION_REQUIREMENTS.md Section 3.1 for values

-- Ensure every existing org has an org_billing row (backfill)
insert into org_billing (org_id, plan_key, subscription_status, trial_ends_at, sessions_allowance)
select
  o.id,
  'growth',                                          -- backfill as Growth trial
  'trialing',
  now() + interval '14 days',
  130                                                -- Growth sessions
from orgs o
where not exists (select 1 from org_billing b where b.org_id = o.id)
on conflict do nothing;
```

### Migration 0022 — Credit system

File to create: `supabase/migrations/0022_credit_system.sql`

Copy the exact SQL for `org_credits` and `credit_ledger` from `MONETIZATION_REQUIREMENTS.md` Sections 4.3 and 4.4.

Then add the two Postgres functions verbatim: `consume_session` and `credit_sessions` from Sections 5.2 and 6.2.

Then backfill credit rows for existing orgs:

```sql
insert into org_credits (org_id, sessions_balance, lifetime_purchased)
select id, 0, 0 from orgs
on conflict do nothing;
```

### How to verify

```bash
npx supabase db reset   # local
# Then:
select * from plans;              -- 6 rows
select * from credit_packages;    -- 4 rows
select count(*) from org_billing; -- matches org count
select count(*) from org_credits; -- matches org count
# Test consume_session function:
select consume_session('<your_org_id>', '<your_user_id>', null, null, 'test');
# Should return { ok: true, source: 'subscription' } and create a credit_ledger row
```

---

## Task 2 — Billing library

### File: `src/lib/billing/plans.ts`

```ts
export const PLAN_KEYS = ['free', 'starter', 'growth', 'pro', 'team', 'enterprise'] as const;
export type PlanKey = typeof PLAN_KEYS[number];

export const PLAN_DEFAULTS: Record<PlanKey, { sessions: number; price: number }> = {
  free:       { sessions: 5,    price: 0   },
  starter:    { sessions: 50,   price: 19  },
  growth:     { sessions: 130,  price: 49  },
  pro:        { sessions: 230,  price: 99  },
  team:       { sessions: 600,  price: 249 },
  enterprise: { sessions: 1300, price: 499 },
};

export const CREDIT_PACKAGES = [
  { key: 'small',  label: '$25',  price: 25,  sessions: 45  },
  { key: 'medium', label: '$50',  price: 50,  sessions: 91  },
  { key: 'large',  label: '$100', price: 100, sessions: 183 },
  { key: 'xl',     label: '$200', price: 200, sessions: 367 },
] as const;

// Stripe price ID helpers — read from env
export function getStripePriceId(planKey: PlanKey, interval: 'monthly' | 'annual'): string {
  const key = `STRIPE_PRICE_${planKey.toUpperCase()}_${interval.toUpperCase()}`;
  const id = process.env[key];
  if (!id) throw new Error(`Missing env var: ${key}`);
  return id;
}

export function getCreditStripePriceId(packageKey: string): string {
  const key = `STRIPE_PRICE_CREDITS_${packageKey.toUpperCase()}`;
  const id = process.env[key];
  if (!id) throw new Error(`Missing env var: ${key}`);
  return id;
}
```

### File: `src/lib/billing/entitlements.ts`

Implement `getOrgEntitlements(orgId)` as specified in `MONETIZATION_REQUIREMENTS.md` Section 5.1.

Single DB query joining `org_billing`, `org_credits`, and `plans`. Never call this more than once per request — memoize at the request level with `React.cache()`.

```ts
import { cache } from 'react';

export const getOrgEntitlements = cache(async (orgId: string): Promise<OrgEntitlements> => {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('org_billing')
    .select(`
      *,
      org_credits ( sessions_balance ),
      plans ( sessions_included, monthly_price_usd )
    `)
    .eq('org_id', orgId)
    .single();

  if (error || !data) throw new Error(`Cannot load entitlements for org ${orgId}`);

  const allowance   = data.sessions_allowance;
  const used        = data.sessions_used_this_period;
  const remaining   = Math.max(0, allowance - used);
  const credits     = data.org_credits?.sessions_balance ?? 0;
  const total       = remaining + credits;
  const isTrialing  = data.subscription_status === 'trialing';
  const isActive    = ['active', 'trialing'].includes(data.subscription_status);
  const isPastDue   = data.subscription_status === 'past_due';
  const isCanceled  = ['canceled', 'incomplete_expired'].includes(data.subscription_status);

  return {
    org_id: orgId,
    plan_key: data.plan_key,
    billing_interval: data.billing_interval ?? 'monthly',
    subscription_status: data.subscription_status,
    sessions_allowance: allowance,
    sessions_used: used,
    sessions_remaining: remaining,
    credit_sessions: credits,
    total_sessions_available: total,
    can_use_product: isActive || isPastDue,
    can_ingest:      isActive && total > 0,
    can_compose:     isActive && total > 0,
    can_ask:         isActive && total > 0,
    can_run_digest:  isActive && total > 0,
    can_invite_members: isActive && data.plan_key !== 'free',
    can_create_project: isActive,
    can_purchase_credits: data.plan_key !== 'free',
    read_only: !isActive || (isActive && total === 0 && !isPastDue),
    is_trial: isTrialing,
    trial_ends_at: data.trial_ends_at ?? null,
    reason: !isActive
      ? (isCanceled ? 'canceled' : 'trial_expired')
      : (total === 0 ? 'no_sessions' : undefined),
  };
});
```

### File: `src/lib/billing/consume.ts`

```ts
import { createServiceClient } from '@/lib/supabase/service';

export type ConsumeResult =
  | { ok: true; source: 'subscription' | 'credit' }
  | { ok: false; reason: 'no_sessions' | 'entitlement_blocked' };

export async function consumeSession(params: {
  orgId: string;
  userId: string;
  projectId?: string;
  sourceId?: string;
  operation: string;
}): Promise<ConsumeResult> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc('consume_session', {
    p_org_id:     params.orgId,
    p_user_id:    params.userId,
    p_project_id: params.projectId ?? null,
    p_source_id:  params.sourceId ?? null,
    p_operation:  params.operation,
  });
  if (error) throw new Error(`consume_session failed: ${error.message}`);
  return data as ConsumeResult;
}
```

---

## Task 3 — Org onboarding flow

### 3.1 Workspace creation page

Route: `src/app/(app)/onboarding/workspace/page.tsx`

Server component. Check if user already has org memberships — redirect to `/projects` if so.

Form fields:
- **Workspace name** (required, max 80 chars)
- **Your role** (optional select: PM / Researcher / Founder / Designer / Other)
- **Team size** (optional select: Solo / 2–5 / 6–20 / 20+)

On submit (server action `createWorkspaceAction`):
1. Create `orgs` row. Slug = lowercase kebab of name + 4-char random suffix. Set `onboarding_state = { workspace_created: true }`.
2. Create `org_members` row with `role = 'owner'`.
3. Create `org_billing` row: `plan_key = 'free'`, `subscription_status = 'none'`, `sessions_allowance = 5`.
4. Create `org_credits` row: `sessions_balance = 0`.
5. Set `disco_active_org` cookie to new org ID.
6. Redirect to `/onboarding/trial`.

### 3.2 Trial / billing step

Route: `src/app/(app)/onboarding/trial/page.tsx`

Shows two options as cards:
- **Start 14-day free trial** — no card required. Gets Growth tier access (130 sessions) for 14 days. Big primary CTA.
- **Subscribe now** — goes straight to Stripe Checkout for Growth plan.

On "Start trial" (server action `startTrialAction`):
1. Update `org_billing`: `plan_key = 'growth'`, `subscription_status = 'trialing'`, `trial_ends_at = now() + 14 days`, `trial_activated_at = now()`, `sessions_allowance = 130`.
2. Write to `credit_ledger`: `event_type = 'subscription_credited'`, `operation = 'trial_start'`, `sessions_delta = 130`.
3. Update `onboarding_state.billing_started = true`.
4. Redirect to `/onboarding/first-project`.

On "Subscribe now": redirect to Stripe Checkout (Growth monthly). After successful checkout, webhook activates subscription and redirects to `/onboarding/first-project`.

### 3.3 First project step

Route: `src/app/(app)/onboarding/first-project/page.tsx`

Minimal form: project name. No description needed here.

On submit: create project (reuse `createProjectAction`), update `onboarding_state.first_project_created = true`, redirect to the new project's workspace page.

### 3.4 Redirect guard middleware

In `src/middleware.ts` (or wherever auth middleware lives), add:

```ts
// After auth check: if user has no org memberships, redirect to /onboarding/workspace
// unless they are already on an /onboarding/* route
const pathname = request.nextUrl.pathname;
if (!pathname.startsWith('/onboarding') && !pathname.startsWith('/api')) {
  const orgId = await getActiveOrgId(userId);
  if (!orgId) {
    return NextResponse.redirect(new URL('/onboarding/workspace', request.url));
  }
}
```

### How to verify

- New user signs up → hits `/onboarding/workspace`.
- Creates workspace → hits `/onboarding/trial`.
- Starts trial → hits `/onboarding/first-project`.
- Creates project → lands on project workspace.
- Signs out, signs back in → goes directly to `/projects`. No onboarding loop.
- User invited to existing org → skips all onboarding, goes to `/projects`.

---

## Task 4 — Stripe checkout and portal routes

### 4.1 `POST /api/billing/checkout`

File: `src/app/api/billing/checkout/route.ts`

```ts
import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(request: Request) {
  const { org_id, plan_key, interval = 'monthly' } = await request.json();

  // Auth: user must be owner/admin of org_id
  // ...existing auth pattern from other routes...

  // Get or create Stripe customer
  const { data: billing } = await supabase
    .from('org_billing')
    .select('stripe_customer_id')
    .eq('org_id', org_id)
    .single();

  let customerId = billing?.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { org_id, environment: process.env.NODE_ENV ?? 'development' },
    });
    customerId = customer.id;
    await supabaseService
      .from('org_billing')
      .update({ stripe_customer_id: customerId })
      .eq('org_id', org_id);
  }

  const priceId = getStripePriceId(plan_key, interval);

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: {
      metadata: { org_id, plan_key, environment: process.env.NODE_ENV ?? 'development' },
      trial_end: 'now',  // No trial via Stripe — trial handled in-app
    },
    metadata: { org_id, plan_key, interval },
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/settings/billing`,
  });

  return Response.json({ url: session.url });
}
```

### 4.2 `POST /api/billing/portal`

File: `src/app/api/billing/portal/route.ts`

```ts
export async function POST(request: Request) {
  const { org_id } = await request.json();
  // Auth: owner/admin check

  const { data: billing } = await supabaseService
    .from('org_billing')
    .select('stripe_customer_id')
    .eq('org_id', org_id)
    .single();

  if (!billing?.stripe_customer_id) {
    return Response.json({ error: 'No billing account found' }, { status: 404 });
  }

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: billing.stripe_customer_id,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/settings/billing`,
  });

  return Response.json({ url: portalSession.url });
}
```

### 4.3 `POST /api/billing/credits/checkout`

File: `src/app/api/billing/credits/checkout/route.ts`

One-time payment for credit blocks. Follows the same pattern as subscription checkout but uses `mode: 'payment'` and the credit package price ID. Set metadata: `{ org_id, package_key, sessions }`.

### How to verify

- `POST /api/billing/checkout` with valid org + plan → returns Stripe URL, opens checkout in browser.
- Stripe test card 4242 4242 4242 4242 → payment succeeds → redirect to success URL.
- `POST /api/billing/portal` → returns portal URL.
- Non-owner calling checkout → 403.

---

## Task 5 — Stripe webhook handler

File: `src/app/api/stripe/webhook/route.ts`

**Critical:** must use raw request body. Next.js 13+ app router: export `config = { api: { bodyParser: false } }` or use `request.text()` before `stripe.webhooks.constructEvent`.

```ts
import { headers } from 'next/headers';
import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(request: Request) {
  const body = await request.text();
  const sig  = headers().get('stripe-signature')!;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    return new Response(`Webhook signature verification failed`, { status: 400 });
  }

  // Idempotency check
  const { data: existing } = await supabaseService
    .from('billing_events')
    .select('id')
    .eq('stripe_event_id', event.id)
    .single();
  if (existing) return new Response('Already processed', { status: 200 });

  // Log event (before processing — so partial failures are recoverable)
  await supabaseService.from('billing_events').insert({
    stripe_event_id: event.id,
    event_type: event.type,
    payload: event.data.object,
  });

  try {
    await handleStripeEvent(event);
    await supabaseService
      .from('billing_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('stripe_event_id', event.id);
  } catch (err) {
    await supabaseService
      .from('billing_events')
      .update({ processing_error: String(err) })
      .eq('stripe_event_id', event.id);
    return new Response('Processing error', { status: 500 });
  }

  return new Response('OK', { status: 200 });
}
```

### `handleStripeEvent` — events to handle

**`checkout.session.completed`**
- If `mode === 'subscription'`: retrieve subscription, update `org_billing` with subscription ID, plan key, status, period dates, sessions allowance. Write `subscription_credited` to ledger.
- If `mode === 'payment'` (credit purchase): call `credit_sessions` Postgres function. See `MONETIZATION_REQUIREMENTS.md` Section 6.2.

**`customer.subscription.created` / `customer.subscription.updated`**
```ts
const sub = event.data.object as Stripe.Subscription;
const orgId = sub.metadata.org_id;
const planKey = sub.metadata.plan_key;
const allowance = PLAN_DEFAULTS[planKey as PlanKey].sessions;
const status = sub.status; // 'active' | 'past_due' | etc.

await supabaseService.from('org_billing').upsert({
  org_id: orgId,
  stripe_subscription_id: sub.id,
  stripe_customer_id: sub.customer as string,
  stripe_price_id: sub.items.data[0].price.id,
  plan_key: planKey,
  subscription_status: status,
  billing_interval: sub.items.data[0].price.recurring?.interval === 'year' ? 'annual' : 'monthly',
  current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
  current_period_end:   new Date(sub.current_period_end   * 1000).toISOString(),
  cancel_at_period_end: sub.cancel_at_period_end,
  sessions_allowance: allowance,
  updated_at: new Date().toISOString(),
}, { onConflict: 'org_id' });
```

**`customer.subscription.deleted`**
- Set `subscription_status = 'canceled'` on `org_billing`.
- Do NOT zero out `sessions_allowance` — read access is preserved.

**`invoice.payment_succeeded`**
- Reset `sessions_used_this_period = 0`.
- Update period dates.
- Write `subscription_credited` ledger entry for the new period.

**`invoice.payment_failed`**
- Set `subscription_status = 'past_due'`.
- Entitlement helper will block ingest/compose automatically.

**`customer.subscription.trial_will_end`** (optional, nice-to-have)
- Send an in-app notification or email: "Your trial ends in 3 days."

### How to verify

Test with Stripe CLI:
```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
stripe trigger checkout.session.completed
stripe trigger customer.subscription.updated
stripe trigger invoice.payment_failed
```

After each event:
- `billing_events` has a new row with `processed_at` set.
- `org_billing` reflects the new state.
- `credit_ledger` has the expected entry for subscription_credited or credit_purchased.
- Same event ID sent twice → 200 with "Already processed", no duplicate write.

---

## Task 6 — Entitlement enforcement in API routes

Add `consumeSession` calls to the following routes. Follow the sequence in `MONETIZATION_REQUIREMENTS.md` Section 5.2 exactly.

### Pattern (copy-paste for each route)

```ts
// At the top of each POST handler, after auth:
const entitlements = await getOrgEntitlements(orgId);
if (!entitlements.can_ingest) {  // or can_compose, can_ask, etc.
  return Response.json(
    { error: 'Session limit reached', reason: entitlements.reason, code: 'no_sessions' },
    { status: 402 }
  );
}

const consumed = await consumeSession({
  orgId, userId, projectId, sourceId, operation: 'ingest'
});
if (!consumed.ok) {
  return Response.json({ error: 'Could not deduct session', reason: consumed.reason }, { status: 402 });
}

// Proceed to queue Inngest job / run operation
```

**Routes to update:**

| File | `can_` check | operation string |
|---|---|---|
| `src/app/api/ingest/route.ts` | `can_ingest` | `'ingest'` |
| `src/app/api/ingest/retry/route.ts` | `can_ingest` | `'ingest'` |
| `src/app/api/compose/draft/route.ts` | `can_compose` | `'compose'` |
| `src/app/api/ask/route.ts` | `can_ask` | `'ask'` |
| `src/app/api/people/[personId]/synthesise/route.ts` | `can_run_digest` | `'digest_person'` |
| `src/app/api/companies/[companyId]/synthesise/route.ts` | `can_run_digest` | `'digest_company'` |
| `src/app/api/competitors/[competitorId]/synthesise/route.ts` | `can_run_digest` | `'digest_competitor'` |

Also update `createProjectAction` to check `can_create_project`.

### How to verify

- Call `POST /api/ingest` for an org with 0 sessions remaining → 402 with `code: no_sessions`.
- Call the same route after purchasing credits → 200, session consumed, Inngest job queued.
- Verify `credit_ledger` has the new row after each successful operation.

---

## Task 7 — Billing UI

### 7.1 Settings billing page

Route: `src/app/(app)/settings/billing/page.tsx`

Server component. Fetch entitlements and plan info. Render:

```
[Current Plan]          [Manage Billing] button → POST /api/billing/portal
Growth — $49/month
Trial ends in 11 days

[Sessions]
▓▓▓▓▓▓░░░░  67 / 130 sessions used this period
Credit balance: 45 sessions

[Buy More Sessions]     (only shown if plan is not Free)
$25 — 45 sessions    $50 — 91 sessions    $100 — 183 sessions    $200 — 367 sessions

[Usage History]
Date | Operation | Project | Source | Sessions | Balance after
... last 30 rows from credit_ledger ...
```

Credit package buy buttons → `POST /api/billing/credits/checkout` → redirect to Stripe.

### 7.2 Session counter component

File: `src/components/billing/SessionCounter.tsx`

Client component. Fetches from `GET /api/billing/sessions` (new lightweight route returning `{ remaining, credits, total }`).

Place in the main nav or header. Format: `"63 sessions left"`. If credits are also present: `"63 + 45 credits"`.

When total = 0: show red chip `"No sessions"` with a link to `/settings/billing`.

### 7.3 Global billing banners

File: `src/components/billing/BillingBanner.tsx`

Rendered in the app shell, above the main content. Dismissible per session (not persistent dismiss — show on every page load).

Banner states (priority order, show highest-priority only):

1. **Trial expiring soon** (trial, ≤3 days left): amber — "Your trial ends in X days. [Subscribe now →]"
2. **Payment failed** (past_due): red — "Payment failed. [Update payment method →]"  
3. **Subscription canceled** (canceled, period still active): amber — "Subscription canceled. Access until [date]."
4. **No sessions** (active, total = 0): amber — "You've used all your sessions. [Buy credits →] or [Upgrade →]"
5. **Trial ended** (was trialing, now expired): red — "Your trial has ended. [Choose a plan →]"

### 7.4 Disabled states on operation buttons

In the ingest form, compose button, ask interface, and digest refresh buttons: check `can_[operation]` from entitlements and add `disabled` + `title="No sessions remaining — buy credits or upgrade"`.

The entitlements can be passed as a prop from the server component parent, or fetched client-side from the lightweight `/api/billing/sessions` route.

### How to verify

- Owner on Growth trial: billing page shows trial countdown, session bar, no credit purchase (not needed unless they hit limit).
- Owner on expired Free: billing page shows upgrade CTA, ingest button is disabled.
- Member (not owner/admin): billing page shows plan status only, no Manage Billing button, no Buy Credits.
- Super admin: billing page shows all data plus admin controls (Task 8).

---

## Task 8 — Admin billing view extension

File: `src/app/(app)/admin/orgs/[orgId]/page.tsx`

Add a new "Billing" section below the existing org detail content:

```
[Billing]
Plan: Growth (monthly)    Status: active
Period: 2026-05-01 → 2026-06-01
Sessions: 67/130 used    Credits: 45 remaining
Stripe Customer: cus_xxx    Stripe Subscription: sub_xxx

[Resync from Stripe]   [Add sessions: ___ ] [Extend trial: +___ days]

[Recent webhook events — last 10 billing_events rows]
Type | Event ID | Processed at | Error
```

**Resync from Stripe** (`POST /api/admin/billing/resync`): retrieve the Stripe subscription object by ID and re-apply all fields to `org_billing`. Useful when a webhook was missed.

**Add sessions**: calls `credit_sessions` Postgres function with `event_type = 'admin_adjustment'` and records the super admin user ID in metadata.

**Extend trial**: updates `trial_ends_at`, writes audit log entry.

### How to verify

- Super admin: sees billing section on org detail page.
- Non-super admin: billing section not rendered (guard with `isSuperAdmin()`).
- Resync: after clicking, `org_billing` matches current Stripe subscription state.

---

## What's deliberately NOT in this brief

Deferred to a follow-on brief:

- **Annual billing toggle in UI** — Stripe price IDs for annual plans should be set up, but the upgrade flow only shows monthly for MVP. Annual can be purchased via Stripe Customer Portal.
- **Email notifications** — trial expiry emails, payment failure emails. In-app banners cover MVP.
- **Org switcher UI** — the `getActiveOrgId` cookie mechanism is built, but there's no UI to switch between orgs. Fine for MVP where most users have one org.
- **Usage analytics dashboard** — credit ledger data is there; building charts on it is separate work.
- **Dunning (retry logic)** — Stripe handles failed payment retries automatically. Custom dunning is not needed for MVP.
- **Discount codes / coupons** — Stripe supports these natively via Customer Portal once configured.

---

## Working order

1. **Task 0** (active org cleanup) — do this first, unblocks everything.
2. **Task 1** (migrations) — run locally, verify DB shape before writing any TS.
3. **Task 2** (billing library) — the consume and entitlement helpers that everything else calls.
4. **Tasks 3 + 4** can run in parallel — onboarding flow and Stripe routes are independent.
5. **Task 5** (webhook) depends on Task 4 (checkout) being testable end-to-end.
6. **Task 6** (enforcement) depends on Task 2 and Task 5 (to have valid `org_billing` rows).
7. **Task 7** (UI) can start once Task 6 is working — mock the entitlement state for UI dev.
8. **Task 8** (admin) is additive on top of existing admin pages — do it last.

**Estimated total: 17–19 engineering days** as broken down in `MONETIZATION_REQUIREMENTS.md` Section 11.

When this brief is done, DiscOS can take a credit card, enforce usage limits, and guide a new user from zero to their first discovery session without anyone's help.
