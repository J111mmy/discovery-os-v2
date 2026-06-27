# DiscOS as a Horizontal Qualitative-Analysis Engine (with Vertical Packs)

> Status: **strategic option, parked for later.** Captured 2026-06-26 (Jimmy + Opus). Revisit by conscious decision, not now. Quality-before-billing on the current product comes first.

## The opportunity in one line

DiscOS's expensive, defensible core (traceable thematic analysis from raw transcripts: evidence to themes to problems) is domain-agnostic. The same engine that powers product discovery can power academic research, UX research, market research, and policy analysis. Verticalizing is mostly swapping the output templates and reframing the layer between problems and outputs, not rebuilding the engine.

## Why the core is universal

Thematic analysis is a domain-agnostic qualitative method. A PhD coding interviews and a PM doing customer discovery run the same fundamental loop: read the raw text, pull out meaningful source-anchored units, cluster them into themes, surface the findings and problems. DiscOS automates that loop and, crucially, keeps every step traceable back to the exact sentence a person said. That traceability is the moat, and it does not care what industry the transcripts come from.

## What is shared vs what is vertical

**Shared (the moat, built once):**
- Ingest (transcripts, PDFs, docs) to source-anchored evidence.
- Evidence to themes (thematic clustering).
- Themes to problems / findings (the synthesised landscape).
- The outcome engine mechanism (define what "done" looks like, assess current state against it, surface the gap).
- The trust layer (every claim cites its evidence).

**Vertical (the pack, swapped per industry):**
1. **The layer between problems and outputs.** In DiscOS today this is "Opportunities," meaning *product* opportunities. Academia has no product opportunity; its equivalent is "findings, contributions, implications, answers to the research questions." This sibling layer is product-framed today and needs reframing per vertical.
2. **The output artifacts (the document area).** Product wants PRDs, GTM one-pagers, sales battlecards. Academia wants a thematic-analysis writeup, a findings section, contribution statements, a coding framework. UX research wants a research report and a journey map.
3. **The outcome frame content.** Universal in mechanism, domain-specific in target: "validate willingness to pay" vs "answer RQ1 with sufficient evidence."

## Candidate verticals

- **Product discovery** (current).
- **Academic qualitative research** (interviews, grounded theory, thematic analysis).
- **UX research** (usability + discovery interviews).
- **Market research / consumer insights.**
- **Policy / public consultation analysis.**
- **Voice-of-customer / customer success.**

## What makes this credible, and how to test it cheaply

Two open, CC-licensed interview datasets are good proof points:
- **GitHub-bots developer interviews** (Zenodo 7040317): 12 verbatim PDF transcripts **plus the researchers' own codebook**. That codebook is an expert-coded ground truth. If DiscOS surfaces the same themes and problems the researchers coded by hand, that is direct proof the core travels across domains. Near-free validation of this entire thesis.
- **ADHD-in-software-engineering interviews** (Zenodo 8414120): Excel transcripts (would need converting to PDF/txt first, since Excel is not a supported ingest format), smaller public set.

## Open questions / risks

- Each vertical needs its own output pack and post-problems framing. Effort scales per vertical.
- The traceability/trust moat must hold in each domain (it should; the method is the same).
- GTM focus risk: this is a horizontal-platform temptation. Do not let it dilute the current product. It is an option to file, not a pivot.
- Which vertical first, if ever? Product is the current bet; academia is useful mainly as a *proof of universality*, not necessarily a market to chase.

## Bottom line

The analysis engine is horizontal and already built. The verticalization is real but bounded: swap the output templates, reframe "opportunities" into the domain's equivalent, and set a domain-appropriate outcome. The bots dataset gives us a way to *prove* the engine generalises before betting anything on it. File and revisit.
