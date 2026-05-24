# Architecture, Reliability, and Security Hardening

This note captures the main concerns from the May 2026 Codex architecture sanity check. The 3-layer DiscOS architecture is directionally strong and reusable across many applications, but it needs a deliberate hardening pass before more agents are added.

## Overall Assessment

**Architecture pattern:** 8.5/10

The pattern is strong for stateful intelligence products: raw material enters the system, agents turn it into structured records, humans review and approve, and the UI renders durable knowledge with provenance.

**Current implementation maturity:** 6.5-7/10

The spine is right, but the system is still young. It has many powerful moving parts and needs observability, security review, regression tests, and stricter agent contracts to become boringly reliable.

## Where This Pattern Works Well

The database → AI agents → UI split is a reusable architecture for products where the core workflow is:

```text
raw material -> extraction -> structured records -> synthesis -> human review -> durable artifacts
```

Good application fits:

- Research and discovery intelligence
- Sales call intelligence
- Customer success and support analysis
- Competitive intelligence
- Compliance/document review
- Hiring/interview intelligence
- Internal knowledge systems
- GTM or product operations automation

Weaker application fits:

- Simple CRUD SaaS where AI adds little durable value
- Ultra-low-latency realtime collaboration
- Games and interactive simulation
- Disposable chatbot workflows where no structured memory is needed
- Workflows where users cannot tolerate eventual consistency

## What Is Strong

### 1. Database as Source of Truth

Supabase/Postgres is the right foundation for multi-tenant memory, joins, auditability, RLS, traceability, and long-lived records. Evidence, sources, agents, people, companies, artifacts, and themes all become queryable product state instead of transient AI output.

### 2. Agents as the Intelligence Layer

Inngest is the right place for ingest, extraction, synthesis, verification, compose, session review, actions, and profile digests. These jobs are too slow and failure-prone for ordinary request/response routes. Durable steps, retries, and agent logs are the right model.

### 3. UI as Review and Control Surface

The UI should not secretly become the intelligence layer. It should show what the agents produced, let users review or correct it, and make provenance obvious. That discipline is currently good and should be protected.

## Main Risks

### 1. Agent Sprawl

DiscOS now has many agents: ingest, entity extraction, synthesis, problem discovery, gap detection, compose, claim verification, session review, action extraction, person digest, company digest, frame draft, and likely competitors next.

That is powerful, but without a clear event graph it becomes hard to answer:

- What runs after ingest?
- Which jobs are allowed to fire other jobs?
- Which jobs are idempotent?
- What happens if a job fails halfway through?
- How do we replay a source safely?
- Which outputs are user-visible versus internal?

Needed:

- A documented event graph
- Idempotency rules for every agent
- Replay rules for every source/project/artifact job
- Job ownership: which table each agent reads and writes
- A single place to see agent status per source/project

### 2. Observability Is Not Yet Product-Grade

`agent_runs` exists, but it needs to become the operational dashboard for the system. When a user says "upload is broken" or "nothing happened", the app should expose where the job is: queued, processing, waiting on LLM, failed, completed, or skipped.

Needed:

- Agent run viewer in the app
- Per-source processing timeline
- Error surfaces with human-readable messages
- Counts of records created by each agent
- Retry buttons that call the correct event safely
- Alerting or at least obvious UI for repeated failures

### 3. Prompt and Schema Contracts Need Tightening

Many agents depend on Claude returning structured JSON. That is fine, but the contract must be explicit and enforced.

Needed:

- Zod validation on every agent output
- Versioned prompts recorded in `agent_runs`
- Store raw failed model output in a safe/debuggable form
- Golden transcript fixtures for ingest, session review, action extraction, entity extraction, synthesis, and verification
- Regression tests that catch "one transcript became one giant evidence record" immediately

### 4. Security Is Directionally Right But Not Proven

The architecture uses `org_id`, RLS, auth guards, and service-role separation, but it needs a full audit.

Audit checklist:

- Every DB query includes `org_id` where the table supports it
- No app route uses service role unless there is a clear reason and prior auth guard
- Inngest webhook signing is configured and verified in all environments
- Supabase RLS policies exist for every tenant table
- Storage buckets, if used, have tenant isolation
- Invite and team flows cannot cross org boundaries
- API routes do not leak whether records exist in another org
- LLM prompts do not include raw content that should have been redacted
- `.env` and Vercel environment variables are complete and least-privilege

### 5. PII and LLM Data Boundaries Need a Dedicated Pass

CLAUDE.md says PII redaction runs before any LLM call, but that must be verified in code path by code path. The system handles confidential customer interviews and internal strategy. The privacy boundary must be enforced, not assumed.

Needed:

- Explicit map of what each agent sends to the LLM
- Tests for redaction before LLM calls
- Org-level compliance mode design before enterprise use
- Clear retention/deletion story for raw source content
- Audit of people/company extraction to ensure entity names are intentionally preserved while high-risk PII is removed

### 6. Shared Server Query Helpers Are Becoming Necessary

Some pages and API routes now query the same data shape separately. That is acceptable while moving fast, but it raises the risk of inconsistent auth, missing `org_id`, and drift between UI and API.

Needed:

- Shared server-side data access helpers for common shapes:
  - project overview data
  - source detail data
  - company detail data
  - person detail data
  - evidence card data
- Helpers should require `org_id` explicitly and make unsafe queries harder to write.

## Recommended Hardening Order

