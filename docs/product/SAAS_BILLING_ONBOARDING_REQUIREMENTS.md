# DiscOS SaaS Billing and Onboarding Requirements

Status: Draft requirements for future implementation
Owner: Product/Engineering
Last updated: 2026-05-26

## 1. Purpose

This document defines the requirements for turning DiscOS from a working authenticated workspace into a self-serve, billable SaaS product using Stripe.

The goal is not only to "add Stripe". The goal is to make the entire customer lifecycle reliable:

- A user can sign up.
- A user can create or join an organisation.
- An organisation can start a trial or subscribe.
- The right users can manage billing.
- Entitlements are enforced consistently.
- New users are guided to a successful first outcome.
- Failed payment, expired trial, cancellation, and seat-limit states are handled safely.
- Admin/support users can diagnose and recover billing issues.

This brief is written so another LLM or engineer can take it on without needing prior thread context.

## 2. Product Context

DiscOS is a multi-tenant product discovery workspace. Data is scoped by organisation (`org_id`). The product ingests confidential source material, creates evidence, extracts entities, synthesises themes/problems, and drafts artifacts.

Important existing concepts:

- `orgs`: top-level tenant/workspace.
- `org_members`: user membership and role per org.
- `projects`: discovery projects inside an org.
- `sources`, `source_segments`, `evidence`: ingest and evidence pipeline.
- Inngest: background AI workflows.
- Supabase Auth: user auth.
- Supabase Postgres + RLS: data store and tenant isolation.
- Super admin: cross-org support/admin access, separate from normal org roles.

Important current product caveat:

- Org creation is currently implicit. A first project creation can auto-create an org from the user's email domain.
- Before billing goes live, org creation and active-org context should be made explicit and consistent.

## 3. Goals

### 3.1 Business Goals

- Enable self-serve subscription signup.
- Support free trial and paid plans.
- Support organisation-level billing, not individual-only billing.
- Support team invites and seat-based limits if chosen.
- Give admins a clear customer recovery path.
- Avoid accidental free usage after trial/subscription expiry.

### 3.2 User Goals

- Create an account and workspace without confusion.
- Understand whether they are in trial, active paid, payment failed, or expired state.
- Invite team members without manually coordinating accounts.
- Reach a useful first outcome quickly: first project, first source, first evidence, first draft.
- Manage billing without support intervention.

### 3.3 Engineering Goals

- Keep org data isolated.
- Keep billing state auditable.
- Make Stripe webhook handling idempotent.
- Enforce entitlements in API routes and background-triggering endpoints, not only in UI.
- Preserve existing auth and project flows where possible.
- Avoid coupling product logic directly to Stripe object shapes.

## 4. Non-Goals for MVP

The MVP does not need:

- Complex enterprise contracting.
- Usage-based metering by token count.
- Multi-currency pricing.
- In-app invoice rendering beyond Stripe Customer Portal.
- Custom tax/VAT logic beyond Stripe defaults.
- Multiple billing accounts per org.
- Per-project billing.

These can be added later.

## 5. Key Product Decisions Needed

These decisions must be made before implementation begins.

1. Pricing model:
   - Flat org subscription?
   - Per-seat pricing?
   - Tiered by usage, seats, or features?

2. Trial model:
   - Free trial without card?
   - Free trial with card?
   - Trial length, likely 7 or 14 days?

3. Entitlement limits:
   - Max projects?
   - Max sources per month?
   - Max team members?
   - Compose/AI usage limits?
   - Storage/file upload limits?

4. Expired state:
   - Read-only access?
   - Block ingest/compose only?
   - Block all project access?

5. Support policy:
   - Can super admins override subscription state?
   - Can support extend trials?
   - Is there a "grace period" after payment failure?

Recommended MVP:

- Organisation-level subscription.
- 14-day trial.
- No card required for trial if early beta, card required if open public signup.
- Gate high-cost actions first: ingest, compose, synthesis, team invites above limit.
- Keep read access available after trial expiry.
- Use Stripe Customer Portal for plan/payment management.

