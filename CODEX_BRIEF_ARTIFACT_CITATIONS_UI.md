# Codex Brief — Artifact Citation Chips

## Goal

Composed documents now contain inline `[N]` citation markers that link back to specific evidence records. This brief makes those markers visible and interactive in the artifact detail page — so readers can tap any citation number to see exactly which source the claim came from.

No technical language in the UI. No mention of evidence IDs, agent runs, or prompts. The experience should feel like reading a well-sourced research report.

---

## What the backend provides

### `GET /api/artifacts/[id]/citations`

Returns:

```ts
{
  artifact_id: string;
  citations: Array<{
    n: number;              // citation number as it appears in the text, e.g. 1, 2, 3
    evidence_id: string;
    content: string;        // the actual quote or observation
    summary: string | null;
    source_title: string | null;
    source_type: string | null;
    segment_speaker: string | null;
    classification: "insight" | "verbatim" | "data_point" | "signal" | null;
    sentiment: "positive" | "negative" | "neutral" | "mixed" | null;
  }>;
}
```

Only cited records are returned, sorted by citation number. An artifact with no citations returns `{ citations: [] }`.

---

## What to build

### 1. Convert the artifact detail page to support citations

**File:** `src/app/(app)/projects/[projectId]/documents/[artifactId]/page.tsx`

The artifact detail page currently renders `MarkdownContent` in a server component. You need to make the citation interaction work client-side. The cleanest split:

- Keep the outer page as a server component (it fetches the artifact)
- Extract the article body into a new **client component** `ArtifactViewer` that:
  - Accepts `content_md: string` and `artifactId: string` as props
  - Fetches citations from `GET /api/artifacts/[id]/citations` on mount
  - Passes the citation data down to the markdown renderer
  - Manages which citation is currently "open" in a popover

---

### 2. Update `renderInline` to render citation chips

Inside `ArtifactViewer`, update the `renderInline` function (or its equivalent) to detect `[N]` patterns where N is a digit or digits, and replace them with an interactive chip:

```tsx
// When the text contains [1], [2], etc., render them as chips
// Citation chips should:
// - Be inline, superscript-style
// - Show the number
// - On click, open the citation popover for that number
// - If no citation data exists for N (API returned nothing for it), render as plain text [N]
```

**Visual spec:**

```
[3]  →  ³  (superscript chip, brand-coloured, clickable)
```

Style: small, rounded, brand-coloured background (like `bg-[var(--brand)]/15 text-[var(--brand)]`), rendered as `align-super` inline. Same style used in `ask-interface.tsx` for reference.

Do NOT change the citation appearance when no citations are loaded yet — render them as plain `[N]` text until citations load, then upgrade them to chips. This avoids layout shifts.

---

### 3. Citation popover

When a chip is clicked, open a small popover (or a slide-in panel on mobile) anchored near the chip. Show:

**Popover content:**

```
┌─────────────────────────────────────┐
│ [3]  Sarah K. · Customer interview  │  ← citation number + speaker + source type
│                                     │
│ "The approval step usually takes    │  ← content (truncated to ~200 chars if long)
│ three days minimum because every    │
│ manager has a different threshold…" │
│                                     │
│ [Source name]                    ↗  │  ← source_title, links to source detail page
└─────────────────────────────────────┘
```

Rules:
- If `segment_speaker` is present, show it as the primary attribution above the quote
- If `source_title` is present, show it as a secondary line or a small link at the bottom
- Do NOT show: evidence_id, classification badge, sentiment badge, source_type raw value — keep it clean
- Close on: click outside, press Escape, click another chip
- Only one popover open at a time

---

### 4. Citations loaded state — footer count

Below the article body, if citations were found, show a single muted line:

```
Built from N sources
```

Where N is the number of unique source titles cited. Do not show if zero citations, do not show if API fails — fail silently.

This is not a full bibliography. Just ambient reassurance that the document is grounded.

---

## Files to create / modify

| File | Action |
|---|---|
| `src/app/(app)/projects/[projectId]/documents/[artifactId]/page.tsx` | Extract article body into `ArtifactViewer` client component, pass `artifactId` down |
| `src/app/(app)/projects/[projectId]/documents/[artifactId]/ArtifactViewer.tsx` | Create — client component: fetches citations, renders markdown with chips + popover |

---

## Type reference

```ts
// From /api/artifacts/[id]/citations
type CitationRecord = {
  n: number;
  evidence_id: string;
  content: string;
  summary: string | null;
  source_title: string | null;
  source_type: string | null;
  segment_speaker: string | null;
  classification: "insight" | "verbatim" | "data_point" | "signal" | null;
  sentiment: "positive" | "negative" | "neutral" | "mixed" | null;
};
```

---

## Tone reminder

No system language anywhere. "Built from N sources" not "N evidence records cited". The popover shows the quote and who said it — nothing about evidence classification, trust scope, grading, or any internal system state. The reader is a product manager looking at a sourced document, not an engineer inspecting a database.

---

## Existing pattern to follow

`src/app/(app)/projects/[projectId]/ask/ask-interface.tsx` has working citation chip rendering and source card patterns — use it as a reference for visual consistency. The citation chip style, popover positioning, and close-on-outside-click behaviour should match or be close to what's already there.
