// Instant skeleton shown while the server fetch resolves (App Router loading.tsx).
// Matches the ask/page.tsx chrome: max-w-6xl studio header + inner max-w-3xl form card.
export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl motion-safe:animate-pulse">
      {/* Studio chrome header */}
      <div className="mb-6 border-b border-[var(--line)] pb-4">
        <div className="mb-2.5 flex items-center gap-2">
          <div className="h-3 w-8 rounded bg-[var(--surface-2)]" />
          <div className="h-3 w-1 rounded bg-[var(--line)]" />
          <div className="h-3 w-24 rounded bg-[var(--surface-2)]" />
        </div>
        <div className="mb-2 h-6 w-44 rounded bg-[var(--surface-2)]" />
        <div className="h-3.5 w-80 rounded bg-[var(--surface-2)] opacity-60" />
      </div>

      {/* AskInterface skeleton */}
      <div className="mx-auto max-w-3xl">
        {/* Page sub-header */}
        <div className="mb-8">
          <div className="mb-2 h-3 w-20 rounded bg-[var(--surface-2)]" />
          <div className="mb-2 h-7 w-52 rounded bg-[var(--surface-2)]" />
          <div className="h-3.5 w-96 max-w-full rounded bg-[var(--surface-2)] opacity-60" />
        </div>

        {/* Query form card */}
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)]">
          <div className="border-b border-[var(--line)] p-4 sm:p-5">
            <div className="flex gap-3">
              <div className="h-9 flex-1 rounded-lg bg-[var(--surface-2)]" />
              <div className="h-9 w-14 rounded-lg bg-[var(--surface-2)]" />
            </div>
            <div className="mt-4 flex gap-2">
              <div className="h-8 w-24 rounded-lg bg-[var(--surface-2)] opacity-70" />
              <div className="h-8 w-24 rounded-lg bg-[var(--surface-2)] opacity-70" />
            </div>
          </div>
          {/* Empty state placeholder */}
          <div className="px-5 py-12 text-center">
            <div className="mx-auto h-3.5 w-72 max-w-full rounded bg-[var(--surface-2)] opacity-50" />
          </div>
        </div>
      </div>
    </div>
  );
}
