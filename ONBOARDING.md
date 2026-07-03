# DiscOS — Onboarding for a joining engineer/agent

You're picking up mid-stream while Codex (the usual backend author) is out for a few days. This is the map. **Read `CLAUDE.md` in full and `docs/architecture/AGENT_STANDARDS.md` before you touch anything** — this doc orients you; those two govern.

## What DiscOS is
An AI-driven qualitative-research / product-discovery tool (getdiscos.com). Next.js App Router on Vercel Hobby, Supabase/Postgres, Inngest for background jobs. Locked ontology:

`Source → Segment → Evidence → Topics → Themes → Problems → {Opportunities, Actions, Artifacts}`

Problems are evidence-earned (never invented). Opportunities converge from problems. The full chain is closed and working on the "bots" fixture project.

## How we work
- **Roles:** Opus reviews; Codex authors backend/SQL; Design authors frontend/UI. **Codex is out — you author backend/full-stack now.** The review *gates* still hold: any **new LLM spend surface**, any **DB migration**, and any **destructive op** must be posted for Opus review **before it runs live**.
- **Commit after every task.** Do not leave uncommitted work in a shared working directory while another agent is active — this caused repeated git tangles. Use separate git worktrees if you can.
- **Jimmy runs ALL terminal / git / SQL / deploys himself.** Give exact, copy-pasteable commands. **Never put `#` comment lines inside a command block** — his interactive zsh executes them and errors. **No em-dashes in user-facing content.**

## The one law that matters most: cost-safety
Every LLM call is bounded on **all six surfaces**, checked together, never one at a time:
1. Inngest function `retries` (≤1 for premium spend)
2. our explicit retry/NonRetriable logic (timeouts are NonRetriable)
3. SDK `maxRetries` (0, set globally in `client.ts`)
4. `timeoutMs` (< 60s — Vercel Hobby kills at 60s)
5. `maxTokens` (never inherit the 16k premium default)
6. **work-per-call** — bound the input/batch so one unit finishes well under the timeout (the key lever)

Heavy generation is chunked into sub-60s Inngest steps. A CI guard (`check-agent-standards`, runs in `npm run build`) fails the build on violations. **Never run a spend agent live on an unmeasured batch size** — dry-run measure per-batch duration to < ~35s of the 50s timeout first. (This bug class recurred 3× because each fix touched only one surface. Map the whole call path.) New spend surfaces use cheap tier + explicit maxTokens + telemetry(orgId) + bounded input — see the #128 prescan speaker pass as the reference.

## Active queue
- **#128 — dynamic speaker identification (bounded cheap-tier LLM pass in prescan).** Backend done, Opus-approved, being committed. Post-merge gates: live golden-fixture run (`Test Projects/Search/Hickner_Interview01` academic `I:/P:`; the Jimmy & Caitlin Zoom/Otter transcript; the bots dataset with no regression) + a cost measurement on a large transcript. Design still owes Layer 3: a per-row "X" to drop a wrong speaker in `AddEvidenceModal`.
- **#129 — metered billing, Phase 1 only (next).** Rollups over `llm_cost_events` (already has `org_id`, `agent_type`, `tier`, tokens, `estimated_usd`); pull #52 (per-org admin spend view) forward; fix the timeout-recording leak (client-timeout premium calls bill the provider but skip `recordLLMCostEvent`). Phases 2–3 (credit ledger, Stripe) are **designed but gated** — do not build until trials validate pricing.
- **Re-synthesise `DiscOS - Vlaue`** (`f4670208-06ec-4f0e-a894-bb51b7e79716`) — last project with themes but 0 `theme_evidence` links (pre-fix synthesis wrote to the dead `evidence_themes` table).

## GATED — do NOT do without explicit Opus review
- #14 Phase 3 backfill `--apply` (dry-run report exists; `content_md` stays as rollback rail)
- Migration B (drop `content_md`)
- Dropping the dead `evidence_themes` table
- Any agent batch-size / cost change

## Project realities / gotchas
- `theme_evidence` is the **live** theme↔evidence join. `evidence_themes` is **dead/superseded** — don't write to it.
- **Prod deploys from `main` via GitHub auto-deploy** — NOT local `vercel --prod` (no local `.vercel` link). Merge PRs on GitHub; the `main` build runs the agent-standards guard.
- **Preview auth:** the magic link bounces to prod (Supabase Site URL, #125). Use **password login** on localhost/previews. The app runs on **localhost:4321** (`next-server`).
- Async handoff log is `OPUS_CODEX_CHANNEL.md` — read the latest entries.

## Where to look first
1. `CLAUDE.md` (full) — architecture, precedence rules, gotchas
2. `docs/architecture/AGENT_STANDARDS.md` — the cost-safety rulebook + the six surfaces
3. `OPUS_CODEX_CHANNEL.md` (tail) — current work state and review verdicts
