# Sonnet Design Brief — Theme exploration + problem drill-down + typed evidence (#29 + #28)

**Status:** Design brief, ready for Sonnet. Produces a design proposal for Opus/Codex review before build.
**Author:** Opus
**Date:** 2026-06-11
**Continues:** `docs/briefs/design/SONNET_DESIGN_PROBLEM_INTELLIGENCE_P1.md` (Jun 10, problem drawer P1)
**Issues:** [#29](https://github.com/J111mmy/discovery-os-v2/issues/29) (themes browse + drill-down) and
[#28](https://github.com/J111mmy/discovery-os-v2/issues/28) (typed `problem_evidence`, topics, opportunities reconciliation)
**Reference:** `docs/architecture/UI_AUDIT.md` §2, `docs/architecture/GTM_TRACEABILITY_CHAIN.md`

---

## 0. What changed since your P1 design — read this first

Your Problem Intelligence P1 design (Jun 10) was deliberately careful: it labelled all evidence
"**Related evidence (via themes)**" and avoided the word "Supporting," because at the time the typed
support layer wasn't populated — problems only had `source_evidence_ids` (a flat theme-union array,
not assessed support).

**That constraint is now lifted.** As of this morning (`2f5d542` on `main`, deployed to J111mmy), the
P3 research-ontology pipeline is live. The `discover-problems` agent now writes the **typed**
`problem_evidence` table, where every link carries:
- `relationship` ∈ {`supporting`, `contradicting`, `example`, `edge_case`}
- `rationale` (a sentence explaining *why* this evidence supports/contradicts the problem)
- `source` (`ai`/`human`), `review_state` (`suggested`/`accepted`/…), `agent_run_id`

Same for `problem_themes` (`relationship` ∈ {`primary`, `contributing`} + `rationale`) and
`problem_topics` (provenance). So the UI can **finally show real, assessed, rationale-bearing support**
— including *contradicting* evidence, which is a credibility signal a research tool should never hide.

**But the live UI doesn't read any of it yet.** `problems-list.tsx` and `problems/page.tsx` still read
the legacy `source_evidence_ids` / `source_theme_ids` arrays (verified: `problems-list.tsx:678,680`
renders bare "N themes · N evidence records"). That gap — typed data exists, UI shows legacy counts —
is exactly the "2 themes · 0 evidence, no way to inspect either" complaint that triggered #29.

## 1. The user need (verbatim, from review 2026-06-11)

> "I have no way of checking out themes in general, themes associated with my problem, or the evidence
> associated with my problem."

The team is onboarding **now** and will start reviewing AI-suggested problems today. This review/drill-
down surface is what makes the just-shipped intake *trustworthy and usable*. It is the highest-value
design work on the board.

## 2. Design the three connected surfaces

### 2.1 Themes browse view (NEW — does not exist today)
There is no themes index anywhere; themes appear only as workspace chips/chart and as a lens inside the
evidence browser. Design a first-class **themes browse → theme detail** path:
- **Index:** list themes with evidence counts, sortable/scannable. (Likely a new route
  `/projects/{id}/themes`.) Consider how it reads against an empty project (honest empty state) and a
  rich one (50+ themes — the synthesis query pulls up to 200).
- **Theme detail:** the theme's evidence, each evidence row → its source segment
  (`/sources/{sourceId}#segment-{segmentId}`). Surface the theme's `central_concept` / `interpretation`
  / `description` (these P3 fields exist on the `themes` table). Show which problems this theme feeds.

### 2.2 Problem drawer drill-down (EVOLVE your P1 drawer)
Take the P1 drawer from "Related evidence (via themes)" to **typed, assessed support**:
- Render evidence grouped/badged by `relationship`. **Supporting** and **contradicting** must be
  visually distinct — contradicting evidence is a feature, not an error. `example` / `edge_case` are
  secondary.
- Show the per-link **`rationale`** (why the agent linked it) and `review_state` (suggested vs accepted).
  This is the human-in-the-loop review signal — the reviewer is judging the AI's links.
- Themes in the drawer become **clickable** → theme detail (§2.1). Show `primary` vs `contributing`
  theme relationship.
- **Honest empty states (a #29 requirement):** when a problem has 0 *resolvable* typed evidence,
  explain *why* — e.g. "No evidence linked — created before evidence-grounded discovery" for legacy/
  old-agent problems — rather than a bare "0 evidence records." Note the live data is a **mix**: P3
  problems have rich typed links; pre-P3 problems have only legacy arrays or nothing. The design must
  degrade honestly across both.

### 2.3 Topics layer (#28) — make it visible
P3 added a descriptive `topics` / `evidence_topics` layer that's invisible outside the evidence browser.
Decide where topics earn their place (theme detail? evidence rows? problem provenance via
`problem_topics`?) without cluttering. Topics are descriptive/granular; themes are interpretive. Don't
make the user conflate them.

### 2.4 Opportunities reconciliation (#28) — a naming decision, design-led
The workspace "Opportunities" card currently shows `project_opportunities` (an older "suggested
workspaces" concept). A **new** `opportunities` table exists (schema-only until #25 generates into it).
Two different concepts, one label. Recommend how the UI disambiguates: which concept the workspace
surfaces, what each is called, and how they coexist (or whether the old one is retired in the UI). This
unblocks both #27 (workspace opportunity link) and the #25 agent's eventual output surface.

## 3. Design principles to carry forward (from your P1 work)
- **Honest about provenance** — never imply precision the data doesn't have; label assessed vs unassessed.
- **Show structure even when empty** — labelled placeholder rows over hidden sections; explain gaps.
- **Reuse established chrome** — the `SourceDrawer` slide-in pattern, existing CSS variables, the
  evidence-browser's lens/anchor conventions. This is one coherent product, not a new visual language.
- **Drawer vs page** — you chose a drawer for the problem detail in P1; carry that unless theme detail
  argues for a full page. Make the call and justify it.

## 4. Deliverable
A design proposal in `docs/briefs/design/` (same format as `SONNET_DESIGN_PROBLEM_INTELLIGENCE_P1.md`):
surfaces, states (empty/loading/error/mixed-provenance), the exact data each reads (name the typed
tables/columns: `problem_evidence.relationship/rationale/review_state`, `problem_themes.relationship`,
`themes.central_concept/interpretation`, `evidence_topics`), and open decisions for Opus/Codex. **Scope
the build into P-stages** if it's large (e.g. P1 = problem drawer typed-evidence migration; P2 = themes
browse view) so Codex can ship incrementally — the problem-drawer typed migration is the most urgent
slice for the onboarding team.

## 5. Dependencies & coordination
- **Backend already shipped** — typed tables are live and populated by `discover-problems`. No backend
  blocker for reading them. (Writing/editing `review_state` from the UI — accept/reject a link — may
  need a small route; flag it as a dependency if your design includes reviewer actions.)
- **Parallel work:** Codex stand-in is fixing the workspace deep-links (#27,
  `CODEX_BRIEF_WORKSPACE_DEEPLINK_FIX.md`) — minimal overlap (they touch `workspace-client.tsx` link
  hrefs only). Your §2.4 opportunities-naming call will inform their opportunity link.
- **Downstream:** #25 (opportunity-generation agent) and #26 (structure-driven compose) extend this
  chain to GTM docs. Your opportunities reconciliation (§2.4) is the UI seam they plug into.
