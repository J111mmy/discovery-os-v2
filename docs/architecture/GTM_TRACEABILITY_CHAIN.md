# GTM Traceability Chain — what's wired vs. schema-only

**Status:** Living architecture note. Created 2026-06-10 after an end-to-end audit of the
"transcript in → GTM document out, traceable back to source evidence" pathway.
**Why this exists:** The vision is GTM artifacts (decks, PRDs, market strategy) generated
from interview transcripts, where any claim in the artifact can be traced back through
opportunities → problems → themes → evidence → the exact source segment in the transcript.
This note records, honestly, which links in that chain are *wired and working* versus which
are *schema-only* (tables exist, nothing populates or traverses them yet), so the gap doesn't
get lost.

---

## The intended chain

```
Transcript (source)
  → Source Segment            [ingest: conversation-unit segmentation]
    → Evidence                [ingest: AI-extracted, classified, anchored claims]
      → Topics                [descriptive layer: evidence_topics]
      → Themes                [interpretive layer: theme_evidence, theme_topics]
        → Problems            [decision layer: problem_evidence / problem_themes / problem_topics, typed]
          → Opportunities     [output layer: problem_opportunities / opportunity_evidence / opportunity_themes]
            → Artifacts (GTM) [artifact_evidence / artifact_problems / artifact_themes / artifact_opportunities]
```

Every typed join carries `relationship`, `source` (ai/human/imported), `review_state`
(suggested/accepted/…), and usually `confidence` + `rationale` + `agent_run_id`. The schema is
designed for full, provenance-stamped traceability at every hop.

---

## What is WIRED and working (verified 2026-06-10)

- **Transcript → Source Segment → Evidence.** Live ingest (`ingest-source.ts`). Evidence is
  anchored to segments via the shared matcher (`anchor.mjs`); `anchor_method` records precision
  (exact/normalised = precise; fuzzy/fallback = approximate). ~68% of *legacy* evidence is
  approximate (right turn, not exact quote); newly-ingested evidence anchors precisely.
- **Evidence → Themes.** `synthesise-project` writes themes + `theme_evidence`.
- **Themes → Problems, with typed evidence support.** `discover-problems` (research-ontology v2)
  writes `problems` + `problem_themes` / `problem_evidence` / `problem_topics`, each typed and
  rationale-bearing. ID-sanitised against scoped allowed-sets; resilient per-candidate parsing.
- **GTM artifact → Evidence citations.** `compose-artifact` writes `evidence_ids` + a
  `citation_map` onto each artifact. So **artifact → evidence → source transcript traces today**,
  at the evidence level (with the anchoring precision caveat above).

## What is SCHEMA-ONLY — the chain breaks here

1. **Opportunities do not generate.** The `opportunities`, `problem_opportunities`,
   `opportunity_evidence`, `opportunity_themes` tables exist (migration `0030`), but **nothing
   writes to them** — no Inngest agent, no route, no skill. (Only the read-only P3 dry-run script
   references the table.) So "problems → opportunities" is an empty room. **This is the biggest
   missing link in the chain.**
2. **Compose does not traverse problems/themes.** `compose-artifact` pulls evidence *directly*
   (semantic search → `evidence_ids`) and cites that. It never reads `problems`/`themes` nor
   writes `artifact_problems` / `artifact_themes` / `artifact_opportunities`. So a generated GTM
   doc can say "this claim is backed by these quotes," but **not** "this claim addresses Problem
   X, which emerged from Theme Y, evidenced by these quotes." The middle of the chain is not
   woven into generation.

### Net, honestly
- **GTM doc → evidence → transcript: works today.**
- **GTM doc → opportunity → problem → theme → evidence → transcript: not yet** — opportunities
  don't generate, and compose shortcuts straight to evidence.

---

## What it takes to close the chain (schema is ready for both)

1. **Opportunity-generation agent.** A sibling to `discover-problems`: problems → opportunities,
   writing the typed `problem_opportunities` / `opportunity_evidence` / `opportunity_themes`
   links with the same sanitise-against-scoped-IDs + resilient-parse + provenance pattern.
2. **Structure-driven compose.** Rewire `compose-artifact` to generate GTM docs *from* the
   problem/opportunity layer and cite *through* it (writing `artifact_problems` /
   `artifact_themes` / `artifact_opportunities`), instead of evidence-first. This is what turns a
   citation list into a traceable narrative.

## Acceptance test for "solid GTM docs with clear pathways"

Generate one GTM doc from real data, then click a single claim and walk it all the way back to
the transcript line. Today that trace lands at the evidence level. The chain is "done" when the
same click walks artifact → opportunity → problem → theme → evidence → source segment, each hop
typed and rationale-bearing.

---

## Tracking
- This note is the durable architecture record. Discrete build work is tracked in GitHub issues:
  - [ ] Opportunity-generation agent (problems → opportunities, typed links) — #25
  - [ ] Structure-driven compose (artifact cites through problem/theme/opportunity chain) — #26
- Keep this note updated as each link moves from schema-only to wired.
