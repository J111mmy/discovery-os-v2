# UI Audit — frontend vs. current schema

**Status:** Living note. First pass 2026-06-11, after the P0.5→P3 data/agent work landed and the
UI visibly lagged the schema. Captures (1) a concrete correctness bug in workspace evidence
linking and (2) the broader drift between the screens and the new research ontology.

**Scope honesty:** this is a focused pass over the link sites and ontology references across
`src/app/(app)`, not an exhaustive screen-by-screen review. Treat the two filed issues as the
anchors; expand as screens are touched.

---

## 1. Evidence-linking bug — workspace links to the wrong target (PRIORITY)

**Symptom:** clicking from the workspace doesn't take you to the specific evidence behind a
problem/theme — it dumps you on the generic `/evidence` list. The "clickable pathway back to
source" is broken *at the workspace surface*, even though the underlying data is correct.

**Root cause:** the correct, specific deep-links already exist and work elsewhere —
- `problems-list.tsx` and `evidence-browser.tsx` link evidence to
  `/projects/{id}/sources/{source_id}#segment-{segment_id}` (anchored to the exact segment; the
  source detail page renders matching `id="segment-{id}"` anchors, so it resolves).
- The problem drawer deep-link `/projects/{id}/problems?problem={problem_id}` (shows that
  problem's specific, segment-anchored evidence) is used by `evidence-browser.tsx` and
  `problems-list.tsx`.

…but `workspace-client.tsx` does **not** use them. Its link sites:
- **Opportunities teaser → `/evidence`** — wrong; opportunities aren't evidence (and no
  opportunity detail view exists yet — see #25/#26).
- **"View all" theme links → bare `/evidence`** — lose theme context. Only the `EvidenceChart`
  theme bars correctly use `/evidence?theme_id={id}`.
- **Problem items → not deep-linked** to `/problems?problem={id}`, which would show their
  specific evidence.

**Fix:** route workspace items to the deep-links that already exist —
problems → `/problems?problem={id}`; themes → `/evidence?theme_id={id}` consistently;
opportunities → a real target once the opportunity layer exists. No new plumbing needed; the
targets are built.

## 2. UI is largely unaware of the P3 ontology (DEBT)

Only `evidence-browser.tsx` (the P2 multi-lens browser) references the new ontology tables.
Every other screen predates P3:
- **Problems UI reads legacy arrays, not typed links.** `problems-list.tsx` /
  `problems/page.tsx` resolve evidence via `problems.source_evidence_ids` (text array), not the
  typed `problem_evidence` table — so `relationship` (supporting/contradicting/example/edge_case),
  `confidence`, and `rationale` never reach the UI.
- **Topics are invisible** outside the evidence browser (the descriptive layer added in P3).
- **No opportunities page/detail** (schema-only; tied to #25/#26). The workspace "Opportunities"
  card shows `project_opportunities` (the older "suggested workspaces" concept), which is now
  ambiguous against the new `opportunities` table.
- General: screens like "Review source-backed records" (evidence) still frame the model as
  Sources → Claims → Problems and don't surface topics/themes or the typed support chain.

---

## Tracking
- Issue #27 — Workspace evidence-linking bug (route to specific deep-links). **Priority** —
  correctness/trust, not polish.
- Issue #28 — UI catch-up to the P3 ontology (typed `problem_evidence` with relationship +
  rationale; surface the topics layer; reconcile `project_opportunities` vs `opportunities`).

Keep this note updated as screens are brought in line with the schema.
