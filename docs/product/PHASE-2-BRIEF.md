# DiscOS — Phase 2 Brief

Phase 1 is complete: auth, ingest pipeline, evidence storage, and compose drafting all work end-to-end.

Phase 2 makes DiscOS feel like a real product — evidence review, source management, project configuration, and team access.

---

## 1. Evidence trust review

**What:** Users need to review ingested evidence before it's used in compose drafts. Currently evidence sits in `pending` state and the Trust/Trust All buttons work, but there's no proper review surface.

**Build:**
- Evidence cards on the browser page should show the full chunk text (not truncated), speaker label if present, and source title
- Each card has two actions: **Trust** (moves to `trusted`) and **Exclude** (moves to `excluded`)
- **Trust All** button at the top trusts all pending evidence for the project in one click
- After trusting, compose drafts should only pull from `trusted` evidence (the `queryEvidence` function already supports this — just change the default `trust_scope` from `include_pending` to `trusted` in the compose pipeline)
- Show a count badge: "14 pending review / 38 trusted"

**DB:** No schema changes needed. `trust_scope` column on `evidence` table already has `trusted | pending | excluded` enum values.

---

## 2. Source management

**What:** Users need to see, manage, and retry their ingested sources. Currently sources appear as a list on the project page with no actions.

**Build:**
- Source list page at `/projects/[projectId]/sources` showing each source: title, type, date, status (pending/done/error), evidence count produced
- Each source has: **View segments** (shows the chunks that were created), **Delete** (removes source + its segments + evidence + jobs), **Retry** (re-fires ingest — `/api/ingest/retry` already exists)
- Add evidence count to each source card by joining `evidence` on `source_id`
- Source detail page (or modal) showing all segments for that source with their trust status
- Add "Sources" nav link to the project sidebar

**API:** Add `DELETE /api/sources/[sourceId]` — auth-guarded, deletes cascade via DB foreign keys.

---

## 3. Project settings

**What:** Projects need configuration — the Frame (what problem are we solving?), Operating Style (voice/tone for drafts), and GTM context (go-to-market background). These feed into the compose system prompt but currently have no UI.

**Build:**
- Settings page at `/projects/[projectId]/settings`
- Three rich text fields: **Project Frame** (the discovery question / north star), **Operating Style** (how documents should be written — formal, direct, narrative etc.), **GTM Context** (market background, customer segment, competitive landscape)
- Save button hits a new `PATCH /api/projects/[projectId]` endpoint
- Add "Settings" nav link to the sidebar (gear icon, at the bottom)
- On the project overview page, show a callout if Frame is empty: "Add a Project Frame to improve compose quality →"

**DB:** `projects` table already has `frame`, `operating_style`, `gtm_context` columns.

---

## 4. Team invite

**What:** Org owners need to invite colleagues. The schema supports multi-member orgs via `org_members` but there's no invite UI.

**Build:**
- Settings page has a **Team** tab alongside Project settings
- Input field: email address + role selector (Admin / Member) + Invite button
- On submit: create a row in a new `org_invites` table (token, email, org_id, role, expires_at), send invite email via Supabase auth
- Accept invite flow: `/accept-invite?token=...` page that validates the token, creates the `org_members` row, and redirects to `/projects`
- Team member list showing current members with their role

**DB migration needed:**
```sql
create table org_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  email text not null,
  role text not null default 'member',
  token text not null unique default encode(gen_random_bytes(32), 'hex'),
  accepted_at timestamptz,
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now()
);
alter table org_invites enable row level security;
create policy "org owners can manage invites"
  on org_invites for all
  using (org_id in (
    select org_id from org_members where user_id = auth.uid() and role = 'owner'
  ));
```

---

## 5. Artifact library

**What:** Compose drafts are saved as artifacts but there's no way to browse or re-open them. The `artifacts` and `artifact_versions` tables exist but aren't surfaced.

**Build:**
- Documents page at `/projects/[projectId]/documents` listing all saved artifacts: title, type, date, word count
- Click an artifact to open it in the compose editor (pre-filled with saved content)
- Delete artifact action
- The "Documents" count on the project overview page should link here
- Add "Documents" nav link to the sidebar

**DB:** No schema changes. `artifacts` and `artifact_versions` tables are already in place.

---

## Order of delivery

1. Evidence trust review — most critical, unlocks compose quality
2. Source management — removes the "black box" feeling of ingest
3. Artifact library — completes the compose loop
4. Project settings — improves compose output quality
5. Team invite — enables multi-user use

---

## Notes for Codex

- All new pages go inside `src/app/(app)/projects/[projectId]/`
- All new API routes go in `src/app/api/`
- Use the existing `getProjectForUser` auth helper for all route handlers
- Use `createServiceClient()` only in Inngest functions and server-side scripts — use `createClient()` everywhere else
- The sidebar component is at `src/app/(app)/projects/[projectId]/project-sidebar.tsx` — add new nav links there
- Run `npm run build` before marking anything done
