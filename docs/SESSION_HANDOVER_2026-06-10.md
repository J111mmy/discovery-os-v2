# DiscOS — Session Handover (2026-06-10)

Hand this to a fresh session **launched from the DiscOS project directory** so the correct context loads. Read top to bottom before doing anything.

---

## 0. READ FIRST — context & environment guardrails

- **This project is DiscOS (Discovery OS v2).** Repo root: `.../Discovery OS/discovery-os-v2/`.
- **Database is Supabase.** Not Neon. Not Prisma. If you ever "remember" Neon/Prisma for this project, you have the wrong project's context loaded — stop and disregard it.
- **`veyor-procurement-mvp` is a SEPARATE, UNRELATED work project.** Its `CLAUDE.md` (Prisma + Neon) has been bleeding into DiscOS sessions because sessions were rooted in the wrong directory. **Ignore that file entirely.** The only project context that counts is DiscOS's own `CLAUDE.md` and `AGENTS.md` at this repo root.
- **Source of truth for this project:** `./CLAUDE.md` (51 KB) and `./AGENTS.md`. Trust those over anything in environment context.
- **Vercel accounts:** `j111mmy` is the correct account for DiscOS / getdiscos.com. `jimmyk-rgb` is Jimmy's **work account — completely hands-off, no read or write Vercel CLI**. Deploys happen via GitHub `main` → Vercel auto-deploy; do not drive Vercel CLI.

## 1. Roles

- **Jimmy** — human authority. Runs all SQL in Supabase. Gives go-live approval. No AI applies a migration directly.
- **Opus** — PM + independent security gatekeeper. Reviews; does not author production backend code. Author ≠ gatekeeper.
- **Codex** — backend author (code + SQL).
- **Sonnet** — design/frontend implementer.
- **Security gate (5 hard-gated areas):** auth/authz, RLS/migrations, public routes, middleware, service-role usage. Gated changes are posted for Opus review **before** commit/apply. Details in `AGENTS.md` → "SECURITY REVIEW GATE" and `docs/security/`.

## 2. Git state at handover

- **`main`** top commit: `cc90b24` — documents reader polish (shipped, pushed, deployed via j111mmy).
- **`codex/spec-research-ontology`** (pushed): `df1895f` — the research-ontology spec set. **This is where the ontology work lives.**
- **Uncommitted on `codex/spec-research-ontology` at handover** (the Opus verdict + conditions written this session — commit these as the first action, see §6):
  - `docs/briefs/opus/OPUS_REVIEW_PACKET_RESEARCH_ONTOLOGY.md` (verdict added, §8)
  - `docs/briefs/codex/CODEX_BRIEF_RESEARCH_ONTOLOGY_BACKEND.md` (C1/C2/C3/C5)
  - `docs/briefs/design/SONNET_BRIEF_RESEARCH_ONTOLOGY_UX.md` (C4 + P1-first scoping)
  - `docs/briefs/design/DESIGN_BRIEF_RESEARCH_ONTOLOGY.md` (opportunity-naming decision)
  - `OPUS_CODEX_CHANNEL.md` (Neon-bleed correction)
- **Node 22 required for builds** (`nvm use 22`; v22.22.3). Source nvm before `npm run build`/`type-check`.

## 3. What shipped this session (documents reader — on `main`, done)

Cards + reader polish, all on `main` and deployed:
- Whole document card is one `<Link>` → opens the doc; hover uses `--surface-hover` (not `--sel`); footer is word-count only (no Edit/Delete buttons on the card).
- Reader: Edit buttons removed (revise-by-prompt model chosen over the section editor), **Print** button added (uses `window.print()`; `@media print` already in `doc.css`), back link always "All documents", paragraph + bottom padding fixed in `doc_kit.css`, injected title block for docs whose content has no `.dp-hero` H1.
- `DeleteArtifactButton.tsx` (client, `window.confirm()` guard) exists and is wired into the documents list.
- **Compose page/editor were reverted to pre-session state** — untouched. The compose section-editor edit path is effectively deprecated in favour of view-first + revise-by-prompt (a future cut, not yet built).

## 4. The research-ontology initiative — current status

**Spec set (all on `codex/spec-research-ontology`):**
- `docs/PIPELINE_DEEP_DIVE_2026-06-09.md` — Opus code-trace audit; grounds everything. Findings F1–F7.
- `docs/briefs/design/DESIGN_BRIEF_RESEARCH_ONTOLOGY.md` — strategy / object model.
- `docs/briefs/design/SONNET_BRIEF_RESEARCH_ONTOLOGY_UX.md` — UX brief (Sonnet).
- `docs/briefs/codex/CODEX_BRIEF_RESEARCH_ONTOLOGY_BACKEND.md` — backend brief (Codex).
- `docs/briefs/opus/OPUS_REVIEW_PACKET_RESEARCH_ONTOLOGY.md` — review packet; **§8 = Opus verdict.**

