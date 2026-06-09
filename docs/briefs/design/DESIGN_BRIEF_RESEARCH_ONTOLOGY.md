# Design Brief - DiscOS Research Ontology

**Status:** Specification for Jimmy + Opus review before build
**Author:** Codex
**Date:** 2026-06-09
**Source material:** `docs/Research/Evidence - deep-research-report.md` and Jimmy's product direction in chat
**Audience:** Jimmy, Opus, Sonnet, Codex

---

## 0. Executive Decision

DiscOS should adopt the research ladder:

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

This is not merely semantics. The language change matters, but the deeper issue is that the current app compresses too many analytical jobs into the word `themes`.

Current DiscOS has strong foundations:

- `sources`, `source_segments`, and `evidence` already model raw material.
- Evidence already carries multi-label text arrays via `evidence.themes`.
- `themes` and `evidence_themes` already exist.
- `problems` already exist and link back to theme/evidence IDs.
- `actions`, `product_requests`, `project_opportunities`, and `artifacts` already create operational outputs.
- `agent_runs`, evidence grading, trust scopes, and artifact citations already give provenance and review patterns.

But the model needs a clearer separation between:

- **Tags**: flexible organisational labels.
- **Topics/Codes**: descriptive analytical labels on evidence.
- **Themes**: interpreted patterns with a central organising concept.
- **Problems**: structured, evidence-backed statements of friction.
- **Opportunities/Actions/Artifacts**: downstream work products or next moves.

The goal is a system where a user can move both ways:

- from a quote to the topic/theme/problem it supports;
- from a problem back to the people, companies, tools, evidence, and source context behind it;
- from a problem to the opportunity, action, or artifact that moves the work forward.

---

## 1. Locked Product Principles

### 1.1 Traceability is the product

Every synthesis object must be inspectable back to evidence. A user should never wonder why DiscOS believes something.

Minimum traceability chain:

```text
Artifact claim -> citation -> evidence -> source segment -> source -> project/org
Problem -> supporting evidence -> source/person/company context
Theme -> supporting topics/evidence -> source context
Opportunity/action -> originating problem/evidence/theme
```

### 1.2 Tags and topics are not the same thing

DiscOS should support both.

**Tags** are organisational labels. They may have no analytical meaning.

Examples:

- `follow-up`
- `VIP`
- `needs-redaction`
- `sales-call`
- `demo-candidate`
- `Q2-import`

**Topics/Codes** are analytical labels about what the evidence says.

Examples:

- `pricing confusion`
- `manual workaround`
- `inspection accountability`
- `integration friction`
- `procurement delay`

Rule: tags may help workflow and filtering, but they should not automatically feed synthesis. Topics/codes can feed synthesis.

### 1.3 Themes are interpreted patterns, not buckets

A theme is not just a common word or high-volume topic. A theme has a central organising concept.

Bad theme:

```text
Pricing
```

Better topic:

```text
pricing confusion
```

Better theme:

```text
Buyers cannot start implementation confidently because pricing, procurement, and rollout ownership are unclear.
```

### 1.4 Problems are richer than summaries

A problem must answer:

- who is affected;
- what is hard;
- why it matters;
- what evidence supports it;
- what confidence and caveats exist.

Problem statements should not be generated as generic summaries of tags. They should be structured analytical objects.

### 1.5 Opportunities, actions, and artifacts are sibling outputs

The operational layer is not one strict ladder.

The same evidence-backed problem can produce:

- an **Opportunity**: where the team might act;
- an **Action**: what someone should do next;
- an **Artifact**: what should be produced to align, sell, decide, or ship.

Example:

```text
Problem:
Site teams distrust remote inspection workflows because accountability still sits with the person physically present on site.

Opportunity:
How might we make inspection accountability visible and defensible without requiring physical presence?

Action:
Interview three QA/QC officers about sign-off evidence and handover risk.

Artifact:
Create a 6-page executive deck showing evidence, affected roles, workflow friction, and recommended next move.
```

### 1.6 Human review remains the trust boundary

AI can suggest topics, themes, problems, opportunities, and document changes. It must not silently rewrite the analytical truth of a project.

Use the existing DiscOS pattern:

