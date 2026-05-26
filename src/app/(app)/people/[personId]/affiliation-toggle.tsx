"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Affiliation } from "@/types/database";

const OPTIONS = [
  { value: "external", label: "External", description: "Customer, prospect, or third party" },
  {
    value: "internal",
    label: "Internal",
    description: "Team member - speech treated as context, not evidence",
  },
  { value: "unknown", label: "Unclassified", description: "Not yet classified" },
] as const;

export function AffiliationToggle({
  personId,
  initialAffiliation,
}: {
  personId: string;
  initialAffiliation: Affiliation;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState<Affiliation>(initialAffiliation);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setAffiliation(value: Affiliation) {
    if (value === current || saving) return;

    setSaving(true);
    setError(null);

    const response = await fetch(`/api/people/${personId}/affiliation`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ affiliation: value }),
    });

    setSaving(false);

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload.error ?? "Could not update affiliation.");
      return;
    }

    setCurrent(value);
    router.refresh();
  }

  return (
    <div>
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
        Affiliation
      </div>
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={saving}
            onClick={() => setAffiliation(option.value)}
            title={option.description}
            className={[
              "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              current === option.value
                ? option.value === "internal"
                  ? "border-yellow-500/40 bg-yellow-500/15 text-yellow-300"
                  : option.value === "external"
                    ? "border-green-500/30 bg-green-500/10 text-green-300"
                    : "border-[var(--brand)]/30 bg-[var(--brand)]/10 text-[var(--brand)]"
                : "border-[var(--border)] bg-[var(--surface-0)] text-[var(--ink-muted)] hover:border-[var(--ink-muted)]",
            ].join(" ")}
          >
            {option.label}
          </button>
        ))}
      </div>
      {saving && <div className="mt-2 text-xs text-[var(--ink-faint)]">Saving...</div>}
      {error && <div className="mt-2 text-xs text-red-300">{error}</div>}
      {current === "internal" && (
        <p className="mt-2 text-xs leading-5 text-[var(--ink-faint)]">
          This person's speech will be treated as context during ingest, not as customer evidence.
        </p>
      )}
    </div>
  );
}