1. **Security audit first**
   - Route handlers, server actions, Inngest functions, Supabase policies, service-role usage, and LLM payload boundaries.

2. **Agent event graph and observability**
   - Document every event, trigger, read/write table, idempotency rule, and failure mode.
   - Build source/project job timeline UI.

3. **Golden transcript regression suite**
   - A small set of representative transcripts and expected minimum outputs.
   - Prevents regressions in evidence quality, entity resolution, action extraction, and session review.

4. **Shared data access layer**
   - Reduce repeated query code and enforce `org_id` patterns.

5. **Prompt/schema contract hardening**
   - Zod validation everywhere, prompt versions in every run, failed output captured safely.

6. **Compliance mode and data retention**
   - Org settings for writing style, anonymisation, redaction, raw-source retention, and data residency notes.

## Codex Note To Claude

Claude: the roadmap now has an explicit architecture/security hardening track. The feedback is supportive of the 3-layer model, but the next product-quality jump should come from security audit, event graph clarity, observability, regression tests, and stricter agent contracts before adding too many more autonomous agents.

---

## Security Audit Results — May 2026

Full audit completed across all 20 API routes, 13 Inngest functions, 18 migrations, the LLM client, and the event graph.

### Finding 1 — FIXED: Artifact status route missing org_id scope

**File:** `src/app/api/artifacts/[id]/status/route.ts`
**Severity:** High
**Issue:** The GET handler fetched artifacts by `id` only — no `org_id` filter. Any authenticated user from any org could retrieve the title, content, and sections of any artifact by guessing its UUID.
**Fix:** Added org membership lookup after `getUser()`. Artifact query now includes `.eq("org_id", membership.org_id)`. Returns 403 if user has no org, 404 if artifact not found within their org.

### Finding 2 — CLEAN: All other API routes

Every other route (20 total) correctly follows the pattern:
1. `createClient()` + `getUser()` → 401 on failure
2. `org_members` lookup → 403 if no org
3. Entity-belongs-to-org guard before any writes
4. All DB queries include `.eq("org_id", ...)` or go through `getProjectForUser()` which enforces it

### Finding 3 — CLEAN: Supabase RLS

All 18 tables have `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`. Every table used by user-facing queries has read policies using `auth_user_org_ids()` (the SECURITY DEFINER function that prevents recursive RLS). Write policies exist on all tables that accept user-initiated writes. Tables written exclusively by service-role (evidence_entities, agent_runs, themes, source_segments) correctly have read-only policies — service role bypasses RLS by design.

### Finding 4 — CLEAN: Service-role separation

`createServiceClient()` is used only in:
- All 13 Inngest functions (correct — no user session available in background jobs)
- `ingest/route.ts`, `ingest/retry/route.ts`, `compose/draft/route.ts`, `sources/[sourceId]/route.ts` — all of these authenticate the user first via `createClient()`, then use service role only for specific writes that require bypassing RLS (cascade deletes, job inserts)

No route uses service role as a substitute for proper auth.

### Finding 5 — CLEAN: LLM payload boundaries

No authentication credentials, user emails, Supabase UUIDs, or internal system identifiers are sent to any LLM. Evidence content (names, company names, quotes from transcripts) is sent to Anthropic by design — this is the product's core function. Embeddings go to OpenAI's text-embedding-3-small. The LLM client has no logging of payloads. Both providers receive transcript content; this should be disclosed in the privacy policy before enterprise use.

### Finding 6 — CLEAN: Inngest event graph and idempotency

Event chain is well-structured:
```
source/ingest.requested
  → source/entities.requested  (extract-entities)
      → person/digest.requested   (synthesise-person)
      → company/digest.requested  (synthesise-company)
      → competitor/digest.requested (synthesise-competitor)
  → source/review.requested    (session-review)
  → source/actions.requested   (extract-actions)
  → project/synthesis.requested (synthesise-project)
      → project/problems.requested (discover-problems)
      → project/synthesis.completed (detect-gaps)
  → project/frame.requested    (draft-frame)

artifact/compose.requested     (compose-artifact)
  → artifact/claim.verification.requested (verify-claims)

project/synthesis.requested    (scheduled — weekly cron)
```

Idempotency assessment:
- `extract-entities`: upserts on slug — safe to re-run
- `extract-actions`: delete-then-insert on source_id — explicitly idempotent
- `synthesise-person/company/competitor`: overwrites digest fields — safe to re-run
- `ingest-source`: does not delete segments/evidence before retry, but Inngest's step checkpointing prevents re-running completed steps. Explicit retry via `/api/ingest/retry` correctly clears evidence and segments first.
- All functions catch errors and write to `agent_runs` — no silent failures

### Remaining Items (not fixed — require further work)

- **Observability UI**: `agent_runs` is populated but not surfaced in the app. Users cannot see why a job failed or where it is in the pipeline. This is the highest-priority remaining item for product quality.
- **Prompt/schema Zod validation**: LLM outputs are parsed with hand-written type guards. Zod validation would catch format regressions earlier.
- **Shared query helpers**: Several server components and API routes query the same data shape independently. Consolidating into helpers would enforce `org_id` consistency and reduce drift.
- **Inngest webhook signing**: `INNGEST_SIGNING_KEY` is present in `.env.local` but missing from the linked Vercel project as of 2026-05-24. Add it to Vercel before relying on production Inngest webhooks.
- **Golden transcript regression tests**: No automated tests for evidence quality, entity extraction, or synthesis output. A small set of fixtures would catch regressions early.
