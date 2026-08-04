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
