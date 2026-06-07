# Security Posture — Living Invariants Ledger

**This is the doc to come back to.** It lists the security properties the platform *currently relies on*. Each is a thing that must **stay true** as we build. Dated assessments (below) establish them; this ledger keeps them in front of us.

**Rule:** any change that touches the LLM / ingest / compose / render paths, auth, RLS, migrations, middleware, or service-role usage must be checked against the relevant invariants before it ships. If a change *breaks* an invariant, that is a security decision requiring an Opus review — not a quiet refactor.

_Last reviewed: 2026-06-06 (Opus). Codex countersign: 2026-06-06, with A3 narrowed from the original platform-wide wording._

---

## A. LLM / agent layer (prompt-injection)

Established by `PROMPT_INJECTION_ASSESSMENT_2026-06-06.md`.

- [ ] **A1 — The model has no hands.** `callLLM` (and any LLM call) carries **no `tools` parameter**. Pure text-in → string-out. No action/network/DB channel the model can capture. *If anyone adds a `tools` array, the whole threat model changes → Opus review.*
- [ ] **A2 — Tenant scope never comes from the model.** `org_id` / `project_id` are always derived from trusted job params (`event.data`) or the authenticated session — **never from model output**. Tenant-data `createServiceClient()` queries in AI/user paths filter `.eq("org_id", org_id)` or pass `org_id` into the scoped RPC before any model output can influence results.
- [ ] **A3 — Structured model output is validated, not trusted.** Evidence extraction, entity extraction, and claim verification parse model JSON through schemas / allowlists and bind model-supplied IDs back to real provenance rows. Compose and session-review prose artifacts are not zod-shaped today; current Markdown rendering escapes them, and #14's HTML path must rely on server-side sanitisation on store and render.
- [ ] **A4 — Untrusted content is fenced as data.** Untrusted ingested content is wrapped in an explicit `<untrusted_source_content>` delimiter with a system instruction that it is data to analyse, never instructions to follow, and the delimiter token is neutralised in the content before interpolation (`neutralizeUntrustedSourceContentFence`) so it can't be escaped. *Implemented + Opus-approved for `ingest.ts` (body) and `ask.ts` (evidence content), 2026-06-06, committed `7dedfa9` (2026-06-07). Residual: untrusted-derived metadata fields (`source_title`, `segment_speaker`, `summary`) in `ask.ts` are still unfenced — see backlog item 5.*

## B. Rendering / XSS

- [x] **B1 — No `dangerouslySetInnerHTML` with AI/user content.** The sanctioned uses are: (1) the static theme no-flash script in `src/app/layout.tsx`; (2) the artifact reader's `content_html` render in `documents/[artifactId]/ArtifactReader.tsx` — sanitised at render via `page.tsx` `toSafeContentHtml()` (see B2). Any other new use with model/user content is a stored-XSS surface → Opus review.
- [x] **B2 — AI-authored HTML is sanitised server-side on store AND on render**, against the allowlist in `docs/ARTIFACT_HTML_CONTRACT.md` (semantic tags + allowlisted classes + tiny `data-*` set; no inline style, no SVG, no script/iframe/form, no `on*` / `javascript:` / `data:` URLs). **Render side LANDED 2026-06-06 (commits `cb38066` + `26252ed`):** `page.tsx` `toSafeContentHtml()` runs `content_html` through `sanitizeArtifactHtml()` server-side (and the `content_md`→HTML fallback through `markdownToSanitizedArtifactHtml`), fail-closed to the markdown viewer on `ArtifactHtmlValidationError`, before `ArtifactReader` renders via `dangerouslySetInnerHTML`. Opus-verified: sanitiser + check green, committed tree type-checks clean in an isolated worktree, Migration `0028` (additive `content_html` column) approved — **Jimmy runs the SQL**. **Store side LANDED 2026-06-07:** all three write paths sanitise `content_html` server-side before persist — `api/artifacts/save/route.ts` (user-scoped, both `artifacts` + `artifact_versions`, 422 on `ArtifactHtmlValidationError`), `inngest/functions/compose-artifact.ts` (service-role background job; on validation error marks `compose_status: "failed"` and never persists unsafe HTML), and the one-time backfill `src/lib/sanitize/backfill-artifact-html.mjs` (converts legacy `content_md` through `markdownToSanitizedArtifactHtml`, idempotent `WHERE content_html IS NULL`). Backfill applied by Jimmy 2026-06-07: 24 artifacts + 3 versions updated, 0 conversion failures, 494/494 + 234/234 citation markers converted losslessly; precondition gate `0029` passed (zero `content_html` nulls remain). `content_md` untouched. *Residual (non-gate): 234 dangling citation markers across 2 artifacts have no `citation_map` entry — pre-existing data-quality issue, recorded per-row in `metadata.html_migration`, does not affect HTML safety. Migration B (tighten `content_html` NOT NULL + drop `content_md`) remains separately gated for later.*

