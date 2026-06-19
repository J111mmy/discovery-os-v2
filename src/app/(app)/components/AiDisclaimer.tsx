// Persistent disclaimer shown below all AI-generated content surfaces.
// Not dismissible — always present so readers know to verify against sources.
export function AiDisclaimer() {
  return (
    <p className="mt-4 flex items-start gap-1.5 text-xs leading-5 text-[var(--ink-faint)]">
      <svg
        width="13"
        height="13"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className="mt-px shrink-0"
      >
        <circle cx="8" cy="8" r="6.5" />
        <path d="M8 7.5v4M8 5.5h.01" />
      </svg>
      AI-generated and can make mistakes. Check important details against the cited sources.
    </p>
  );
}
