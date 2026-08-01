# DiscOS AI Data Handling

**Status:** Customer disclosure draft. Opus accuracy review is required before external use.  
**Last verified:** 1 August 2026  
**Scope:** Content sent by DiscOS to Anthropic and OpenAI APIs. This is not a complete privacy notice or infrastructure subprocessor inventory.

## Plain-language summary

DiscOS stores research sources and derived records in its application database. It sends bounded portions of that content to configured AI providers to identify speakers, extract evidence, analyse research, answer questions, and generate outputs.

Most analysis after ingest uses redacted transcript segments, evidence records, or derived research objects. One important exception exists: the pre-ingest speaker-identification pass sends a bounded sample of the original transcript text, up to 12,000 characters, to the configured cheap-tier provider before segment redaction has run.

DiscOS uses deterministic pattern replacement for common emails, phone numbers, national insurance numbers, payment-card-like numbers, and credential-bearing URLs. This is a risk-reduction measure, not comprehensive anonymisation. Names, organisations, roles, locations, and context can still identify a person.

## Provider routing

Text-generation routes are configurable by an authorised DiscOS super administrator. The active provider and model for each tier can therefore differ from the recommended routes below. If no database or environment routing exists, the source-code fallback routes all four text tiers through Anthropic: Haiku for Cheap and Sonnet for Standard, Premium, and Eval.

| Tier | Recommended route | Typical purpose |
| --- | --- | --- |
| Cheap | Anthropic Claude Haiku 4.5 | Speaker detection, grading, action extraction |
| Standard | Anthropic Claude Sonnet 4.6 | Evidence extraction, Ask, entities, summaries |
| Premium | Anthropic Claude Sonnet 4.6 | Themes, problems, opportunities, composed artifacts |
| Eval | OpenAI GPT-5.4 | Claim verification |
| Embeddings | OpenAI text-embedding-3-small | Semantic retrieval vectors |

Environment variables and the platform AI settings can override text-generation model IDs and route any text tier to Anthropic or OpenAI. Embeddings always use OpenAI `text-embedding-3-small` and are capped at 8,000 characters per input. The active production route must therefore be confirmed from the super-admin AI settings, not inferred from this table.

## AI processing inventory

The table below identifies every current code path that sends customer-derived content to an AI provider. “Redacted” means DiscOS applies its deterministic pattern replacement before that stage. “Derived” means the payload is built from records previously produced from customer content.

| Operation | Content sent | Protection and bound | Tier |
| --- | --- | --- | --- |
| Pre-ingest speaker scan | Original transcript sample, detected labels, and transcript legend | Raw text; maximum 12,000 characters; maximum 900 output tokens | Cheap |
| Evidence extraction | Redacted conversation units and extraction instructions | Redacted segment text; batched and token-capped | Configured ingest tier, normally Standard |
| Entity extraction | Evidence content and project frame | Derived evidence; bounded output | Standard |
| Evidence grading | Evidence content, classification, and project research context | Derived evidence; batches with smaller retries | Cheap |
| Semantic retrieval | Search query and evidence text used to create vectors | Up to 8,000 characters per input | OpenAI embeddings |
| Ask | User question, project frame, corpus facts, structural context, and retrieved evidence | Bounded retrieval set; streamed response | Standard |
| Project synthesis | Evidence batches and existing theme summaries | Derived research records; batched | Premium |
| Problem discovery | Themes, linked evidence, topics, and project frame | Derived research records; batched | Premium |
| Opportunity generation | Problems, themes, linked evidence, and project frame | Derived research records; batched | Premium |
| Compose | User instruction, project graph, and selected citeable evidence | Derived records; bounded evidence selection | Premium |
| Claim verification | Artifact claim and evidence pool | Derived artifact and evidence text | Eval |
| Session review | Source title/type and linked evidence | Derived evidence | Standard |
| Action extraction | Source title/type and linked evidence | Derived evidence | Cheap |
| Frame drafting and settings suggestions | Project name/settings plus evidence, themes, problems, and entities | Derived records | Standard |
| Gap detection | Project frame and theme summaries | Derived records | Standard |
| Outcome assessment | Compact project-state summary, including top problems, themes, opportunities, and prior gaps | Derived summary; maximum 1,800 output tokens | Standard |
| Person, company, and competitor digests | Entity metadata, project names, and linked evidence | Derived evidence | Standard |

DiscOS does not intentionally put prompt text or model output into its LLM cost-event records. Those records contain identifiers, provider/model/tier, token counts, cache counts, estimated cost, and timestamps.

## Published provider posture

The statements in this section describe the providers' published commercial API posture as of the verification date. Provider terms and controls can change. Account configuration must be checked before presenting an optional control as enabled for DiscOS.

### Anthropic API

