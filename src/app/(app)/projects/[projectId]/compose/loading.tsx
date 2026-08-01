// Instant skeleton shown while the server fetch resolves (App Router loading.tsx).
// Matches compose/page.tsx chrome: max-w-6xl studio header + ComposeEditor's form card.
export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl motion-safe:animate-pulse">
      {/* Studio chrome header */}
      <div className="mb-6 flex items-center gap-2.5 border-b border-[var(--line)] pb-4">
        <div className="h-3 w-24 rounded bg-[var(--surface-2)]" />
        <div className="h-3 w-1 rounded bg-[var(--line)]" />
        <div className="h-3 w-20 rounded bg-[var(--surface-2)] opacity-60" />
        <div className="flex-1" />
        <div className="h-3 w-16 rounded bg-[var(--surface-2)]" />
      </div>

      {/* Draft prompt form card */}
      <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)]">
        <div className="border-b border-[var(--line)] px-5 py-4">
          <div className="mb-2 h-4 w-28 rounded bg-[var(--surface-2)]" />
          <div className="h-3 w-72 max-w-full rounded bg-[var(--surface-2)] opacity-60" />
        </div>
        <div className="p-5">
          <div className="mb-2 h-3.5 w-14 rounded bg-[var(--surface-2)]" />
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="h-9 flex-1 rounded-lg bg-[var(--surface-2)]" />
            <div className="h-9 w-20 rounded-lg bg-[var(--surface-2)]" />
          </div>
        </div>
      </div>

      {/* Empty draft state placeholder */}
      <div className="mt-6 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-10 text-center">
        <div className="mx-auto mb-2 h-3.5 w-36 rounded bg-[var(--surface-2)]" />
        <div className="mx-auto h-3 w-64 max-w-full rounded bg-[var(--surface-2)] opacity-50" />
      </div>
    </div>
  );
}
