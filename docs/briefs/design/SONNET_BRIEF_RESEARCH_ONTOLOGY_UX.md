# Sonnet Brief - Research Ontology UX

**Status:** Ready for Sonnet exploration after Jimmy/Opus review
**Author:** Codex
**Date:** 2026-06-09
**Depends on:** `DESIGN_BRIEF_RESEARCH_ONTOLOGY.md`
**Primary goal:** Make DiscOS feel like a research intelligence system where users can move cleanly between evidence, topics, themes, problems, and outputs.

---

## 0. Product Goal

Design the UX for this model:

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

This is not an academic taxonomy exercise. The UX must make the user's work easier:

- review evidence;
- understand patterns;
- trust problems;
- see who is affected;
- see what tools/workarounds are involved;
- turn the understanding into an opportunity, action, or artifact.

The user should feel: "I can see how the system got here, and I know what to do next."

---

## 1. Locked UX Principles

### 1.1 Simple first, deep on demand

Do not make users manage a complex ontology up front. The system should expose the ladder progressively.

Default experience:

```text
Evidence -> Problems -> Documents / next actions
```

Advanced drilldown:

```text
Evidence -> Topics -> Themes -> Problems -> Opportunities/Actions/Artifacts
```

### 1.2 No tag soup

Tags, topics, themes, and problems must not all look like the same chip.

Visual distinction:

- **Tags:** neutral workflow chips.
- **Topics:** compact analytical chips on evidence.
- **Themes:** pattern rows with explanation/support count.
- **Problems:** decision objects with severity, confidence, status, and evidence depth.

### 1.3 Traceability is always one click away

Every theme/problem/output must make evidence accessible.

Do not hide support behind vague counts only. Counts are useful, but users need to inspect representative evidence.

**[AMENDED - Claude review 2026-06-09]** Two backend prerequisites gate this principle (Codex brief section 3b, "P0.5"): evidence-to-segment links are currently mis-anchored to the interviewer's question, and problem evidence arrays are inherited theme unions rather than assessed support. Design the source-context link and the evidence sections assuming P0.5 lands first; until typed joins exist (P3), label problem evidence "Related evidence (via themes)" - never "Supporting evidence".

### 1.4 Do not over-explain the ontology in the UI

Avoid in-app education blocks like "A theme is...". Use clear labels, tooltips only where needed, and strong object design.

The app should teach the model by behaving consistently.

### 1.5 Curation boundary

Differentiate:

- draft/suggested analysis;
- reviewed/accepted analysis;
- stakeholder-ready outputs.

This can be visual state, not a separate app.

---

## 2. Surfaces to Design

### 2.1 Evidence surface: multi-lens review

Current page:

```text
/projects/[projectId]/evidence
```

Target concept:

An evidence intelligence surface with lenses:

```text
Review | Topics | Themes | Problems | Sources
```

Suggested behaviour:

- **Review:** existing trust workflow. Pending, trusted, excluded. This remains default for active review.
- **Topics:** evidence grouped by analytical topic/code.
- **Themes:** higher-order patterns, each with central idea, support, and evidence preview.
- **Problems:** evidence grouped under the problems it supports.
- **Sources:** source-first drilldown for provenance and context.

Important:

- If the backend only has `evidence.themes`, display those as **Topics** in evidence-facing UI.
- Do not call snippet-level labels "Themes".
- If a tab needs data not available yet, design the empty/loading/gated state and flag the backend need.

#### Evidence card requirements

Each evidence item should show:

- quote/content;
- source title/type;
- speaker if known;
- trust state;
- topic chips;
- optional workflow tags;
- entity mentions where available;
- link/open source context;
- action affordances: trust, exclude, restore, inspect.

Avoid oversized cards. Evidence review is repeated operational work, so density matters.

**[OPUS CONDITION C4 - 2026-06-10] Degraded-confidence source link.** P0.5 re-anchoring matches most claims exactly, but a tail (~<10%) resolves only by fuzzy/speaker/fallback match (carried in `evidence.metadata.anchor_method`: `exact | normalised | fuzzy | speaker | fallback_first_segment`). Design two states for the "open source context" affordance: a confident jump when `anchor_method` is `exact`/`normalised`, and an **"approximate location"** treatment (softer label, no implied pinpoint) for `fuzzy`/`speaker`/`fallback_first_segment`. Never present an approximate anchor as a precise one — that reintroduces the exact trust failure P0.5 fixes.

