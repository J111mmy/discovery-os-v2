# DiscOS Research Ontology — Canonical Structure (the law)

**Status: DECIDED and APPROVED.** This is the canonical structural model for DiscOS. It was reasoned from research, debated, and locked by Opus review on 2026-06-10. It is not a suggestion and it is not up for casual reinterpretation. Read it before touching anything that creates, labels, groups, or renders evidence, topics, themes, problems, opportunities, actions, or artifacts.

> **Anti-drift warning.** The single most common way this product loses its way is someone (human or agent) looking at one layer in isolation, deciding it is "redundant" or "messy," and collapsing or renaming it. The layers are deliberate. If a layer looks pointless, you are missing context. Re-read this file, then raise the question. Do not act on the assumption.

---

## Why this exists

The structural research lived only in `docs/Research/Evidence - deep-research-report.md` and the `*_RESEARCH_ONTOLOGY_*` briefs, and the decisions lived only in the Opus review packet. None of it was in the session-level anchor (CLAUDE.md). So sessions kept rediscovering the model from the half-built implementation and drawing the wrong conclusion. This file is the fix: the decided model, in the place sessions actually read.

---

## The north star tie-in

Traceability is the product. The ontology is *how* traceability is structured: every output can be walked back down the ladder to the exact sentence a person said. Each layer is a link in that chain. Collapse a layer and you break the chain.

---

## The ladder

```
Raw material        Source ──▶ Segment ──▶ Evidence
                       (SRC)              (EVD, atomic, multi-label)

Analytical          Evidence ──▶ Topics/Codes ──▶ Themes ──▶ Problems
                                (snippet label)   (pattern)   (PROB, the decision object)

Operational         Problems / Evidence / Themes ──┬──▶ Opportunities
(sibling outputs,                                   ├──▶ Actions
 NOT a chain)                                       └──▶ Artifacts
```

Source: [OPUS_REVIEW_PACKET_RESEARCH_ONTOLOGY.md §0, §8](../briefs/opus/OPUS_REVIEW_PACKET_RESEARCH_ONTOLOGY.md).

---

## The objects

| Layer | What it is | Multi-label? | Has `review_state`? | The rule |
|---|---|---|---|---|
| **Source** | Raw artifact: interview, file, Slack export, transcript. | n/a | no | The original. Never edited by synthesis. |
| **Segment** | A unit within a source (a turn, a paragraph). Carries the speaker. | n/a | no | Evidence anchors to a segment. Anchor must be the *speaker's* segment, not the interviewer's question. |
| **Evidence** | The atomic citable unit: one quote / finding / signal, traced to a segment. | yes | n/a (has `trust_scope`) | One claim = one evidence record. Always inspectable. `trust_scope`: `pending → trusted / excluded / disputed`. |
| **Topic / Code** | A snippet-level label on evidence. Descriptive sorting. AI-suggested, human-editable. *Can* feed synthesis. | yes | yes | A topic is **not** a theme. It is a code attached to a snippet. User-facing word is "Topic"; "Code" is internal-docs only. |
| **Tag** | A workflow / organisational label. | yes | n/a | A tag is **not** a topic. Tags do **not** automatically feed synthesis. They are the human's own organising layer. (Schema exists: `tags`, `evidence_tags`. Not yet wired into the app.) |
| **Theme** | A higher-order pattern with a central organising concept. Interpretive synthesis. | n/a | yes | A theme is **not** a bag of topics and **not** a frequency bucket. It is a pattern of shared meaning. |
| **Problem** | An evidence-backed statement of friction or unmet need. The main decision object. | n/a | yes (`status`) | Derived from ≥2 evidence records, **never invented**. Keeps: direct evidence links + one **primary theme** + optional **contributing themes** + a **provenance topic set**. Not defined by inherited labels alone. |
| **Opportunity / Action / Artifact** | Operational outputs built from problems / evidence / themes. | n/a | varies | **Siblings, not a chain.** Evidence can create an action directly; a problem can create all three. Artifacts are communication/decision outputs, not a rung on the analytical ladder. |

---

## The three hard rules (do not violate without a recorded decision)

1. **Topic ≠ Theme ≠ Tag.** These are three different jobs: descriptive snippet labels (topics), interpretive patterns (themes), and workflow labels (tags). They look similar in a list and are constantly mistaken for each other. They are not the same. Merging them is the failure mode the whole research warned against ("tag soup," themes-as-frequency-buckets). See [deep-research report](../Research/Evidence%20-%20deep-research-report.md) and [review packet §6.2](../briefs/opus/OPUS_REVIEW_PACKET_RESEARCH_ONTOLOGY.md).

