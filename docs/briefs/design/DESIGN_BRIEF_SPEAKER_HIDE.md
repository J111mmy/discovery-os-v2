# DESIGN BRIEF — Hide internal speakers in Evidence (Cut #2, fix A)

**Author:** Opus (PM). **Implementer:** Sonnet (design-lane). **Reviewer:** Opus (eyeball before promotion).
**Branch:** `feat/cut-2`. **Status:** design-lane — commit on branch per normal rules; not gated.

---

## Goal

Internal speakers (Jimmy, Aiden, etc.) are showing up as evidence. Hide
internal-speaker evidence **by default** in the Evidence browser, with a toggle
to reveal it. This is a deliberate **interim, client-side** fix — fast and fully
reversible. The durable, exact, server-side version is **fix B** (a later cut);
do not try to build B here.

## Why interim / what we are NOT doing

`segment_speaker` (`EvidenceRecord.segment_speaker`) is **free text** from
`source_segments.speaker`. `people.affiliation` (`internal|external|unknown`) is
set at the org level, but there is **no FK** linking a segment's speaker to a
person (that's fix E). So we match by **name string** and filter on the client.
Counts/pagination stay server-driven and unfiltered; this is a **visual** filter
on loaded records. That's acceptable for the interim. **Do not** modify
`actions.ts`, `lib/query/evidence.ts`, the `match_evidence` RPC, or counts logic.

## Scope

### 1. Pass internal-speaker names from the server (1 query)

File: `src/app/(app)/projects/[projectId]/evidence/page.tsx` (server component;
`project.org_id` is in scope).

Add a query:
```ts
const { data: internalPeople } = await supabase
  .from("people")
  .select("display_name")
  .eq("org_id", project.org_id)
  .eq("affiliation", "internal");
const internalSpeakerNames = (internalPeople ?? [])
  .map((p) => (p.display_name ?? "").trim().toLowerCase())
  .filter(Boolean);
```
Pass `internalSpeakerNames={internalSpeakerNames}` into `<EvidenceBrowser />`.

### 2. Filter + toggle in the browser

File: `src/app/(app)/projects/[projectId]/evidence/evidence-browser.tsx`.

- Add prop `internalSpeakerNames: string[]`; build a `Set` of them.
- `isInternal(record)` = `record.segment_speaker` present and its
  `.trim().toLowerCase()` is in the set.
- Add state `showInternal` (default `false`).
- When `showInternal` is false, filter internal records out of what's rendered
  (apply to the `records` array before the map at ~line 593, across all buckets
  and search results).
- Add a **"Show internal speakers"** toggle in the header row near the search
  input (~lines 507–526). Small, consistent with existing controls.
- When internal rows are shown, tag them: add an **"Internal"** chip next to the
  `segment_speaker` line (~lines 176–178) so they're visually distinct.
- Update the count line (~lines 528–534): when hiding, append
  `" · N internal hidden"` where N = internal records hidden in the currently
  loaded set. Keep "Showing X of Y" as-is otherwise.

## Constraints (design-lane invariants)

- No new endpoint, no new `dangerouslySetInnerHTML`, no `createServiceClient`,
  no auth/middleware/RLS touch. The only server edit is the read-only `people`
  query above.
- Don't change how evidence is fetched, counted, or paginated.
- Match the existing visual system (CSS vars, chip styles already in the file).

## Acceptance

- Default Evidence view hides internal-speaker records; "N internal hidden"
  shows when any are filtered.
- Toggle reveals them with an "Internal" chip.
- No console errors; build green (Node 22, `npm run build`).
- Note in the PR/commit body: "interim client-side hide; exactness comes with
  fix B."
