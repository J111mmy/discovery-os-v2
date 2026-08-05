# Output quality eval

This is the minimal, file-based quality gate for the Output Quality Push (#221).
It exercises the production evidence-extraction and session-review prompts against
three small anonymised fixtures: discovery, prototype validation, and an internal
meeting. It never writes application data.

Validate the fixture without spending credits:

```bash
npm run check:output-quality-fixture
```

Run the real model-backed eval explicitly:

```bash
npm run eval:output-quality -- --live --label before --output /tmp/output-before.json --allow-failures
npm run eval:output-quality -- --live --label after --baseline /tmp/output-before.json --output /tmp/output-after.json --allow-failures
```

Re-score an existing report after changing only the expected outcomes, with no
new model calls:

```bash
npm run eval:output-quality -- --rescore /tmp/output-before.json --label rescored --output /tmp/output-rescored.json --allow-failures
```

The runner loads `.env.local` when present, uses the application's configured
standard-tier route, caps every call at 1,800 output tokens and 50 seconds, runs
sequentially, and reports tokens, cache usage, latency, model, and estimated cost.
`--live` is mandatory so an eval cannot spend credits by accident.

The JSON report preserves outputs and check-level failure categories. Do not add
real customer transcripts or personally identifiable information to this fixture.

## Pull-request gate

`.github/workflows/output-quality-eval.yml` inspects every pull request but only
spends provider credits when extraction prompts, session-review logic, or this
eval harness changes. Protected changes run the live model-backed eval with
`--ci-gate`. The gate fails when:

- fewer than the protected 28 checks remain;
- fewer than 28 checks pass;
- any current or newly-added check fails; or
- any distinct-signal retention check fails.

The workflow prints every failed check with its category and uploads the complete
JSON report for 14 days. Normal pull requests receive a successful skipped status
without making an LLM call.

Configure a GitHub environment named `output-quality-eval` with a dedicated,
low-spend secret named `OUTPUT_QUALITY_ANTHROPIC_API_KEY`. Do not reuse the
production provider key. The workflow deliberately uses `pull_request`, not
`pull_request_target`, so secrets are not exposed to forked pull requests. A fork
that changes protected paths cannot run the paid gate until a trusted maintainer
brings the change onto a repository branch.

Keep `Output quality gate status` as the required branch-protection check. This
job is always present, including on pull requests where the paid eval is skipped.
