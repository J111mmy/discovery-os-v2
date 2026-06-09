# Opus Review Packet - Research Ontology

**Status:** For Opus review before Sonnet/Codex build
**Author:** Codex
**Date:** 2026-06-09
**Related docs:**

- `docs/briefs/design/DESIGN_BRIEF_RESEARCH_ONTOLOGY.md`
- `docs/briefs/design/SONNET_BRIEF_RESEARCH_ONTOLOGY_UX.md`
- `docs/briefs/codex/CODEX_BRIEF_RESEARCH_ONTOLOGY_BACKEND.md`
- `docs/Research/Evidence - deep-research-report.md`

---

## 0. Review Ask

Please review the proposed DiscOS research ontology and build sequence:

```text
Raw material:
Source -> Segment -> Evidence

Analytical layer:
Evidence -> Topics/Codes -> Themes -> Problems

Operational/output layer:
Problems/Evidence/Themes -> Opportunities
Problems/Evidence/Themes -> Actions
Problems/Evidence/Themes -> Artifacts
```

Main question:

Does this give us a safe, shippable path to richer research intelligence without destabilising the product right before launch?

---

## 1. Decisions Proposed as Locked

### 1.1 Snippet labels should not be called themes

Current `evidence.themes` is semantically closer to topics/codes.

Proposal:

- user-facing evidence labels become **Topics**;
- `themes` is reserved for interpreted patterns;
- DB rename waits until later migration.

### 1.2 Tags and topics are different

Proposal:

- **Tags** are workflow/organisational labels and do not automatically feed synthesis.
- **Topics/Codes** are analytical labels and can feed synthesis.

### 1.3 Problems become the main decision object

Proposal:

- first high-value slice is Problem Intelligence v1;
- no migration required for first slice;
- use existing `source_theme_ids`, `source_evidence_ids`, evidence entities, sources, actions, opportunities, and artifacts.

### 1.4 Opportunities/actions/artifacts are sibling outputs

Proposal:

```text
Problems/Evidence/Themes -> Opportunities
Problems/Evidence/Themes -> Actions
Problems/Evidence/Themes -> Artifacts
```

Not:

```text
Problem -> Opportunity -> Action -> Artifact
```

Reason: evidence can directly create an action, a problem can create all three, and artifacts are communication/decision outputs rather than a stage in the analytical ladder.

### 1.5 Full ontology migration is deferred

Proposal:

- do not big-bang schema before ship;
- P0 language correction and P1 problem detail can ship with existing data;
- P3 schema v2 is Opus-gated and Jimmy-applied.

---

## 2. Decisions Needing Opus Approval

### 2.1 User-facing vocabulary

Recommendation:

- PM/CX language: **Topics, Themes, Problems, Opportunities**.
- Internal/research language may mention **codes** in docs, not primary UI.

Review question:

- Is "Topics" the right user-facing word, or should we use "Codes" anywhere visible?

### 2.2 Problem detail first slice

Recommendation:

- Build Problem Intelligence v1 before schema v2.
- Use existing schema only.

Review question:

- Is this sufficiently low-risk for near-ship, or should any part be gated further?

### 2.3 Opportunity object semantics

Current table:

- `project_opportunities` = evidence-backed suggestions for new/adjacent discovery workspaces.

Question:

- Should product opportunities linked to problems reuse this table with a subtype, or should we create a separate `opportunities` table later?

Codex recommendation:

- Do not decide in a rush. Use UI language broadly now; decide schema during P3/P4.

### 2.4 Polymorphic links

Backend brief suggests `artifact_links(target_type, target_id)` as one option.

Review question:

- Is polymorphic linking acceptable, or do we require typed FK tables for every artifact target?

Codex recommendation:

- Prefer typed tables where security/FK integrity matters. Polymorphic is convenient but weaker.

### 2.5 AI review state

Recommendation:

- AI-created topics/themes/problems should have `source` and `review_state`.
- Accepted/stakeholder-ready analysis should require human review.

Review question:

- Are there any analytical objects safe to auto-accept, or should all AI-created analysis remain suggested until human action?

---

## 3. Proposed Sequence

### P0 - Language correction

No migration.

- Evidence-facing `themes` labels become "Topics" in UI copy.
- Themes reserved for synthesis/patterns.
- No schema change.

### P1 - Problem Intelligence v1

No migration.

- Problem detail drawer/page.
- Fetch existing linked evidence/themes/entities/actions/opportunities/artifacts.
- Show who/what/why, affected context, evidence, outputs, gaps.

