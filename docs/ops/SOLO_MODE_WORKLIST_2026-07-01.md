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
2. [x] #83 compose graceful empty state. Replace the hard "No traceable evidence found" failure with a clear "run synthesis first" empty state and CTA.
   - Result: compose now tags this specific failure as `needs_synthesis`, the status endpoint returns a structured CTA, and the compose page shows a "Run synthesis first" empty state linking back to the workspace. Unexpected compose failures still render as normal errors.
3. [x] #119 rewire Add source from `/ingest` to `AddEvidenceModal` so there is one ingest path.
   - Result: the sources header and empty-state CTAs now open the shared `AddEvidenceModal`. Source retry actions still call `/api/ingest/retry`; the legacy `/ingest` page remains only for deep links.
4. [x] #84 follow-up. Align document card grounding count with the #85 `evidence_ids` fallback so card and reader agree.
   - Result: document cards and the citation reader now share one resolver that reads `citation_map`, parses rendered citation numbers, and fills missing entries from `metadata.evidence_ids`.
5. [x] #121 preview harness. Treat as a config bug, not a port bug.
   - Result: added a repo-local `.claude/launch.json` `dev` configuration that runs `npm run dev` on port 4321, and documented that static `npx serve`/`gate2-preview` launch configs must not be used for this Next app. Root cause was configuration drift, not the port itself: a stale launch config from another workspace could serve the repo directory as static files, producing the directory-listing preview. Launch sanity check found port 4321 already occupied by a Node process rooted in this repo with Next loaded, so the current listener appears to be a real app dev server rather than the old static server.
6. [ ] #125 magic-link preview auth. Retest wildcard first, then find the real cause.
   - Investigation result: the normal `/login` magic-link path already uses `window.location.origin`, so a link requested from a preview asks Supabase to return to that preview. The confirmed wildcard only covered `discos-git-*`; Vercel also emits non-git aliases (`discos-<hash>-...`), which need `https://discos-*-jimmy-keogh-s-projects.vercel.app/**`. Also check Vercel Preview does not set `NEXT_PUBLIC_APP_URL` to production, because server-generated invite/access-request links use that env var. No auth code changed while Opus is offline; Jimmy config/retest is needed to close.

## Red Lane, Prepare Only

1. [x] #14 Phase 3 backfill dry-run and report. Do not run `--apply`.
   - Dry-run only, run with Node 22 and no `--apply`: `artifacts.rows=32`, `artifact_versions.rows=0`, `failed_count=0` for both, `markdown_marker_count=0`, `converted_citation_count=0`, `unmapped_marker_count=0`. No artifact data was mutated. Opus/Jimmy decision remains whether to apply those 32 artifact conversions.
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