2. **Problems are primary and earned, not inherited.** A problem is a synthesised, evidence-backed statement with its own identity. It carries a *primary* theme for classification and *contributing* themes for cross-cutting issues, but it is never just "the union of its evidence's labels." Problems are derived from evidence, never authored directly, never invented.

3. **Opportunities / Actions / Artifacts are siblings.** The model is `Problems/Evidence/Themes → {Opportunity, Action, Artifact}`, not `Problem → Opportunity → Action → Artifact`. Do not impose a linear pipeline on them ([review packet §1.4](../briefs/opus/OPUS_REVIEW_PACKET_RESEARCH_ONTOLOGY.md)).

---

## The AI review-state rule (non-negotiable)

Every AI-created analytical object (topic, theme, problem) carries `source` and `review_state`. **No AI-created object reaches "accepted / stakeholder-ready" without a human action.** Suggested/draft objects may appear only in the working-analysis area, clearly marked. Visible review states: `suggested | accepted | edited`. This is the trust boundary: the machine proposes structure, the human accepts it. It is the product's whole reason to exist made literal. ([review packet §8 "AI review state"](../briefs/opus/OPUS_REVIEW_PACKET_RESEARCH_ONTOLOGY.md).)

---

## Vocabulary (locked)

- **User-facing (PM / CX language):** Topics, Themes, Problems, Opportunities.
- **Internal / research docs only:** "Codes" may be used for topics. Never surface "Codes" in the UI.
- **"Opportunity"** is reserved for the problem-linked product opportunity. The adjacent-discovery-workspace object is called **"Suggested workspaces"** in the UI, deliberately, to keep that word free ([review packet §8 answer 4c](../briefs/opus/OPUS_REVIEW_PACKET_RESEARCH_ONTOLOGY.md)). Do not rename "Suggested workspaces" back to "Opportunities."

---

## Implementation reality vs target (so you know the gap)

The model is decided; the build is partway through an approved phase plan. Today:

- **Topics** are still served from the legacy `evidence.themes` text[] column (the P2 "Topic lens"). The P3 `topics` / `evidence_topics` tables exist (migration `0030_research_ontology_v2`) but the app has not fully cut over to them. This is an *approved, in-progress* state, not a bug to "clean up" by deleting the topic layer.
- **Tags** (`tags`, `evidence_tags`) exist in schema with RLS but are **not wired into the app at all**. Activating them is a planned future slice, not a rogue table to remove.
- **Themes** use the `themes` table + `evidence_themes` join (real).
- **Problems** still read `source_evidence_ids` / `source_theme_ids` arrays in places; typed `problem_evidence` / `problem_themes` joins exist but the cutover is incomplete. Label cross-system reads honestly ("Related evidence (via themes)") until the typed joins are fully live.

Phase plan and gates: [review packet §3, §8](../briefs/opus/OPUS_REVIEW_PACKET_RESEARCH_ONTOLOGY.md). The P3 schema migration is hard-gated (Opus reviews SQL + RLS + backfill before Jimmy applies it).

---

## How to change this

The ontology changes ONLY by a conscious decision, recorded here and acknowledged by Jimmy, exactly like the roadmap. A new observation, a UI critique, or "this layer looks redundant" goes to discussion first, never a silent edit. If you believe a rule above is wrong, that is allowed and welcome: say so, explain why, and propose the change. What is not allowed is acting as if the rule does not exist.

---

## Sources

- `docs/Research/Evidence - deep-research-report.md` — the original reasoning (codes/topics/themes/problems, multi-label, provenance, subthemes-sparingly).
- `docs/briefs/opus/OPUS_REVIEW_PACKET_RESEARCH_ONTOLOGY.md` — the locked decisions and Opus verdict (2026-06-10).
- `docs/briefs/design/DESIGN_BRIEF_RESEARCH_ONTOLOGY.md`, `SONNET_BRIEF_RESEARCH_ONTOLOGY_UX.md`, `docs/briefs/codex/CODEX_BRIEF_RESEARCH_ONTOLOGY_BACKEND.md` — build briefs.
- `supabase/migrations/0030_research_ontology_v2.sql` — the schema for the typed layer.
</content>
</invoke>