- **Training:** Anthropic states that it does not use commercial API chats or coding sessions to train its models unless the customer explicitly opts into a programme or submits feedback. [Anthropic model-training policy](https://privacy.claude.com/en/articles/7996885-how-do-you-use-personal-data-in-model-training)
- **Default retention:** Anthropic states that API inputs and outputs are automatically deleted from its backend within 30 days by default, subject to stated exceptions including policy enforcement, legal obligations, longer-retention services, and separately agreed controls. Content flagged for usage-policy enforcement can be retained longer. [Anthropic retention policy](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data)
- **Zero data retention:** ZDR is not a default. Anthropic states that it requires approval and an organisation-level agreement, applies only to eligible APIs/products, and can retain safety-classifier results. Covered models may have separate retention requirements. [Anthropic ZDR scope](https://privacy.claude.com/en/articles/8956058-i-have-a-zero-data-retention-agreement-with-anthropic-what-products-does-it-apply-to)
- **DPA:** Anthropic states that its DPA, including Standard Contractual Clauses, is incorporated into its Commercial Terms. [Anthropic DPA guidance](https://privacy.claude.com/en/articles/7996862-how-do-i-view-and-sign-your-data-processing-addendum-dpa)
- **Location and subprocessors:** Anthropic states that traffic may be routed through countries in the US, Europe, Asia, and Australia by default, and that data is stored in the US unless otherwise agreed or configured. [Anthropic processing-location statement](https://privacy.claude.com/en/articles/7996890-where-are-your-servers-located-do-you-host-your-models-on-eu-servers) The current subprocessor list is available through the [Anthropic Trust Center](https://trust.anthropic.com/).

### OpenAI API and embeddings

- **Training:** OpenAI states that API data is not used to train or improve its models unless the customer explicitly opts in. [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data)
- **Default retention:** OpenAI states that abuse-monitoring logs may include prompts and responses and are retained for up to 30 days by default, subject to stated legal and safety exceptions. Its published endpoint table lists `/v1/chat/completions` and `/v1/embeddings` as having no application-state retention by default, apart from documented exceptions. [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data)
- **Prompt caching:** OpenAI states that prompt caching can store encrypted key/value tensors in GPU-local storage for up to 24 hours. This is provider application state rather than readable prompt text, but it is still an account and endpoint consideration. [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data)
- **Zero data retention:** OpenAI states that ZDR is subject to approval and additional requirements. Its published table lists chat completions and embeddings as eligible, subject to documented limits. [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data)
- **DPA and subprocessors:** OpenAI publishes a [Data Processing Addendum](https://cdn.openai.com/pdf/openai-data-processing-addendum.pdf) and a current [subprocessor list](https://openai.com/policies/sub-processor-list/).
- **Residency:** OpenAI states that data residency is an eligible, per-project configuration. Non-US regions require approval for abuse-monitoring controls and a retention amendment, and regional storage does not imply all system data remains in-region. [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data#data-residency-controls)

## Account-specific checks before customer use

These are deployment facts, not source-code facts. Jimmy must verify each item in the relevant provider console or signed agreement.

### Anthropic

- [ ] Confirm the production API key belongs to the intended commercial organisation and workspace.
- [ ] Record the workspace's active data-retention setting.
- [ ] Confirm whether a ZDR agreement is approved and active. Do not claim ZDR until verified.
- [ ] Confirm whether the current model routes include a provider-designated covered model with different retention requirements.
- [ ] Confirm the Commercial Terms and incorporated DPA are accepted for the production organisation.
- [ ] Confirm whether traffic routing or data-location controls are configured. Do not claim EU-only storage or processing until verified.
- [ ] Subscribe to or periodically review Anthropic's subprocessor updates.

### OpenAI

- [ ] Confirm the production API key belongs to the intended API organisation and project.
- [ ] Confirm model-training data sharing is not enabled.
- [ ] Record the organisation/project data-retention setting.
- [ ] Confirm whether ZDR or Modified Abuse Monitoring is approved and active. Do not claim ZDR until verified.
- [ ] Confirm the OpenAI DPA is executed or incorporated for the production account as required.
- [ ] Confirm whether a regional API project and regional endpoint are configured. Do not claim EU residency until verified.
- [ ] Subscribe to or periodically review OpenAI's subprocessor updates.

### DiscOS configuration

- [ ] Export or screenshot the active provider/model route for all four tiers from the super-admin AI settings.
- [ ] Confirm production environment keys do not point to personal or test provider accounts.
- [ ] Recheck this document whenever provider routes, models, caching behaviour, or AI processing paths change.

## Known limitations and deferred work

- The current PII helper is pattern-based. It does not guarantee removal of names, organisations, locations, free-form identifiers, or re-identifying context.
- The pre-ingest speaker scan processes a bounded raw-text sample before redaction. It exists to let users review speaker roles before evidence extraction.
- Pseudonymisation, tenant-specific AI-processing controls, and redaction of the pre-ingest speaker sample are explicitly deferred from issue #146's disclosure slice.
- This document is an engineering disclosure and must not be presented as legal advice, a signed DPA, a security certification, or proof that an optional provider control is enabled.
