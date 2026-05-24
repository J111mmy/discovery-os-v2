# Codex Brief — Demo Readiness Polish

## Context

The core product is feature-complete. This brief covers the UX polish needed before showing it to real users. No new features — fix the rough edges on the happy path.

---

## 1. Mobile sidebar — replace stacked layout with a drawer

**File:** `src/app/(app)/projects/[projectId]/layout.tsx` and `project-sidebar.tsx`

**Current problem:** On mobile, the sidebar is just rendered above the content. It takes up most of the screen, pushes content down, and there's no way to collapse it.

**What to build:**

On screens `< lg`:
- Hide the sidebar completely by default
- Show a hamburger button (`☰`) in the top-left of the main content area
- On tap: slide in the sidebar from the left as a full-height drawer with a dark overlay behind it
- Tapping the overlay or a nav item closes the drawer
- The sidebar content is identical to the desktop version

Use `useState` for open/closed. No external library needed — a fixed-position overlay + `translate-x` transition is enough.

The desktop layout (`lg:grid-cols-[260px_minmax(0,1fr)]`) stays exactly as-is. Only the `< lg` behaviour changes.

---

## 2. Evidence browser — load more

**File:** `src/app/(app)/projects/[projectId]/evidence/evidence-browser.tsx` (or wherever the evidence list client component lives)

**Current problem:** The evidence page loads 20 records and stops. There's no way to see more.

**What to build:**

Add a "Load more" button at the bottom of the evidence list. On click:
- Fetch the next batch of 20 from `/api/query` (or via a server action) using `offset`
- Append results to the existing list
- Hide the button if fewer than 20 results were returned in the last batch (i.e. we're at the end)

Keep it simple — no infinite scroll, just a button. Loading state on the button while fetching.

---

## 3. Sources list — human-readable labels

**File:** `src/app/(app)/projects/[projectId]/sources/page.tsx` (and any source card components)

**Current problem:** The sources list likely still shows raw `trust_scope` values ("pending", "trusted") and raw `type` values ("customer_interview").

**What to fix:**

Import `sourceTypeLabel` and `trustScopeLabel` from `@/lib/labels` and use them everywhere source type and trust scope are displayed. (These utilities already exist — see `src/lib/labels.ts`.)

Also: make each source row in the list a link to the source detail page if it isn't already.

---

## 4. New project — redirect after creation

**File:** `src/app/(app)/projects/new/actions.ts`

**Check:** After `createProjectAction` succeeds, does it redirect to the new project's workspace page (`/projects/[newProjectId]`)? If it redirects to `/projects` (the list), change it to redirect to the new project directly. The user just created it — they want to start working in it immediately.

---

## 5. Ingest form — copy and placeholder improvements

**File:** `src/app/(app)/projects/[projectId]/ingest/ingest-form.tsx`

Check and improve:
- The source type dropdown should use human labels (from `src/lib/labels.ts` — `SOURCE_TYPE_LABELS`) not raw enum values in the `<option>` text
- The title field placeholder should be more concrete: "Q1 call with Sarah K., Acme Corp" not just "Source title"
- After successful ingest, make sure it redirects to the source detail page, not just resets the form. Users want to see what was created.

---

## 6. Empty states — add a "get started" nudge

**Files:** Project overview, sources page, evidence page, documents page

Each empty state currently shows a plain text message. Add a single clear CTA:

- **Sources page, no sources:** "No sessions yet" + big "Add your first transcript →" button linking to `/projects/[id]/ingest`
- **Evidence page, no evidence:** "No evidence yet — add a session to get started" + same CTA
- **Documents page, no documents:** "No documents yet" + "Draft your first document →" button linking to `/projects/[id]/compose`

Keep them minimal. One line of explanation, one button. No illustrations needed.

---

## 7. Problems page — check it exists and is reachable

**File:** `src/app/(app)/projects/[projectId]/problems/page.tsx`

Verify the problems page renders correctly with real data (problems from the `problems` table). If it shows raw severity values ("high", "medium", "low"), replace with friendlier labels and colour-coded badges. The sidebar link "Problems" should work and land on a usable page.

---

## Notes

- `src/lib/labels.ts` already has `sourceTypeLabel`, `trustScopeLabel`, `trustScopeClasses`, `priorityLabel`, `priorityClasses`, `aiGradeLabel`, `aiGradeClasses` — use these instead of inline ternaries
- No new backend work in this brief — all fixes are UI-only
- Run `npm run type-check` and `npm run build` before committing