```text
AI proposes -> user reviews -> user accepts/edits/rejects -> provenance is recorded
```

For pre-ship sequencing, this does not require building the full `ai_proposals` system immediately. But the ontology must not paint us into a corner where silent AI mutation becomes normal.

---

## 2. Current DiscOS Mapping

| Target concept | Current DiscOS equivalent | Assessment |
| --- | --- | --- |
| Source | `sources` | Good base. Needs stronger context metadata display over time. |
| Segment | `source_segments` | Good base. Speaker and ordering exist. |
| Evidence | `evidence` | Good base. Trust, summary, classification, sentiment, entities, metadata exist. |
| Tags | No first-class table | Missing. Could initially use metadata/UI only, but should not be confused with topics. |
| Topics/Codes | `evidence.themes text[]` | Existing field is semantically closer to topics/codes than true themes. |
| Evidence-topic join | `evidence_themes` | Useful but named as themes. Could be evolved into `evidence_topics` or aliased carefully. |
| Themes | `themes` | Exists but too thin. Needs central concept, status, provenance, support shape. |
| Problems | `problems` | Exists but too thin. Needs typed evidence/theme links and richer problem fields. |
| Opportunities | `project_opportunities` | Exists, but currently framed as adjacent project/workspace opportunities. Needs product opportunity semantics or explicit naming. |
| Actions | `actions`, `product_requests` | Good base. Needs links to problems/themes/opportunities, not only source/evidence. |
| Artifacts | `artifacts`, `artifact_versions`, citation map | Strong base after #14. Needs explicit links to problems/themes/opportunities, not just metadata. |

---

## 3. Target Object Definitions

### 3.1 Source

A source is the uploaded or linked raw material.

Examples:

- interview transcript;
- sales call transcript;
- support ticket export;
- survey response set;
- imported document;
- research note.

Required properties:

- org/project scope;
- source type;
- title;
- ingestion metadata;
- original file/link metadata;
- privacy/redaction state;
- participants if known;
- collection context where known.

### 3.2 Segment

A segment is an ordered chunk of a source.

Examples:

- transcript paragraph;
- speaker turn;
- document paragraph;
- ticket excerpt.

Purpose:

- preserves source order;
- anchors evidence back to raw context;
- stores speaker and segment index;
- reduces hallucination by keeping a retrievable source passage.

### 3.3 Evidence

Evidence is the atomic research record used for trust, retrieval, and synthesis.

Evidence should carry:

- raw/redacted content;
- trust scope;
- source and segment links;
- source type;
- speaker/person/company context if known;
- classification/sentiment;
- evidence entities;
- analytical topics/codes;
- optional workflow tags;
- context vector.

Evidence is multi-label. A single evidence item can support multiple topics and later multiple themes/problems.

### 3.4 Tags

Tags are flexible workflow or organisational labels.

Rules:

- Tags can be user-created.
- Tags do not imply analytical meaning.
- Tags should not automatically contribute to theme/problem synthesis.
- Tags can appear in filters, saved views, and workflow queues.

Examples:

- `needs-follow-up`
- `do-not-share`
- `exec-quote`
- `beta-candidate`
- `sales-proof`

### 3.5 Topics/Codes

Topics/codes are analytical labels on evidence.

Rules:

- An evidence item can have many topics.
- Topics can be AI-suggested.
- AI-suggested topics require state: suggested, accepted, edited, rejected.
- Topics may have parent topics/categories for navigation at scale.
- Topics are not problems.
- Topics are not necessarily themes.

Examples:

- `procurement delay`
- `pricing confusion`
- `manual QA workaround`
- `handover risk`
- `Procore dependency`

### 3.6 Theme

A theme is an interpreted pattern across evidence/topics.

Required shape:

- concise label;
- central organising concept;
- explanation;
- supporting topics;
- supporting evidence;
- confidence/strength;
- recency/freshness signal;
- provenance: AI-suggested, human-created, human-edited;
- status: draft, reviewed, accepted, archived.

Theme quality rule:

If it only says what the evidence is about, it is a topic. If it explains a patterned meaning, it is a theme.

### 3.7 Problem

A problem is an evidence-backed statement of friction or unmet need.