## 6. Current Architecture Constraints

### 6.1 Multi-Tenancy

All customer-owned data must be scoped by `org_id`.

Every query that reads or writes org-scoped data must include the org guard directly or through a trusted helper. This is especially important for billing and entitlements because one org's subscription status must never unlock another org's usage.

### 6.2 Active Org Context

Before Stripe implementation, normal app pages should use one consistent active-org mechanism:

- Normal user: active org comes from selected workspace or sole membership.
- Super admin: active org can come from impersonation cookie.
- Cross-org admin views remain isolated under `/admin`.

Top-level pages such as People, Companies, Competitors, and Documents must not silently use the first `org_members` row if the user can belong to or impersonate more than one org.

### 6.3 Service Client Usage

Use `createClient()` for user-scoped requests where RLS should apply.

Use `createServiceClient()` only where required:

- Stripe webhook route.
- Admin/support routes.
- Inngest functions.
- Server-side scripts.

When using the service client, always include explicit `org_id` checks.

## 7. Proposed Data Model

Prefer a separate `org_billing` table instead of overloading `orgs`.

### 7.1 `org_billing`

```sql
create table org_billing (
  org_id uuid primary key references orgs(id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  stripe_price_id text,
  plan_key text not null default 'trial',
  subscription_status text not null default 'trialing'
    check (subscription_status in (
      'trialing',
      'active',
      'past_due',
      'canceled',
      'incomplete',
      'incomplete_expired',
      'unpaid',
      'paused',
      'none'
    )),
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  seat_limit int,
  source_limit_monthly int,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

RLS:

- Org members can read billing summary for their org.
- Only owners/admins can initiate billing portal or checkout.
- Writes should happen through webhooks/admin/service routes.

### 7.2 `billing_events`

Webhook event log for idempotency and audit.

```sql
create table billing_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null unique,
  event_type text not null,
  org_id uuid references orgs(id) on delete set null,
  stripe_customer_id text,
  stripe_subscription_id text,
  payload jsonb not null,
  processed_at timestamptz,
  processing_error text,
  created_at timestamptz not null default now()
);
```

### 7.3 `plans`

Can be hardcoded in code for MVP, but a table is better if plans will change often.

Minimum fields if table-based:

```sql
create table plans (
  key text primary key,
  name text not null,
  stripe_price_id text unique,
  seat_limit int,
  source_limit_monthly int,
  project_limit int,
  features jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
```

### 7.4 Org Onboarding Fields

Add to `orgs` or separate `org_onboarding`.

```sql
alter table orgs
  add column if not exists onboarding_completed_at timestamptz,
  add column if not exists onboarding_state jsonb not null default '{}'::jsonb;
```

Recommended `onboarding_state` shape:

```json
{
  "workspace_created": true,
  "billing_started": true,
  "first_project_created": true,
  "frame_added": false,
  "first_source_added": false,
  "first_evidence_created": false,
  "first_document_created": false
}
```

## 8. Roles and Permissions

Existing roles:

- `owner`
- `admin`
- `member`
- possibly `viewer`

Billing permissions:

| Action | Owner | Admin | Member | Viewer | Super Admin |
|---|---:|---:|---:|---:|---:|
| Create checkout session | Yes | Optional | No | No | Support only |
| Open billing portal | Yes | Optional | No | No | Support only |
| Invite users | Yes | Yes | No | No | Support only |
| View billing status | Yes | Yes | Optional | Optional | Yes |
| Override billing status | No | No | No | No | Yes |

Recommended MVP:

- Owners can manage billing.
- Admins can view billing state but not change payment details unless explicitly allowed.
- Members can see high-level trial/expired banners but not payment details.

## 9. Signup and Onboarding Flows

### 9.1 New User Signup

Current:

- User signs in.
- First project creation can auto-create an org.

Target:

1. User signs up or signs in.
2. If user has no org memberships:
   - Redirect to `/onboarding/workspace`.
3. User creates workspace:
   - Workspace/org name required.
   - Slug generated.
   - User becomes owner.
4. Redirect to billing/trial step:
   - `/onboarding/billing`
5. Start trial or checkout.
6. Redirect to first project setup.

### 9.2 Existing User With Org

1. User signs in.
2. Resolve active org.
3. If org billing state is missing:
   - Create default trial billing row.
4. If onboarding incomplete:
   - Show onboarding checklist but do not block all usage.

### 9.3 Invited User

1. User clicks invite link.
2. If not authenticated, login/signup.
3. Accept invite.
4. Join existing org.
5. Do not create a new org.
6. Redirect to `/projects`.
7. If org subscription inactive, show org-level billing state but do not ask invited member to create payment unless owner/admin.

### 9.4 First-Run Product Onboarding

The desired first-run path:

1. Create workspace.
2. Start trial or subscribe.
3. Create first project.
4. Add project frame or accept generated frame.
5. Add first source/transcript.
6. Review evidence.
7. Trust evidence.
8. Generate first draft/document.

MVP UI:

- Onboarding checklist on project overview or workspace home.
- Clear empty-state calls to action.
- Progress markers.
- "Skip for now" allowed for frame, but suggest it improves results.

## 10. Stripe Integration Requirements

### 10.1 Environment Variables

Required:

```text
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
NEXT_PUBLIC_APP_URL=
STRIPE_PRICE_STARTER=
STRIPE_PRICE_PRO=
```

Do not expose secret keys to client code.

### 10.2 Checkout Session Route

Route:

```text
POST /api/billing/checkout
```

Request:

```json
{
  "org_id": "uuid",
  "plan_key": "starter"
}
```

Requirements:

- Auth required.
- User must be owner/admin for org.
- Org must match active org or explicit membership.
- Create Stripe customer if not already present.
- Create Stripe Checkout session.
- Include `org_id` in Stripe metadata.
- Use subscription mode.
- Success URL: `${NEXT_PUBLIC_APP_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`
- Cancel URL: `${NEXT_PUBLIC_APP_URL}/settings/billing`

Response:

```json
{
  "url": "https://checkout.stripe.com/..."
}
```

### 10.3 Billing Portal Route

Route:

```text
POST /api/billing/portal
```

Requirements:

- Auth required.
- Owner/admin only.
- Org membership required.
- Existing `stripe_customer_id` required.
- Return Customer Portal URL.

### 10.4 Stripe Webhook Route

Route:

```text
POST /api/stripe/webhook
```

Requirements:

- Must use raw request body.
- Verify Stripe signature using `STRIPE_WEBHOOK_SECRET`.
- Idempotent by `stripe_event_id`.
- Write event to `billing_events`.
- Update `org_billing`.
- Never trust client-provided billing state.

Events to support:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`
- `invoice.payment_failed`
- `customer.updated`

Useful optional events:

- `customer.subscription.trial_will_end`
- `payment_method.attached`

### 10.5 Stripe Metadata

Set metadata wherever possible:

```json
{
  "org_id": "uuid",
  "environment": "production"
}
```

Subscription metadata should include `org_id` because some webhook events are subscription-centric.

## 11. Entitlement Model

Implement a server helper:

```ts
getOrgEntitlements(orgId: string): Promise<OrgEntitlements>
```

Suggested shape:

```ts
type OrgEntitlements = {
  org_id: string;
  plan_key: string;
  billing_status: string;
  can_use_product: boolean;
  can_ingest: boolean;
  can_compose: boolean;
  can_invite_members: boolean;
  can_create_project: boolean;
  read_only: boolean;
  reason?: "trial_expired" | "past_due" | "canceled" | "seat_limit" | "usage_limit";
  limits: {
    seats: number | null;
    monthly_sources: number | null;
    projects: number | null;
  };
};
```

### 11.1 Enforcement Points

Do not enforce only in UI.

Must check entitlements in:

- `POST /api/ingest`
- `POST /api/compose/draft`
- `POST /api/artifacts/save` if artifact limits exist
- `POST /api/org-invites`
- project creation server action
- source retry route
- any route that queues expensive Inngest jobs

UI should also show disabled states and clear messages.

### 11.2 Recommended MVP Gates

Trial/active:

- Full access within plan limits.

Past due:

- Read access.
- Allow billing portal.
- Block new ingest and compose.
- Optional grace period of 3 to 7 days.

Canceled but period active:

- Full access until `current_period_end`.

Canceled and period ended:

- Read-only.
- Allow export/delete.
- Block new expensive operations.

No billing row:

- Treat as trialing for legacy orgs or block until billing setup, depending rollout.

## 12. UI Requirements

### 12.1 Workspace Setup Page

Route:

```text
/onboarding/workspace
```

Fields:

- Workspace name
- Optional company/team size
- Optional role/use-case

Creates:

- `orgs`
- `org_members` owner row
- `org_billing` trial row

### 12.2 Billing Page

Route:

```text
/settings/billing
```

Shows:

- Current plan
- Subscription status
- Trial expiry/current period expiry
- Seat usage
- Usage limits if any
- Button: Manage billing
- Button: Upgrade/Subscribe

### 12.3 Onboarding Checklist

Recommended route or component:

- `/projects` if no projects exist.
- Project overview if project exists.

Checklist items:

- Create workspace
- Start trial
- Create project
- Add project frame
- Add first source
- Review evidence
- Generate first document

### 12.4 Global Billing Banners

Show in app shell:

- Trial ends in X days.
- Payment failed. Update payment method.
- Subscription canceled. Access until date.
- Trial expired. Choose a plan to continue.

Do not show sensitive billing details to members without permission.

### 12.5 Admin View

Super admin should see:

- Org billing status
- Stripe customer ID
- Stripe subscription ID
- Plan
- Trial/current period end
- Recent billing webhook events
- Button: Resync from Stripe
- Optional: extend trial/manual override with audit log

## 13. API Surface Summary

Required new routes:

```text
POST /api/billing/checkout
POST /api/billing/portal
POST /api/stripe/webhook
POST /api/admin/billing/resync
```

Possible onboarding routes/actions:

```text
POST /api/onboarding/workspace
PATCH /api/onboarding/state
```

Existing routes to update with entitlement checks:

```text
POST /api/ingest
POST /api/ingest/retry
POST /api/compose/draft
POST /api/artifacts/save
POST /api/org-invites
createProjectAction
```

## 14. Inngest Considerations

Inngest functions should not be responsible for billing decisions after work is already queued.

Primary entitlement checks should happen before events are sent.

However, for defense in depth:

- Expensive Inngest functions can optionally re-check org entitlements before running.
- This prevents manually queued events from causing unexpected cost.

Recommended:

- Check entitlements in route handler before `inngest.send`.
- In ingest/compose functions, optionally check `can_ingest` or `can_compose` at function start and mark the job failed/skipped gracefully.

## 15. Security Requirements

Billing touches money and tenant access. Treat it as security-sensitive.

Requirements:

- Verify Stripe webhook signatures.
- Store webhook events idempotently.
- Never update billing state from client calls directly.
- Never trust `org_id` without checking membership/role.
- Use service role only in webhook/admin routes.
- Log all billing changes.
- Keep Stripe secret keys out of client bundles.
- Do not expose service role key to Vercel preview logs or browser.
- Ensure cancellation/expired states cannot be bypassed by direct API calls.
- Ensure super admin billing overrides are audited.

## 16. Testing Requirements

### 16.1 Unit Tests

- Entitlement helper for every billing state.
- Plan mapping from Stripe price IDs.
- Webhook event parser.
- Role checks for owner/admin/member.

### 16.2 Integration Tests

- New user creates org and trial.
- Owner starts checkout.
- Stripe checkout webhook activates subscription.
- Payment failed sets `past_due`.
- Canceled subscription becomes read-only after period end.
- Invited member joins existing paid org.
- Member cannot access billing portal.
- Expired org cannot ingest or compose.

### 16.3 Manual Stripe Test Mode Scenarios

Use Stripe test cards:

- Successful payment.
- Declined card.
- 3D Secure if relevant.
- Payment method update.
- Subscription cancellation.
- Trial expiry.

### 16.4 Production Smoke Test

Before inviting users:

1. Create a new test user.
2. Create workspace.
3. Start trial or checkout with real/test environment as appropriate.
4. Create project.
5. Add source.
6. Verify Inngest runs.
7. Verify evidence appears.
8. Invite another user.
9. Open billing portal.
10. Cancel subscription in Stripe test mode or staging.

## 17. Migration and Rollout Plan

### Phase 0: Pre-Work

- Fix active org context across app.
- Remove or label smoke-test orgs.
- Add clear admin view of org membership.
- Confirm RLS policies for all org-scoped tables.

### Phase 1: Billing Schema

- Add `org_billing`.
- Add `billing_events`.
- Backfill existing orgs as trialing or internal/free.
- Add plan constants.

### Phase 2: Stripe Test Mode

- Add checkout route.
- Add portal route.
- Add webhook route.
- Test locally with Stripe CLI.

### Phase 3: Entitlements

- Add helper.
- Gate expensive APIs.
- Add app shell banners.
- Add billing page.

### Phase 4: Onboarding

- Explicit workspace creation.
- First-run checklist.
- First project/frame/source path.

### Phase 5: Admin and Recovery

- Admin billing view.
- Resync from Stripe.
- Trial extension/override if needed.
- Webhook event inspection.

### Phase 6: Production Launch

- Add production Stripe keys.
- Configure webhook endpoint.
- Run live penny-plan/internal test if appropriate.
- Invite first external user.

## 18. Acceptance Criteria

The implementation is complete when:

- A new user can create a workspace and start trial/checkout.
- Stripe customer and subscription are attached to org.
- Webhook updates org billing state reliably.
- Owner can open Stripe portal.
- Members cannot manage billing.
- Entitlement checks block ingest/compose when org is inactive.
- Existing users/orgs have a defined billing state.
- Onboarding checklist guides user to first source and first evidence.
- Super admin can inspect billing state and webhook history.
- Production smoke test passes.

## 19. Risks and Mitigations

### Risk: Wrong org context

If top-level pages use first membership instead of active org, users can see confusing or incorrect data.

Mitigation:

- Build a single active-org helper and use it everywhere.

### Risk: Webhook duplicate or out-of-order delivery

Stripe sends events more than once and not always in intuitive order.

Mitigation:

- Store event IDs.
- Make processing idempotent.
- Prefer retrieving latest subscription from Stripe for critical updates.

### Risk: UI-only gating

Users can call API routes directly.

Mitigation:

- Enforce entitlements server-side in all mutation/AI routes.

### Risk: Trial abuse

Users can create many orgs for repeated trials.

Mitigation:

- Optional card-required trial.
- Domain/user heuristics.
- Admin monitoring.

### Risk: Support/admin confusion

Super admin can impersonate orgs. Billing changes must not accidentally happen under support context.

Mitigation:

- Make support mode visually obvious.
- Audit admin actions.
- Require explicit org ID for billing admin actions.

## 20. Open Questions

- What is the first paid plan and price?
- Is trial card-required?
- What is the final production domain?
- Are beta/internal orgs free forever?
- Should billing be per seat or flat per org?
- What should happen to existing orgs at rollout?
- Should usage limits be enforced immediately or only displayed?
- Should compose be moved fully to Inngest before billing launch to avoid timeout risk?

## 21. Recommended Next Step

Do not start with Stripe code.

Start with:

1. Active org context cleanup.
2. Explicit workspace setup flow.
3. Billing schema and entitlement helper.

Then add Stripe Checkout and webhooks on top.

