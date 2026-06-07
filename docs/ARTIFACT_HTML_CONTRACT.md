# Artifact HTML Contract (v1)

**Owner:** Opus 4.8 (PM / security reviewer) · **Status:** ✅ **v1 LOCKED — 2026-06-06** (resolutions at bottom). Build to this; changing the allowlist requires an Opus note.
**Consumed by:** `#14` (Codex-Backend, in `OPUS_CODEX_CHANNEL.md` — compose output + sanitiser + viewer) AND the design rebrand Phase 3 (Sonnet — `doc.css`/`doc_kit.css`).

> This is the **shared interface** between the AI that *generates* documents and the
> CSS that *styles* them. Both sides build to this exact list. The sanitiser
> enforces it as its allowlist. Prototype reference for class names + visuals:
> `New DiscOS app design/doc_kit.jsx` + `doc_kit.css`.

---

## Three rules that define the whole contract

1. **Stored artifact HTML is semantic tags + a fixed allowlist of `class` values + a tiny set of `data-` attributes. Nothing else.**
2. **No inline `style`. No `<svg>`. No `<script>/<iframe>/<object>/<form>/<input>`. No `on*` handlers. No `javascript:`/`data:` URLs.**
   - Variants (callout kind, stat colour, grid columns) are expressed as **allowlisted classes**, not inline styles → so the sanitiser never has to allow the `style` attribute (a major XSS-surface reduction).
   - Icons and colours are added at **render time by CSS keyed to the class** (Sonnet's doc-kit) — the LLM never emits an SVG.
3. **Citations are first-class HTML, not text.** `[N]` markers become `<cite data-n="N">N</cite>`. Traceability is the product — the backfill must preserve every existing citation.

---

## v1 block allowlist

For each block: the **stored HTML shape** (what Claude emits + what the sanitiser permits) and notes. Class names follow the prototype.

### Structure
```html
<!-- Hero: document title block -->
<header class="dp-hero">
  <span class="kicker">COMPETITIVE INTELLIGENCE</span>
  <h1>Acme vs. Veyor — Battlecard</h1>
  <p class="lede">One-paragraph framing.</p>
  <div class="dp-meta">
    <span class="who">Olivia Bennett</span>
    <span class="dot"></span><span>6 Jun 2026</span>
    <span class="dot"></span><span>4 min read</span>
  </div>
</header>

<!-- Section: H2 + TOC anchor -->
<section class="sec" id="sec-the-problem">
  <h2 class="dp-h2" data-section="The problem"><span class="dp-num">01</span>The problem</h2>
  ...
</section>

<p class="lede">…</p>          <!-- Lede -->
<h3 class="dp-h3">…</h3>        <!-- H3 -->
```
- `Hero` author avatar in the prototype is an inline-styled gradient circle → **render-time only** (CSS/initials), not stored.
- `id` on `<section>` is allowlisted (slug form only: `[a-z0-9-]`). `data-section` allowlisted (TOC label).
- `dp-num` content limited to digits.

### Evidence / traceability
```html
<cite data-n="3">3</cite>                         <!-- inline citation chip -->
<span class="ev" data-n="2">2 sources</span>      <!-- "N sources" badge -->
```
- `data-n` allowlisted, **integer only**. Render binds the popover to these (per #14 brief, `citation_map` in `artifact.metadata` stays as-is).

### Rich blocks
```html
<!-- PullQuote -->
<blockquote class="pq">
  <p class="pq-text">"We lose two days every time a submittal bounces."</p>
  <p class="pq-cite"><b>Dana Reed</b> · Project Lead, Northgate</p>
</blockquote>

<!-- Callout: kind ∈ {info, warn, pos, neg} expressed as class -->
<div class="callout warn"><div class="ct">Validate before the next sprint.</div></div>

<!-- Takeaway -->
<div class="takeaway"><span class="tk-label">Key takeaway</span><p>…</p></div>

<!-- StatGrid: column count + cell tone as classes (NOT inline style) -->
<div class="stat-grid cols-3">
  <div class="stat-cell"><div class="n pos">47</div><div class="l">trusted claims</div></div>
  ...
</div>

<!-- List: tone ∈ {pos,neg,info,warn}, icon implied by class -->
<ul class="dp-list pos"><li>…</li></ul>

<!-- DataTable -->
<table class="dp-table">
  <thead><tr><th>Capability</th><th>Acme</th><th>Veyor</th></tr></thead>
  <tbody><tr><td>…</td><td>…</td><td>…</td></tr></tbody>
</table>

<!-- Flow: horizontal numbered steps; optional "pain" tone per step -->
<ol class="flow">
  <li class="flow-step"><span class="fs-n">01</span><span class="fs-t">Submit</span><span class="fs-d">PM uploads package.</span></li>
  <li class="flow-step pain"><span class="fs-n">02</span><span class="fs-t">Bounce</span><span class="fs-d">Reviewer rejects; two days lost.</span></li>
</ol>

<!-- Split: two-column layout wrapper (direct children are the two columns) -->
<div class="dp-split"><div>…left…</div><div>…right…</div></div>
```

### Allowlisted classes (the complete set for v1)
`dp-hero, kicker, lede, dp-meta, who, dot, sec, dp-h2, dp-num, dp-h3, ev,
pq, pq-text, pq-cite, callout, info, warn, pos, neg, ct, takeaway, tk-label,
stat-grid, cols-2, cols-3, cols-4, stat-cell, n, l, dp-list, dp-table,
flow, flow-step, pain, fs-n, fs-t, fs-d, dp-split`

### Allowlisted tags
`h1, h2, h3, h4, p, span, div, section, header, ul, ol, li, blockquote,
strong, em, b, a, cite, br, hr, table, thead, tbody, tr, th, td, code, pre`

### Allowlisted attributes
- `a[href]` — `http`/`https`/`mailto` only
- `[class]` — values restricted to the allowlist above
- `section[id]` — slug form only
- `h2[data-section]` — text label
- `cite[data-n]`, `span.ev[data-n]` — integer only

**Everything else is stripped on the way into storage and again at render.**

---

## Deferred to v2 (NOT in the v1 allowlist)
- **BarChart** — JS-animated; cannot be plain stored HTML. If promoted, it stores as
  `<div class="barchart"><div class="bar" data-value="42" data-label="…"></div>…</div>`
  and a **client component** hydrates/animates it (values via `data-*`, never inline style).
  This is the one block that is *not* a security concern but *is* an architectural exception
  to "stored HTML renders directly" — flagged so it's a deliberate choice, not an accident.

(Flow and Split are now in the v1 allowlist above — Jimmy, 2026-06-06.)

---

## Resolutions — v1 LOCKED (2026-06-06)

The five open questions are resolved. Codex reviewed the contract in `OPUS_CODEX_CHANNEL.md` and agreed the core; Opus verified the runtime-dependent answer (Q2) against the codebase. **#14 is built by Codex-Backend (coordination in `OPUS_CODEX_CHANNEL.md`); the sanitiser + migration remain gated to Opus's independent review before commit (per `AGENTS.md`).**

1. **Class-based variants, zero inline `style`, no inline SVG — LOCKED yes.** No v1 block needs inline style. StatGrid column counts are covered by `cols-2/3/4`; if a future layout needs another count, **add `cols-N` to the allowlist — never open the `style` attribute.** Icons/colours come from CSS keyed to the class (Sonnet's doc-kit). The one block that carries data is BarChart (deferred), and it uses `data-*`, not inline style.

2. **Sanitiser library — `sanitize-html` (Node). LOCKED.** Verified: there is **no `export const runtime = "edge"`** anywhere in `src`, so all store/render paths run on the Node runtime. `sanitize-html` is Node-native, lighter than DOMPurify+jsdom (no DOM emulation dependency), and sufficient for an allowlist filter. **Runs server-side on store AND on render** (defence in depth — pre-contract rows must be sanitised on the way out too). Not yet in `package.json` — the build agent adds it.

3. **Migration — staged add → backfill → cut-over → deprecate → drop. LOCKED.** Add a new `content_html` column; backfill it from `content_md`; switch reads to `content_html`; keep `content_md` for a deprecation window; drop it only in a later migration once nothing reads it. **No in-place rename** (irreversible, no rollback, breaks in-flight reads). This is gated migration SQL → Opus reviews the diff, **Jimmy runs it in Supabase**, neither AI applies it.

4. **Citation backfill — `[N]` → `<cite data-n="N">N</cite>`, `citation_map` untouched. LOCKED.** The `data-n` integer is the same `N` key already in `artifact.metadata.citation_map`, so the binding is preserved by construction. The backfill must be **idempotent** and **count-verified**: assert `count(citations in) == count(<cite> out)` per artifact, and fail loudly on any artifact where they differ rather than silently dropping a citation. Traceability is the product — no marker may be lost.

5. **Compose quality — acceptable, minor tension only. LOCKED.** The block set (hero, section, lede, h3, pull-quote, callout×4, takeaway, stat-grid, list, table, flow, split, cite/ev) covers the document shapes we compose today. The only constraint bites at exotic bespoke layouts — which we deliberately **defer rather than open inline style for**. The XSS-surface reduction is worth the small expressive limit. If the build agent hits a real compose case the allowlist can't express, raise it as an allowlist addition (a new class), not an inline-style exception.

> **Change control:** this allowlist is the sanitiser's enforcement list and Sonnet's CSS target simultaneously. Adding/removing a class or attribute is a coordinated change — note it here, ping the security channel (sanitiser impact), and tell Sonnet (CSS impact). Don't drift the two sides apart.