### P2 - Evidence lenses

No migration if possible.

- Review lens.
- Topic lens from `evidence.themes`.
- Theme lens from `themes` + `evidence_themes`.
- Problem lens from `problems.source_evidence_ids`.

### P3 - Ontology schema v2

Migration required.

- `tags`, `evidence_tags`.
- `topics`, `evidence_topics`.
- expanded `themes`, `theme_topics`, `theme_evidence`.
- expanded `problems`, `problem_themes`, `problem_evidence`, `problem_topics`.
- dry-run backfill.

### P4 - Operational link loop

Migration likely required.

- Problem/evidence/theme to opportunities.
- Problem/evidence/theme to actions.
- Problem/evidence/theme to artifacts.

---

## 4. Security Review Checklist

### 4.1 P0

Risk: low.

Check:

- no schema changes;
- no route changes;
- no RLS changes;
- no user-controlled query interpolation.

### 4.2 P1 Problem Intelligence v1

Risk: medium-low.

Check:

- no service role in user-facing reads;
- all joins scoped by `org_id` and `project_id`;
- project access resolved through existing auth helper;
- no new public route unless needed;
- no raw SQL errors exposed;
- redacted evidence preferred where appropriate;
- no new HTML sink;
- problem-derived fields clearly labelled when inferred.

### 4.3 P2 Evidence lenses

Risk: medium-low.

Check:

- filters are validated or use safe helpers;
- no PostgREST array literal interpolation;
- unknown topic/theme filters fail safely;
- org/project filters stay on every query;
- group counts cannot leak cross-tenant data.

### 4.4 P3 Schema v2

Risk: high.

Requires Opus review before commit/apply:

- migration SQL;
- RLS policies;
- enums/check constraints;
- backfill script;
- compatibility plan;
- deprecation plan for legacy arrays.

Check:

- every table has `org_id`;
- every project object has `project_id`;
- RLS enabled;
- service-role bypass justified or absent;
- joins cannot cross org/project;
- backfill is dry-run by default;
- backfill is idempotent;
- no destructive drop until verified.

### 4.5 P4 Operational links

Risk: medium.

Check:

- link tables use FKs where possible;
- no polymorphic target unless explicitly accepted;
- artifact citations remain evidence-based;
- actions remain assignable/statused;
- output creation does not silently mutate analytical objects.

---

## 5. UX Review Checklist

Please check Sonnet's future designs against:

- The user can understand the ladder without an academic explainer.
- Tags/topics/themes/problems look meaningfully different.
- Problems are rich enough to drive decisions.
- Evidence is always inspectable from problems/themes.
- The UI distinguishes suggested/draft from accepted/stakeholder-ready.
- Operational outputs are visible but not over-promised.
- Empty states do not feel broken.
- No raw provider/model/SQL details leak into UI.
- No hover-only critical controls.
- Mobile/touch access exists for evidence/problem actions.

---

## 6. Known Tradeoffs

### 6.1 Why not full schema first?

Because Jimmy is shipping soon. The highest-value near-term move is richer problem understanding using existing data.

Full schema first would create:

- migration risk;
- RLS review surface;
- backfill complexity;
- prompt pipeline churn;
- UI dependency risk.

### 6.2 Why not leave it as semantics only?

Because the current model will eventually produce tag soup.

Evidence labels, themes, and problems need separate relationships or:

- problems inherit every child label;
- themes become frequency buckets;
- users cannot tell what is descriptive vs interpretive;
- artifacts become less defensible.

### 6.3 Why not first-class Tags now?

Tags matter, but they are not the urgent value. The urgent value is:

```text
Evidence -> Topics -> Themes -> Problems
```

Tags should be designed into the model, but can ship later unless a workflow need demands them.

---

## 7. Opus Verdict Requested

Please return one of:

```text
APPROVED - proceed with Sonnet P1 design and Codex P1 backend only.
APPROVED WITH CONDITIONS - list required changes.
HOLD - revise ontology/spec before build.
```

Specific asks:

1. Approve/reject the vocabulary split: Tags vs Topics/Codes vs Themes vs Problems.
2. Approve/reject Problem Intelligence v1 as first slice.
3. Decide whether P1 needs a security gate before commit.
4. Flag any schema choices in P3 that are unacceptable before Codex writes migrations.
5. Flag any UX risks that Sonnet must address before prototype.
