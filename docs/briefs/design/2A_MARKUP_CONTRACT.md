# 2A — Markup Contract: Doc-Kit Primitive Shapes

**Author:** Sonnet (Design)
**For:** Codex (converter) + Opus (allowlist review)
**Status:** ✅ CSS shipped — awaiting Codex converter + Opus allowlist expansion

> This is the **handoff spec** for sub-phase 2A of the Structural Ports brief. Sonnet defines the
> HTML element+class contract and ships the CSS. Codex then implements `markdownToContractHtml`
> to emit this exact markup. Opus reviews the allowlist expansion before it merges.
>
> Source of truth: `docs/ARTIFACT_HTML_CONTRACT.md` (v1 locked). This spec covers the
> **BarChart addition (v2)** plus a canonical reference for all v1 shapes in one place.

---

## v1 primitives — shapes (unchanged, reference only)

All v1 shapes are already in `docs/ARTIFACT_HTML_CONTRACT.md` and in `doc_kit.css`. Codex
implements these as-is. The CSS for every v1 block is complete. Do not alter shapes or add
inline `style` — the sanitiser will strip them.

### Hero
```html
<header class="dp-hero">
  <span class="kicker">DISCOVERY REPORT</span>
  <h1>Title goes here</h1>
  <p class="lede">One-paragraph summary.</p>
  <div class="dp-meta">
    <span class="who">Olivia Bennett</span>
    <span class="dot"></span><span>6 Jun 2026</span>
    <span class="dot"></span><span>4 min read</span>
  </div>
</header>
```
- Kicker colour comes from `kicker` class only (CSS uses `var(--accent)`) — do NOT set inline colour.
- Author avatar is render-time CSS only (`::before` on `.who`). Do not emit an avatar element.

### Section
```html
<section class="sec" id="sec-the-problem">
  <h2 class="dp-h2" data-section="The problem">
    <span class="dp-num">01</span>The problem
  </h2>
  <!-- section body -->
</section>
```
- `id` slug: `sec-` + lowercased, non-alpha → hyphen, trimmed. E.g. "Why now" → `sec-why-now`.
- `dp-num` is optional; include only when the section has a sequence number.
- Sections flow directly inside `.dp-art` — no `.dp-pad` wrapper.

### Lede
```html
<p class="lede">Opening paragraph with serif styling.</p>
```

### H3
```html
<h3 class="dp-h3">Sub-heading text</h3>
```

### PullQuote
```html
<blockquote class="pq">
  <p class="pq-text">"Direct quote from a research participant."</p>
  <p class="pq-cite"><b>Dana Reed</b> · Project Lead, Northgate</p>
</blockquote>
```

### StatGrid
```html
<div class="stat-grid cols-3">
  <div class="stat-cell">
    <div class="n pos">47</div>
    <div class="l">trusted claims</div>
  </div>
  <div class="stat-cell">
    <div class="n">208</div>
    <div class="l">total evidence items</div>
  </div>
  <div class="stat-cell">
    <div class="n warn">6</div>
    <div class="l">open risks</div>
  </div>
</div>
```
- Column count: `cols-2`, `cols-3`, or `cols-4` class on `.stat-grid`. No other value.
- Tone classes on `.n`: `pos`, `neg`, `warn`, `info` — or omit for default (`var(--ink)`).
- Do NOT use inline `color` style on `.n`.

### Callout
```html
<div class="callout warn">
  <div class="ct">Body text. <b>Bold label.</b> More text.</div>
</div>
```
- Kind classes: `info`, `warn`, `pos`, `neg`. Icon + tint come from CSS.
- Only one kind class per callout.

### Takeaway
```html
<div class="takeaway">
  <span class="tk-label">Key takeaway</span>
  <p>The main insight in 1–2 sentences.</p>
</div>
```
- `tk-label` text can vary (e.g. "Recommendation", "The bet") — keep concise.

### List
```html
<ul class="dp-list pos">
  <li>First item — can include <strong>bold</strong> or <em>italic</em>.</li>
  <li>Second item.</li>
</ul>
```
- Tone class on `<ul>`: `pos` (check), `neg` (×), `info` (→), `warn` (⚠). Icon from CSS.
- `<li>` children may contain `<strong>`, `<em>`, `<cite data-n="N">N</cite>`.

### DataTable
```html
<table class="dp-table">
  <thead>
    <tr><th>Column A</th><th>Column B</th><th>Column C</th></tr>
  </thead>
  <tbody>
    <tr><td>Row value</td><td>Row value</td><td>Row value</td></tr>
  </tbody>
</table>
```
- First column of each `<td>` row gets bold treatment via CSS — no `<b>` wrapper needed.
- Cell content may include `<strong>`, `<em>`, `<cite data-n="N">N</cite>`.

### Flow
```html
<ol class="flow">
  <li class="flow-step">
    <span class="fs-n">01</span>
    <span class="fs-t">Step title</span>
    <span class="fs-d">Short description of this step.</span>
  </li>
  <li class="flow-step pain">
    <span class="fs-n">02</span>
    <span class="fs-t">Pain point</span>
    <span class="fs-d">Why this step hurts.</span>
  </li>
</ol>
```
- Add `pain` class to `.flow-step` for steps that represent friction. CSS tints red.
- Step count is zero-padded 2-digit: `01`, `02`, …