### 2.2 Topic lens

Purpose:

Let the user see what the raw evidence is about without pretending these are full themes.

Topic row/card should show:

- topic label;
- support count;
- trust mix if available;
- recent evidence sample;
- related source types;
- linked themes/problems if known.

Interactions:

- click topic -> filtered evidence;
- show representative evidence;
- future: accept/edit/reject AI-suggested topic.

Copy:

- Use "Topics" in PM-facing UI.
- Avoid "Codes" unless in advanced/internal settings.

### 2.3 Theme lens

Purpose:

Show interpreted patterns, not raw topic buckets.

Theme row/card should show:

- theme label;
- central organising concept;
- short explanation;
- supporting topic count;
- supporting evidence count;
- primary related problems;
- status: draft, reviewed, accepted, archived.

Interactions:

- open theme detail;
- inspect support;
- create/attach problem;
- create artifact from theme;
- future: revise theme with proposal flow.

Theme detail should show:

- central idea;
- related topics;
- supporting evidence;
- caveats;
- linked problems;
- linked outputs.

### 2.4 Problems surface: Problem Intelligence

Current page:

```text
/projects/[projectId]/problems
```

Target concept:

Problems are the main decision objects. They need a rich detail experience.

Problems list should show:

- title;
- status;
- severity;
- confidence/evidence strength if available;
- primary theme;
- affected group/role if available;
- evidence count;
- last updated/freshness;
- linked outputs count.

Problem detail should be a drawer or full page. Recommendation: drawer first for speed and continuity.

Required sections:

1. **Problem statement**
   - who is affected;
   - what is hard;
   - why it matters.

2. **Affected context**
   - roles/personas;
   - people;
   - companies;
   - current tools/workarounds;
   - source types.

3. **Evidence**
   - ~~strongest supporting evidence;~~ **[AMENDED - Claude review 2026-06-09]** strongest *related* evidence - labelled "Related evidence (via themes)" until typed `problem_evidence` joins ship in P3;
   - source context;
   - trust state;
   - topic chips;
   - citations/source links.

4. **Themes and topics**
   - primary theme;
   - contributing themes;
   - provenance topics.

5. **Outputs**
   - opportunities;
   - actions;
   - artifacts;
   - create buttons for each, gated to available backend support.

6. **Gaps/caveats**
   - old evidence;
   - weak support;
   - missing roles;
   - contradictory signals if present.

#### Problem detail call-to-actions

Use action verbs tied to outcomes:

- `Draft artifact`
- `Create opportunity`
- `Add action`
- `Review evidence`
- `Mark active`
- `Dismiss`

Avoid generic "Ask AI" language here.

### 2.5 Operational output strip

Problems, themes, and evidence should share an output pattern:

```text
Create from this:
[Opportunity] [Action] [Artifact]
```

But only show enabled buttons where the backend supports the operation.

Disabled/gated state:

- neutral;
- short tooltip;
- do not imply brokenness.

Example:

```text
Opportunity creation needs backend link table.
```

Do not surface technical table names to users.

---

## 3. Information Architecture

Recommended navigation language:

```text
Workspace
Evidence
Problems
Documents
```

Do not add too many top-level nav items for Topics/Themes. Topics and Themes should live inside Evidence/Problems until the product proves they need first-class navigation.

Suggested surface ownership:

| Concept | Primary surface | Secondary appearances |
| --- | --- | --- |
| Sources | Sources or Evidence/Sources lens | Evidence cards, problem support |
| Evidence | Evidence | Problems, documents, citations |
| Tags | Evidence filters | Source/session views |
| Topics | Evidence/Topics lens | Evidence chips, theme support |
| Themes | Evidence/Themes lens | Problems, workspace summary |
| Problems | Problems | Workspace, evidence lens, documents |
| Opportunities | Workspace or Problems detail | Project opportunities module |
| Actions | Source detail, Problems detail | Workspace reminders |
| Artifacts | Documents | Problems/themes/evidence output links |

---

## 4. Data Contract Sonnet Can Assume

For design work, assume the following available or intended fields.

### Evidence

- `id`
- `content`
- `summary`
- `trust_scope`
- `source_title`
- `source_type`
- `segment_speaker`
- `classification`
- `sentiment`
- `themes` currently used as topics
- `metadata`
- `created_at`

### Topic

Near-term:

- derived from `evidence.themes`

Future:

- `id`
- `label`
- `description`
- `parent_topic_id`
- `source`
- `status`
- `support_count`

### Theme

Current:

- `id`
- `label`
- `description`
- `evidence_count`

Future:

- `central_organising_concept`
- `status`
- `confidence`
- `supporting_topic_count`
- `supporting_evidence_count`
- `last_reviewed_at`
- `source`

### Problem

Current:

- `id`
- `title`
- `description`
- `severity`
- `status`
- `source_theme_ids`
- `source_evidence_ids`

Future:

- `statement`
- `who_affected`
- `what_is_hard`
- `why_it_matters`
- `current_workarounds`
- `current_tools`
- `primary_theme`
- `contributing_themes`
- `supporting_evidence`
- `contradicting_evidence`
- `confidence`
- `freshness`
- `linked_outputs`

---

## 5. UX States to Cover

### 5.1 Empty states

Evidence:

- no sources yet;
- sources exist but no evidence;
- pending evidence only;
- no trusted evidence.

Topics:

- no topics yet;
- topics exist but no accepted themes.

Themes:

- no synthesis run yet;
- draft/suggested themes only;
- accepted themes.

Problems:

- no problems discovered;
- surfaced problems awaiting review;
- no active problems;
- resolved/dismissed.

Outputs:

- no opportunities/actions/artifacts linked;
- output creation unavailable until backend lands.

### 5.2 Loading/pending states

Use calm language:

- `Finding related evidence...`
- `Drafting from trusted evidence...`
- `Building the evidence map...`

Do not mention model names, providers, embeddings, or internal pipeline names.

### 5.3 Error states

Errors should be actionable and non-technical.

Examples:

- `We could not load the supporting evidence. Try again.`
- `This problem has evidence links, but some records are unavailable.`
- `Drafting is temporarily unavailable. Try again shortly.`

Do not expose raw provider errors, SQL errors, stack traces, or IDs.

---

## 6. Accessibility and Interaction Requirements

- Keyboard navigable tabs/lenses.
- Focus-visible rings.
- Drawer focus trap and escape-to-close.
- Deep links for problem detail if practical.
- Reduced motion support.
- Text must fit across mobile and desktop.
- No hover-only critical actions.
- Evidence and problem actions must be reachable on touch devices.

---

## 7. Visual Guidance

DiscOS is an operational research tool, not a marketing site.

Use:

- dense but readable layouts;
- restrained surfaces;
- strong hierarchy;
- compact chips;
- tables/lists where scanning matters;
- drawers for contextual detail;
- clear empty states.

Avoid:

- giant hero sections;
- decorative cards inside cards;
- gradients/orbs;
- too many purple accents;
- educational walls of text;
- visual treatment that makes every label feel equally important.

---

## 8. Sonnet Deliverables

**[OPUS SCOPING - 2026-06-10] First deliverable = P1 only.** Scope the *first* Sonnet pass to the **Problem detail drawer (§2.4) + operational output strip (§2.5, gated/disabled states) + the empty/loading/error states for those surfaces**, designed as if P0.5 has already landed (real segment links incl. the C4 approximate state; "Related evidence (via themes)" labeling). **Hold the full evidence multi-lens redesign (§2.1–2.3, all five lenses)** — that is P2 and depends on data (`evidence_topics`, expanded themes) that does not exist until P3. Designing all five lenses now produces drift against schema that isn't built. The list below is the full-initiative deliverable set; do it in phase order, not all at once.

Sonnet should produce (across phases):

1. Evidence multi-lens layout proposal. *(P2 — hold)*
2. Topic/theme visual distinction. *(P2 — hold)*
3. Problem detail drawer/page design. *(P1 — first)*
4. Operational output strip design. *(P1 — first)*
5. Empty/loading/error states. *(P1 surfaces first; rest with their phase)*
6. Mobile/responsive behaviour.
7. Explicit data gaps for Codex.

Do not implement against invented data. If a screen needs data that does not exist yet, mark it as:

```text
Needs backend support
```

and specify the minimum shape.

---

## 9. Acceptance Criteria

The front-end design is ready when:

- users can understand the ladder without reading a manual;
- snippet-level labels are not called themes;
- problem detail clearly answers who/what/why;
- evidence is always inspectable from themes/problems;
- tags/topics/themes/problems are visually distinct;
- operational outputs are connected but not over-promised;
- all critical states are covered;
- no security-sensitive implementation details are exposed in the UI.
