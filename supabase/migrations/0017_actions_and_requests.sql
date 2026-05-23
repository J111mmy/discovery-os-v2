-- Migration 0017: Actions and product requests
--
-- Two tables extracted from evidence by the extract-actions Inngest function
-- after each ingest:
--
-- actions         — commitments made by internal team members during sessions
--                   ("I'll send you the pricing deck", "Let me check with engineering")
--
-- product_requests — feature/product requests from external participants
--                   ("I wish it could do X", "We need Y before we could buy")
--
-- Both tables are linked back to the source and optionally the evidence record
-- they were extracted from.

-- ─── ACTIONS ────────────────────────────────────────────────────────────────

create table if not exists actions (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  project_id    uuid not null references projects(id) on delete cascade,
  source_id     uuid not null references sources(id) on delete cascade,
  evidence_id   uuid references evidence(id) on delete set null,
  description   text not null,       -- what was committed, in plain language
  owner         text,                -- who made the commitment (internal speaker name)
  due_note      text,                -- any timing hint mentioned ("by next week", "before the demo")
  status        text not null default 'open'
                  check (status in ('open', 'done', 'dismissed')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_actions_org_project
  on actions(org_id, project_id);

create index if not exists idx_actions_source
  on actions(source_id);

alter table actions enable row level security;

create policy "org members can read actions"
  on actions for select using (org_id in (select auth_user_org_ids()));

create policy "members can insert actions"
  on actions for insert with check (org_id in (
    select org_id from org_members where user_id = auth.uid()
      and role in ('owner', 'admin', 'member')
  ));

create policy "members can update actions"
  on actions for update using (org_id in (
    select org_id from org_members where user_id = auth.uid()
      and role in ('owner', 'admin', 'member')
  ));

create policy "members can delete actions"
  on actions for delete using (org_id in (
    select org_id from org_members where user_id = auth.uid()
      and role in ('owner', 'admin', 'member')
  ));

-- ─── PRODUCT REQUESTS ────────────────────────────────────────────────────────

create table if not exists product_requests (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade,
  project_id      uuid not null references projects(id) on delete cascade,
  source_id       uuid not null references sources(id) on delete cascade,
  evidence_id     uuid references evidence(id) on delete set null,
  company_id      uuid references companies(id) on delete set null,
  description     text not null,          -- what they want, in plain language
  requester_name  text,                   -- the participant who said it
  priority_signal text not null default 'nice_to_have'
                    check (priority_signal in ('nice_to_have', 'important', 'critical')),
  status          text not null default 'open'
                    check (status in ('open', 'backlog', 'in_progress', 'shipped', 'dismissed')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_product_requests_org_project
  on product_requests(org_id, project_id);

create index if not exists idx_product_requests_source
  on product_requests(source_id);

create index if not exists idx_product_requests_company
  on product_requests(company_id);

alter table product_requests enable row level security;

create policy "org members can read product_requests"
  on product_requests for select using (org_id in (select auth_user_org_ids()));

create policy "members can insert product_requests"
  on product_requests for insert with check (org_id in (
    select org_id from org_members where user_id = auth.uid()
      and role in ('owner', 'admin', 'member')
  ));

create policy "members can update product_requests"
  on product_requests for update using (org_id in (
    select org_id from org_members where user_id = auth.uid()
      and role in ('owner', 'admin', 'member')
  ));

create policy "members can delete product_requests"
  on product_requests for delete using (org_id in (
    select org_id from org_members where user_id = auth.uid()
      and role in ('owner', 'admin', 'member')
  ));

comment on table actions is
  'Commitments made by internal team members extracted from research sessions. E.g. "I will send you the pricing deck."';

comment on table product_requests is
  'Feature or product requests made by external participants extracted from research sessions. E.g. "We need CSV export before we could buy."';
