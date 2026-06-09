# Codex Brief — Theme-filter PostgREST interpolation hardening (Cut #3 blocker)

> ⛔ **SECURITY GATE APPLIES (non-negotiable).** Before committing, check the change against `docs/security/SECURITY_POSTURE.md`. See `AGENTS.md` → "SECURITY REVIEW GATE". This overrides anything below.

**Author:** Opus 4.8 (security reviewer) · **For:** Codex · **Date:** 2026-06-09
**Source:** Cut #3 gated review of `evidence/page.tsx` (workspace redesign on `feat/cut-3`). Surfaced during the speaker-hide ↔ theme-filter reconciliation.

> **Gate status:** this is a data-layer change in a server component, **not** one of the five hard-gated areas (auth, RLS/migrations, public routes, middleware, service-role). So it is **not hard-gated** — but it *is* a security change, so **post the diff in `OPUS_SECURITY_CHANNEL.md` for a second-pass before committing.** Light-touch review, not a blocking gate.

> **Why it's a Cut #3 blocker anyway:** the unescaped interpolation ships *with* the redesign. Jimmy wants it fixed before Cut #3 promotes. It's small — please land it on `feat/cut-3` (or a branch that merges into it) so the cut goes out clean.

---

## The issue

**File:** `src/app/(app)/projects/[projectId]/evidence/page.tsx`
**Function:** `getRecentEvidence(orgId, projectId, trustScope, themeFilter)`
**Line ~28:**

```ts
if (themeFilter) {
  // Filter by theme label — themes is a text[] column; contains = @> (subset)
  evidenceQuery = evidenceQuery.filter("themes", "cs", `{${themeFilter}}`);
}
```

`themeFilter` comes straight from `searchParams?.theme` (user-controlled, via the `?theme=` query param) and is string-interpolated into a PostgREST array literal with **no escaping**.

**Severity: low.** To be explicit about the blast radius:
- **Tenant isolation is NOT at risk.** Every row is still bound by `.eq("org_id", orgId).eq("project_id", projectId)` *and* RLS. This query cannot read across tenants regardless of `themeFilter`.
- It is **read-only** (a `select`), so no write-side injection.
- The actual risk is a **malformed filter within the caller's own tenant scope**: a `theme` value containing `}`, `,`, `"`, or a backslash can break out of the `{...}` array literal or split it into extra elements, producing a filter that doesn't mean what the code intends (wrong/no results, or a 400 from PostgREST). It's sloppy, not a breach — but unescaped user input in a query string is exactly the pattern we don't want normalising in the codebase.

## The fix (preferred)

Let the client library do the escaping. Replace the raw `.filter(...)` string with the typed `contains` helper:

```ts
if (themeFilter) {
  // themes is text[]; .contains() builds the @> array literal with proper escaping
  evidenceQuery = evidenceQuery.contains("themes", [themeFilter]);
}
```

`postgrest-js` `.contains(column, array)` serialises the array element(s) safely, so no hand-rolled `{...}` interpolation is needed. Behaviour is identical for benign theme labels.

## Optional belt-and-braces (your call on effort)

If cheap, additionally validate `themeFilter` against the project's actual theme labels before using it — i.e. only honour `?theme=X` if `X` is in the set returned by the existing `themes` query for this project. Anything else → ignore the filter (fall back to the default `pending` view). This turns a free-text param into a whitelist and also gives the user a clean "unknown theme" fallback instead of an empty list. Not required for the security fix; the `.contains()` swap is sufficient on its own.

## Acceptance

- `?theme=` with a normal label behaves exactly as today (theme-filtered evidence list).
- `?theme=` containing `}`, `,`, `"`, or `\` no longer malforms the query — it either matches literally (no such theme → empty list) or, with the optional whitelist, falls back to the default view. No 400, no array-literal breakout.
- No change to scoping: `org_id` + `project_id` `.eq()` filters stay on every branch.
- Diff posted in `OPUS_SECURITY_CHANNEL.md` for second-pass before commit.

---

When it lands, note the PR/commit in `OPUS_SECURITY_CHANNEL.md` and I'll close it out against the Cut #3 gate.