## C. Tenant isolation / auth

Established by `SECURITY_ASSESSMENT_MILESTONE_0.md`, `GATE3_SECURITY_REVIEW_AI_PROPOSALS.md`, migrations `0025`/`0027`.

- [ ] **C1 — Every table is RLS-scoped by `org_id`;** policies use the standard helpers (`auth_user_org_role` / `auth_user_org_ids`).
- [ ] **C2 — `createServiceClient()` (RLS bypass) is restricted to trusted background jobs / diagnostics / sanctioned admin and bootstrap paths,** and tenant-data queries filter `org_id` explicitly (see A2).
- [ ] **C3 — Privilege escalation has exactly one sanctioned path:** the `accept_invite(p_token)` SECURITY DEFINER RPC, called from a **user-scoped** client. Invite acceptance never uses `createServiceClient()` for membership writes.
- [ ] **C4 — AI writes to user data go through propose → human approve → record provenance.** No silent AI mutation of stored artifacts.

## D. Process / gate

- [ ] **D1 — Author ≠ gatekeeper.** Code touching the gated areas (auth, RLS/migrations, public routes, middleware, service-role) is authored by Codex and **reviewed independently by Opus before commit**. An author never self-clears their own security work.
- [ ] **D2 — SQL is run by Jimmy in Supabase;** neither AI applies migrations directly.
- [ ] **D3 — Secrets are never printed or committed;** isolation is never "proven" with the service-role key (only anon key + real-user JWTs).

---

## Assessments feeding this ledger

| Doc | Date | Covers |
|-----|------|--------|
| `PROMPT_INJECTION_ASSESSMENT_2026-06-06.md` | 2026-06-06 | A1–A4, B1–B2 (LLM/agent layer, XSS surface) |
| `GATE3_SECURITY_REVIEW_AI_PROPOSALS.md` | 2026-06-04 | C4, injection on AI-edit path |
| `SECURITY_ASSESSMENT_MILESTONE_0.md` | 2026-06-03 | C1–C3 (tenant isolation, invite path) |
| `ARCHITECTURE_SECURITY_HARDENING.md` | 2026-05-24 | Baseline architecture controls |
| `ARTIFACT_HTML_CONTRACT.md` (in `docs/`) | 2026-06-06 | B2 allowlist (the sanitiser's spec) |

## Open hardening backlog (not gate-blocking)

1. ~~**A4** — instruction/data fencing in `ingest.ts`.~~ ✅ Implemented + Opus-approved 2026-06-06, committed `7dedfa9` (2026-06-07).
2. ~~Same fence on `ask.ts` / RAG retrieval prompt.~~ ✅ Implemented + Opus-approved 2026-06-06, committed `7dedfa9` (2026-06-07).
3. ~~Keep no-tools posture explicit (comment/lint guard on `callLLM`).~~ ✅ `SECURITY INVARIANT A1` comments at both SDK sites, Opus-approved 2026-06-06, committed `7dedfa9` (2026-06-07).
4. ~~Claim-count cap per source (DoS-via-content).~~ ✅ `DEFAULT_MAX_CLAIMS_PER_SOURCE = 200` + env override, Opus-approved 2026-06-06, committed `bf91a89` (2026-06-07).
5. **Fence/neutralise untrusted-derived metadata in `ask.ts`** — `source_title`, `segment_speaker`, and `summary` are interpolated *outside* the fence in `formatEvidenceBlock` (`ask.ts:27-29,34-36`). A crafted source title / speaker label, or a summary steered by hostile body content, lands in the prompt unfenced. A4-adjacent residual found during the 2026-06-06 hardening review; not gate-blocking. (Optional ingest-side nit: also do every `.replace` in `buildIngestExtractionPrompt` in function form to remove benign placeholder-capture.)

> When you close a backlog item, tick the matching invariant above and note the PR.
