# Solo Mode Worklist

Date: 2026-07-01  
Owner while Opus is offline: Codex  
Rule: ship green-lane work in small commits; prepare red-lane work only; never run unmeasured LLM-spend agents live.

## Task 0, Observability

- [x] Add PostHog client instrumentation for analytics and session replay.
- [x] Identify authenticated users by Supabase user id and email.
- [x] Register project and org ids while inside a project route.
- [x] Strip query strings and invite/auth tokens from captured URLs.
- [x] Mask inputs and sensitive research/document text in replay.
- [ ] Jimmy: create PostHog project and add Vercel env vars.
- [ ] Smoke test one production session after deploy.

### Jimmy Setup

Add these in Vercel for Production and Preview:

```bash
NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=phc_...
NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com
NEXT_PUBLIC_POSTHOG_REPLAY_ENABLED=true
```

If the PostHog project is hosted in the US region, use:

```bash
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
```

## Green Lane, Codex Can Ship Solo

1. [x] `theme_evidence=0` investigation, highest value. Procurement Tracking has 16 themes and 23 trusted evidence but 0 `theme_evidence` links. Determine whether the issue is stale data or a live synthesis/linking bug, then file/fix as appropriate.
   - Result: live production no longer has this defect. Procurement Tracking now has 23 typed `theme_evidence` rows; the latest `project-synthesis` run completed on 2026-06-30 with `trusted_evidence=23`, `themes_created=10`, and `links_created=23`. Exact scary report was stale from before the June 28 forward-only writer fix and manual re-synthesis.
   - Follow-up found, not fixed while solo: the project still retains 6 draft themes with zero evidence after re-synthesis. They are not breaking typed traceability, but they can clutter theme surfaces and cause `discover-problems` batches to skip with `no_supported_theme_evidence`. Needs Opus/product decision: hide zero-evidence draft themes, archive stale AI themes after re-synthesis, or leave as visible analytical history.
2. [ ] #83 compose graceful empty state. Replace the hard "No traceable evidence found" failure with a clear "run synthesis first" empty state and CTA.
3. [ ] #119 rewire Add source from `/ingest` to `AddEvidenceModal` so there is one ingest path.
4. [ ] #84 follow-up. Align document card grounding count with the #85 `evidence_ids` fallback so card and reader agree.
5. [ ] #121 preview harness. Treat as a config bug, not a port bug.
6. [ ] #125 magic-link preview auth. Retest wildcard first, then find the real cause.

## Red Lane, Prepare Only

1. [ ] #14 Phase 3 backfill dry-run and report. Do not run `--apply`.
2. [ ] Migration B, `content_md` drop. Not now.
3. [ ] Any LLM-spend agent change. Dry-run measured under about 35s before any live run.
4. [ ] Opportunity convergence or all-or-nothing write resilience. Prepare only, because these affect generation and cost.

## Parked For Opus Or Jimmy

- [ ] Opportunity convergence spot-check.
- [ ] Channel-log reconciliation.
- [ ] Agent worktree separation so multiple agents stop colliding in one directory.

## Standing Guardrails

- Commit after every task.
- Keep unrelated dirty files out of task commits.
- Do not apply SQL or mutate existing artifact data while Opus is offline.
- Do not run live LLM-spend agents unless the exact batch shape has been dry-run measured.
- If a task touches auth, RLS, service role, schema, or tenant isolation, stop and prepare a review packet instead of shipping.