### Split
```html
<div class="dp-split">
  <div><!-- left column content --></div>
  <div><!-- right column content --></div>
</div>
```
- Direct children are the two columns. They can contain any block primitive.

### Evidence / Citations
```html
<!-- Inline citation chip (within prose): -->
<cite data-n="3">3</cite>

<!-- Evidence badge (standalone, after a claim): -->
<span class="ev" data-n="2">2 sources</span>
```
- `data-n` must be a positive integer 1–9999. The viewer binds a popover to it.
- Citation count in prose must equal the count in `artifact.metadata.citation_map`.

---

## v2 addition — BarChart

### Stored HTML shape
```html
<div class="barchart">
  <div class="bar">
    <span class="bl">Stale schedule / tracking</span>
    <span class="bt"><span class="bf"></span></span>
    <span class="bv">54</span>
  </div>
  <div class="bar">
    <span class="bl">Manual delivery verification</span>
    <span class="bt"><span class="bf"></span></span>
    <span class="bv">47</span>
  </div>
  <div class="bar">
    <span class="bl">Reporting &amp; visibility</span>
    <span class="bt"><span class="bf"></span></span>
    <span class="bv">38</span>
  </div>
</div>
```

- `.bl` — label text (left column). May include HTML entities but no nested tags.
- `.bt` — the bar track (grey background). Contains exactly one `.bf` child.
- `.bf` — the bar fill. Width starts at 0% (CSS default); hydrator sets `--pct` and `--delay`.
- `.bv` — the numeric value as plain text. Must be a non-negative integer string (no commas, no units).
- Row order: descending by value — tallest bar first. The hydrator computes `max` from the DOM.
- Do NOT emit inline `style` on any of these elements.

### Hydration contract (for Codex / ArtifactReader integration)

The hydrator is a client-side script that should run once after the document paper is mounted:

```js
// Find all bar charts in the rendered artifact
document.querySelectorAll('.barchart').forEach((chart) => {
  const bars = [...chart.querySelectorAll('.bar')];
  const values = bars.map((b) => {
    const v = parseInt(b.querySelector('.bv')?.textContent ?? '0', 10);
    return isNaN(v) ? 0 : v;
  });
  const max = Math.max(...values, 1); // floor 1 to avoid division-by-zero

  // Set up the IntersectionObserver for scroll-in animation
  const ob = new IntersectionObserver(
    ([entry]) => {
      if (!entry.isIntersecting) return;
      bars.forEach((bar, i) => {
        const fill = bar.querySelector('.bf');
        if (!fill) return;
        fill.style.setProperty('--pct', ((values[i] / max) * 100).toFixed(1) + '%');
        fill.style.setProperty('--delay', i * 80 + 'ms');
      });
      ob.disconnect();
    },
    { threshold: 0.3 }
  );
  ob.observe(chart);
});
```

Key points:
- CSS vars `--pct` and `--delay` are set **at render time** by JS — they are never in stored HTML.
- `prefers-reduced-motion` is already handled by CSS (`transition: none` on `.bf`).
- The hydrator should be attached to the `ArtifactReader` client component (not a global script).
- If JS is unavailable (rare), bars display at 0% width but labels and values are still readable.

### New allowlist items required in `artifact-html.ts` — **Opus must review before merge**

```
New classes to add to ARTIFACT_HTML_ALLOWED_CLASSES:
  barchart, bar, bl, bt, bf, bv

No new tags required (div and span are already in v1).
No new data-* attributes required (widths are never stored).
```

Cross-check against the three contract rules:
- ✅ No inline `style` on stored HTML (widths are JS-only at render time)
- ✅ No `<svg>`, no `<script>` (fill is a `<span class="bf">`)
- ✅ No new `on*` handlers, `javascript:` URLs, or `data:` URLs
- ✅ New classes are purely presentational — no class leaks semantic authority

After Opus approves, Codex adds these 6 class strings to `ARTIFACT_HTML_ALLOWED_CLASSES` in
`artifact-html.ts`, and updates `docs/ARTIFACT_HTML_CONTRACT.md` to move BarChart from the
"Deferred to v2" section into the main v1 block list.

---

## What's out of scope for the v1/v2 contract

These patterns appear in prototype reference files but are **not** in the allowlist and should
not be emitted by the converter:

- `qq`, `qn`, `qt` — qualifying-question rows (BattlecardDoc prototype only). Add as a
  future allowlist extension if needed; do not invent now.
- `dp-pad` — prototype layout wrapper with inline `paddingTop`. Not needed in stored HTML;
  section padding is already handled by `.sec`.
- `badge`, `badge neutral` — unstyled badge classes from prototype. Not in the contract.
- Inline `color` on any element — all colour variants are class-based.
- `<svg>` icons — all icons are CSS `::before` content or CSS `content: attr(...)`.