Required shape:

- title;
- statement;
- who is affected;
- what is hard;
- why it matters;
- current tools/workarounds;
- primary theme;
- contributing themes;
- supporting evidence;
- contradicting or weakening evidence where known;
- affected roles/personas/companies;
- severity;
- confidence;
- status;
- provenance.

Problem quality rule:

A problem must stand on its own as a decision object. The user should be able to open it and understand what is happening, who it affects, why it matters, and what evidence supports it.

### 3.8 Opportunity

An opportunity is a possible product, design, research, or GTM move created by the evidence-backed understanding.

Required shape:

- opportunity statement, usually "How might we...";
- linked problem(s), evidence, or theme(s);
- target user/segment;
- expected outcome;
- confidence;
- status;
- next decision needed.

Opportunity is not the same as a feature. It is the bridge from diagnosis to possible action.

### 3.9 Action

An action is a concrete task or commitment.

Actions may arise from:

- direct evidence;
- a source/session;
- a problem;
- a theme;
- an opportunity;
- an artifact review.

Actions should be operational and assignable.

### 3.10 Artifact

An artifact is a generated or edited output.

Examples:

- PRD;
- executive deck;
- evidence pack;
- GTM brief;
- problem memo;
- sales collateral;
- interview guide.

Artifacts must keep evidence provenance through citations and metadata. They should also be explicitly linkable to the problems/themes/opportunities they are based on.

---

## 4. UX Implications

### 4.1 Evidence should become multi-lens, not just a list

The Evidence area should support these lenses:

```text
Review
By Topic
By Theme
By Problem
By Source
```

Default view should remain task-oriented: review pending evidence, trust/exclude, inspect source context.

The analytical views should let the user ladder upward:

```text
Evidence item -> topics -> theme -> problem -> opportunity/action/artifact
```

And downward:

```text
Problem -> supporting themes/topics -> evidence -> source segment
```

### 4.2 Problems need a real detail surface

Problem cards are not enough. A problem detail drawer/page should expose:

- problem statement;
- who/what/why breakdown;
- severity/confidence;
- primary theme and contributing themes;
- affected roles, people, companies;
- current tools/workarounds;
- source mix;
- evidence recency;
- trust mix;
- supporting evidence;
- contradictory/caveat evidence;
- linked opportunities/actions/artifacts.

This is the fastest way to make the system feel smarter without a full schema rebuild.

### 4.3 Tags and topics must look different

Suggested visual distinction:

- **Tags**: small neutral chips, operational.
- **Topics/Codes**: analytical chips, searchable/filterable.
- **Themes**: larger pattern rows/cards with description and support count.
- **Problems**: decision objects with state, severity, confidence, and evidence depth.

Do not show all labels as identical chips. That recreates the tag soup problem visually.

### 4.4 Curation boundary

DiscOS should distinguish:

- **Working analysis**: messy evidence, suggested topics, draft themes, reviewer notes.
- **Curated outputs**: accepted problems, artifacts, evidence packs, stakeholder-ready views.

This can be subtle in v1. It does not need separate apps. But the UI should make clear what is draft/suggested versus accepted/stakeholder-ready.

---

## 5. Build Sequence

### Milestone 0 - No-risk language correction

Goal: make the app language more honest without a data migration.

Scope:

- Start referring to `evidence.themes` as "Topics" or "Evidence topics" in evidence-facing UI.
- Keep "Themes" for higher-order synthesis surfaces.
- Do not rename database fields yet.
- Update prompt language where safe.
- Avoid any copy that implies snippet-level labels are true themes.

Why now:

- Low risk.
- Helps users build the right mental model before deeper features ship.
- Reduces future migration confusion.

### Milestone 1 - Problem Intelligence v1 using existing schema

Goal: make problems feel rich and useful without waiting for a full ontology migration.

Use existing fields:

- `problems.source_evidence_ids`
- `problems.source_theme_ids`
- `evidence`
- `evidence_entities`
- `sources`
- `source_segments`
- `people`
- `companies`
- `actions`
- `product_requests`
- `artifacts`

Deliver:

- problem detail drawer/page;
- who/what/why structured display;
- supporting evidence list;
- source/person/company context;
- tools/workarounds extracted from evidence/entities/metadata where available;
- opportunities/actions/artifacts section;
- caveats/gaps section.

This is the highest value pre-ship slice.

### Milestone 2 - Evidence lenses

Goal: make Evidence navigable by abstraction level.

Deliver:

- Review lens;
- Topic lens;
- Theme lens;
- Problem lens;
- source/detail drilldowns.

Use existing data first. Do not block on schema v2.

### Milestone 3 - Ontology schema v2

Goal: formalise the data model after Opus review.

Add or evolve:

- `tags`
- `evidence_tags`
- `topics`
- `evidence_topics`
- `topic_hierarchy` or `parent_topic_id`
- expanded `themes`
- `theme_topics`
- `theme_evidence`
- expanded `problems`
- `problem_themes`
- `problem_evidence`
- `problem_topics` as provenance or materialised view
- operational link tables for opportunities/actions/artifacts.

This is migration work. It is Opus-gated and Jimmy-applied.

### Milestone 4 - Operational loop

Goal: connect research understanding to action.

Deliver:

- create opportunity from problem/theme/evidence;
- create action from problem/theme/evidence;
- draft artifact from problem/theme/evidence;
- show outputs back on the originating problem/theme/evidence.

This is where the system starts to feel magical: every analytical object can blossom into next moves.

---

## 6. Security and Trust Requirements

### 6.1 Tenant isolation

Every query and join must preserve:

```text
org_id + project_id scoping
```

Do not rely on client-provided IDs alone. Validate through existing membership/project access helpers.

### 6.2 RLS and migrations

Any new table must:

- include `org_id`;
- include `project_id` where project-scoped;
- have RLS enabled;
- use existing membership policy patterns;
- avoid service-role access from user-facing routes;
- be reviewed by Opus before application.

### 6.3 Prompt injection

Evidence/source content is untrusted input.

Any prompt that uses evidence must:

- clearly fence evidence as data;
- not give evidence text instruction authority;
- avoid tool-use channels unless security-reviewed;
- log prompt version and model in `agent_runs`.

### 6.4 Stored content safety

If themes/problems/artifacts render AI-generated rich text or HTML:

- sanitise before storage where HTML is persisted;
- sanitise again before render;
- use the existing artifact sanitiser pattern for any HTML surfaces;
- do not add new `dangerouslySetInnerHTML` sinks without Opus review.

### 6.5 Provenance

All AI-generated analytical objects should store:

- source: ai, human, imported, system;
- prompt version;
- model used;
- agent run ID where available;
- human decision state where reviewed;
- timestamps.

### 6.6 Privacy and curation

Raw evidence can contain sensitive customer/user information.

Stakeholder-ready surfaces should show curated/redacted evidence, not raw transcripts by default.

---

## 7. Open Decisions for Jimmy/Opus

1. Should user-facing language be **Topics** or **Codes**?
   - Recommendation: use **Topics** for PM/CX users, reserve **Codes** for internal/advanced docs.

2. Should Tags ship as a first-class object now or later?
   - Recommendation: later. First clarify topics/themes/problems. Tags can remain a design slot until the workflow need is sharp.

3. Should Problem detail be a drawer or full page?
   - Recommendation: drawer from list for speed and continuity; deep URL optional later.

4. Should Opportunities be renamed?
   - Current `project_opportunities` means adjacent workspace opportunities. Product opportunities from problems may need a separate object or a clarified subtype.

5. Should AI-generated themes/problems require explicit approval before appearing as accepted?
   - Recommendation: yes for accepted/stakeholder-ready state. Suggested/draft can appear in the working analysis area.

---

## 8. Definition of Done for This Ontology Initiative

The initiative is working when:

- evidence can be reviewed as raw records;
- topics/codes can be seen as descriptive labels;
- themes are clearly interpreted patterns;
- problems are rich, evidence-backed decision objects;
- a user can drill from problem to source evidence and source context;
- a user can create or inspect opportunities/actions/artifacts from analytical objects;
- the system records provenance for AI-created or human-edited analytical layers;
- labels no longer collapse into tag soup;
- the UX makes analysis feel simple, not academic.