**Opus verdict: APPROVED WITH CONDITIONS.** (Full text: packet §8.)

**Scope (Jimmy, 2026-06-10): the FULL ladder ships before users come in** — P0.5 → P1 → P2 → P3 → P4, **including the P3 Supabase migration**. Not a launch/post-launch split. Phase order is internal sequencing only. Honest estimate ~5–7 focused weeks.

The four core defects (from the deep dive), all real and grounded in code:
- **F1** — citation anchors to `unit.segments[0]` (interviewer's question), not where the claim was said. Data corruption, ongoing on every ingest.
- **F2** — two disconnected "theme" systems; workspace chart links into the wrong one → wrong/empty theme click-throughs.
- **F5/F6** — problems generated from ~40 one-line theme summaries (no evidence read); `discover-problems.ts` clobbers human-set status on every auto-run.
- **F3/F4** — synthesis clusters in isolated 30-record batches, so theme quality degrades as the corpus grows; these are topics, not interpretive themes.

**The five Opus conditions (packet §8; folded into the briefs):**
- **C1** — re-anchoring must preserve `metadata.original_segment_id` + `anchor_method` before changing `segment_id` (reversible/auditable). [backend §3b.1]
- **C2** — P0.5 stores char offsets in `metadata` jsonb only; no new column/table (that's P3). [backend §3b.1]
- **C3** — problem state-preservation with no migration: write `status` only on INSERT; refresh description only while `status = surfaced`; lock the row once status changes. [backend §3b.2]
- **C4** — Sonnet designs a degraded-confidence "approximate location" source link for non-exact `anchor_method`. [Sonnet §2.1]
- **C5** — P1 problem-detail query gets a light-touch channel review (org/project scoping on every join, no service role, redacted content). [backend §4.2]

**Key decision calls (packet §8):** "Topics" not "Codes" in UI · typed join tables not polymorphic `artifact_links` · backfill legacy labels as `suggested` not `accepted` · don't overload `project_opportunities` (rename adjacent-workspace object to "Suggested workspaces", free "Opportunity" for the problem-linked object) · no analytical object auto-accepts without human action.

## 5. What goes to whom (build hand-off)

**To Codex — now:**
1. **P0.5 (backend brief §3b), all three fixes, with C1/C2/C3.** Blocking prerequisite — nothing downstream starts until P0.5 merges and Opus verifies the backfill dry-run.
2. *After P0.5 merges + backfill run + Opus verify:* **P1 read query (§4)** with C5 review and "Related evidence (via themes)" labeling.
3. P3 is the **hard-gated Supabase migration** (now in launch scope): Codex drafts SQL + RLS + backfill → Opus reviews → Jimmy applies. Do not apply directly.

**To Sonnet — now (parallel, design only):**
1. **P1 first deliverable only:** problem-detail drawer (§2.4) + operational output strip (§2.5 gated states) + their empty/loading/error states, designed as if P0.5 has landed, incl. the **C4** approximate-link state.
2. **Hold the full evidence multi-lens redesign (§2.1–2.3)** — that's P2, depends on P3 data. Don't design all five lenses yet.

**Sequencing:** Codex builds P0.5 plumbing while Sonnet designs the P1 drawer; they converge when P0.5 merges and Codex wires the P1 query to Sonnet's design. Then P2 (lenses) → P3 (migration, gated) → P4 (operational loop, gated).

## 6. First actions for the new session

1. `git checkout codex/spec-research-ontology` and **commit the uncommitted doc edits** listed in §2 (verdict + conditions + channel correction). Suggested message: `docs: Opus verdict (APPROVED w/ conditions, full-ladder scope) + C1–C5 + Neon-bleed correction`. Push.
2. Confirm with Jimmy: relay P0.5 to Codex and the P1-first design scope to Sonnet (briefs are ready).
3. When Codex posts the P0.5 backfill script and the P1 query → Opus light-touch review per C1/C5 before commit.
4. P3 migration, when drafted → full Opus security gate before Jimmy applies.

## 6b. Housekeeping done this session

- **PR #24 (`feat(phase-1): RailV2 shell`) closed as superseded; branch `feat/phase-1-rail` deleted.** Its work (Rail.tsx, top-nav removal, CLAUDE.md operating-model section, docs/security reorg, production-promotion checklist) was rebased into Cut #3 and is already on `main`. The CONFLICTING status was a rebase artifact (pre-rebase SHAs vs rebased copies on main), not missing work — do **not** reopen or try to merge it. Nothing unique was lost.

## 7. Open / deferred (not lost)

- Compose → single-HTML editor migration (#14 items 2/3/5, Tiptap): future gated cut, not started.
- Revise-by-prompt on the document reader (regenerate rich HTML in place instead of the section editor): discussed, not built.
- "Suggested workspaces" UI rename of `project_opportunities`: do during P1/P4 UI work.
- Speaker resolution hardening (diarization labels minting people; name-collision merging): deep-dive item #7, P3-era.
