# Front of House

The Documents area is the project's audience-facing layer: the place where GTM, sales, CS, execs, and product open, browse, and present finished material. Everything behind it (evidence, topics, themes, problems, opportunities) is back of house: the kitchen that informs every document served out front.

## The vision (Jimmy, 2026-07-08)

- An artifact front that looks exceptional: executive reviews, GTM material, sales enablement, PRDs, presentations, one-pagers, all organized by the audience they serve.
- Present directly from the app: open a document and present it, full screen.
- Tables, analysis, and charts inside documents.
- Living and breathing without burning tokens: browsing, organizing, and presenting cost zero LLM spend; generation is the only paid act.
- Potentially role-specific visibility (sales sees sales, product sees product).
- Prototypes stored alongside documents, generated off the evidence.
- Back of house stays the domain of research-proficient users; front of house is for everyone else.

## V1 (branch `feat/front-of-house`, shipped in this cut)

1. **Audience lanes.** Documents grouped by who they serve: Executive, Go-to-market, Sales, Product, Research, Library. V1 derives the lane from the existing artifact `type` (`src/lib/artifacts/audience.ts`), so there is NO schema change and legacy artifacts lane correctly.
2. **The spine.** A pinned hero row of the project's best-grounded documents (verified first, then citation depth), with one-click Open and Present.
3. **Audience lens.** Chips to view the front as a single audience sees it: the display-only precursor to role-based visibility.
4. **The kit as ghost cards.** Empty lanes show what that audience expects (battlecard, PRD, exec review) with a compose CTA: the #84 Slice 2 kit concept, display-only.
5. **Present mode.** Any document presents full screen: chrome hidden, large type, section-by-section navigation via arrow keys or the HUD, entered from the reader toolbar or directly via `?present=1` links from the front. Pure CSS/DOM: zero tokens.
6. Search, grounding chips, freshness chips: reused from the existing library (#84 Slice 1).

## V1.1 (2026-07-08, same branch)

- **Present is now a real 16:9 deck.** Synthetic title slide (title, type, "Backed by N customer conversations", date), then one slide per h2 section on a fixed 16:9 stage with deck styling. Slide engine is pure DOM/CSS: blocks are assigned to their section's slide and only the active slide renders. Zero tokens to present.
- **Calm cards.** Design principle: **one trust sentence per card, plain English, positive-only.** "Backed by 4 customer conversations" / "Verified against the evidence" / "Working draft", plus a plain-words freshness line when new conversations arrived since writing. Citation counts, verification detail, and provenance stay one click away in the reader. Cards give confidence; the reader gives the science. Removed: prompt snippets, "Unverified", citation-count chips, badge clutter.

## Phases behind V1 (each gated, in order)

- **P2: explicit audience + role visibility.** `audience` column on artifacts (migration, gated) with the type-mapping as fallback; org roles decide which lanes a member sees. Needs the roles model conversation.
- **P3: presentation polish.** Speaker notes from the artifact's structure trace, per-slide evidence footnotes, a "present from spine" project briefing mode.
- **P4: tables, charts, analysis blocks.** Extend compose + sanitizer to emit safe `<table>` and chart blocks (chart data derived from evidence counts/heatmaps, rendered client-side, no tokens to view). Sanitizer allowlist change is security-review-gated.
- **P5: prototypes, in three deliberate steps.**
  1. **Prototype brief (generation, cheap, now-able):** a new artifact kind whose output is a build-ready prompt pack for v0/Lovable/Bolt/Figma Make: the problem, the affected users, the cited evidence, the acceptance notes. DiscOS's unique value is the GROUNDING, not the code generation; let the specialist tools build.
  2. **Prototype links as first-class artifacts (no migration):** store the resulting prototype URL + screenshot in `artifacts.metadata`, laned under Product, traced to the problems that motivated it (ties to #80). Rendered as link-out cards with thumbnails. NO third-party embeds at this step.
  3. **Sandboxed embeds (security-gated):** live prototype iframes only behind a strict host allowlist (v0.app, vercel.app, figma.com), `sandbox` attribute, no credentials, CSP reviewed. An unrestricted iframe of arbitrary URLs inside an authenticated app is an XSS/clickjacking gift; this step ships only after security review.
  - **Explicitly rejected:** DiscOS generating and hosting runnable prototype code itself. Huge new spend surface, quality risk, and it competes with tools that do it better; our moat is that the prototype is ARGUED FROM EVIDENCE, not that we rendered it.
- **P6: freshness engine.** "New conversations since written" is now on cards; add one-click regenerate with cost shown before confirm (#74 + #76 envelope).

## Principles

- Browsing, presenting, and organizing are free; only generation spends. Keep it that way.
- The front never shows a claim the back cannot defend: grounding chips stay on every card.
- Navigation label stays "Documents" for now; the page brands itself Front of house. Rename only if users adopt the language.
