"use client";

import type { CompetitorBattleCard } from "@/types/database";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function DigestRefreshButton({ competitorId }: { competitorId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "queued" | "error">("idle");

  async function refresh() {
    setState("loading");

    const response = await fetch(`/api/competitors/${competitorId}/synthesise`, {
      method: "POST",
    });

    if (!response.ok) {
      setState("error");
      return;
    }

    setState("queued");

    window.setTimeout(() => {
      router.refresh();
      setState("idle");
    }, 8000);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={refresh}
        disabled={state === "loading" || state === "queued"}
        className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--ink)] transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {state === "loading"
          ? "Starting..."
          : state === "queued"
            ? "Regenerating..."
            : "Refresh digest"}
      </button>
      {state === "error" && (
        <span className="text-xs text-red-300">Could not start. Try again.</span>
      )}
      {state === "queued" && (
        <span className="text-xs text-[var(--ink-faint)]">
          Regenerating. Refresh the page in a moment.
        </span>
      )}
    </div>
  );
}

type EditableField = "your_counter" | "one_proof_point";

export function BattleCardEditableFields({
  competitorId,
  battleCard,
}: {
  competitorId: string;
  battleCard: CompetitorBattleCard | null;
}) {
  const [values, setValues] = useState({
    your_counter: battleCard?.your_counter ?? "",
    one_proof_point: battleCard?.one_proof_point ?? "",
  });
  const [savingField, setSavingField] = useState<EditableField | null>(null);
  const [savedField, setSavedField] = useState<EditableField | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function saveField(field: EditableField) {
    const value = values[field].trim() || null;
    const originalValue = battleCard?.[field] ?? "";

    if ((value ?? "") === originalValue) return;

    setSavingField(field);
    setSavedField(null);
    setError(null);

    const response = await fetch(`/api/competitors/${competitorId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });

    setSavingField(null);

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Could not save battle card.");
      return;
    }

    setSavedField(field);
    window.setTimeout(() => setSavedField(null), 1800);
  }

  function updateField(field: EditableField, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <EditableBattleCardField
        label="Your counter"
        description="The talk track your team should use when this competitor comes up."
        value={values.your_counter}
        onChange={(value) => updateField("your_counter", value)}
        onBlur={() => saveField("your_counter")}
        state={
          savingField === "your_counter"
            ? "saving"
            : savedField === "your_counter"
              ? "saved"
              : "idle"
        }
      />
      <EditableBattleCardField
        label="One proof point"
        description="The strongest evidence-backed proof to have ready."
        value={values.one_proof_point}
        onChange={(value) => updateField("one_proof_point", value)}
        onBlur={() => saveField("one_proof_point")}
        state={
          savingField === "one_proof_point"
            ? "saving"
            : savedField === "one_proof_point"
              ? "saved"
              : "idle"
        }
      />
      {error && (
        <div className="lg:col-span-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}

function EditableBattleCardField({
  label,
  description,
  value,
  onChange,
  onBlur,
  state,
}: {
  label: string;
  description: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  state: "idle" | "saving" | "saved";
}) {
  return (
    <label className="block rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-[var(--ink)]">{label}</span>
        {state !== "idle" && (
          <span className="text-xs text-[var(--ink-faint)]">
            {state === "saving" ? "Saving..." : "Saved"}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">{description}</p>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        rows={5}
        className="mt-3 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-sm leading-6 text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-faint)] focus:border-[var(--brand)]"
        placeholder="Add the field-ready counter message..."
      />
    </label>
  );
}
