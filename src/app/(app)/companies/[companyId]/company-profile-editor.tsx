"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type CompanyProfile = {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  size: string | null;
  notes: string | null;
};

type FieldName = keyof Pick<CompanyProfile, "name" | "domain" | "industry" | "size" | "notes">;

function domainHref(domain: string) {
  return domain.startsWith("http://") || domain.startsWith("https://")
    ? domain
    : `https://${domain}`;
}

export function CompanyProfileEditor({ company }: { company: CompanyProfile }) {
  const router = useRouter();
  const [values, setValues] = useState({
    name: company.name,
    domain: company.domain ?? "",
    industry: company.industry ?? "",
    size: company.size ?? "",
    notes: company.notes ?? "",
  });
  const [savedValues, setSavedValues] = useState(values);
  const [savingField, setSavingField] = useState<FieldName | null>(null);
  const [savedField, setSavedField] = useState<FieldName | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  async function saveField(field: FieldName) {
    const nextValue = values[field].trim();
    const previousValue = savedValues[field].trim();

    if (nextValue === previousValue) return;
    if (field === "name" && nextValue.length === 0) {
      setError("Company name cannot be blank.");
      setValues((current) => ({ ...current, name: savedValues.name }));
      return;
    }

    setSavingField(field);
    setSavedField(null);
    setError(null);

    const response = await fetch(`/api/companies/${company.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: field === "name" ? nextValue : nextValue || null }),
    });

    setSavingField(null);

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(payload?.error ?? "Could not save company profile.");
      setValues(savedValues);
      return;
    }

    setSavedValues((current) => ({ ...current, [field]: nextValue }));
    setSavedField(field);
    window.setTimeout(() => setSavedField(null), 1800);
    router.refresh();
  }

  function updateField(field: FieldName, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  async function removeCompany() {
    setRemoving(true);
    setRemoveError(null);

    const response = await fetch(`/api/companies/${company.id}`, { method: "DELETE" });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setRemoveError(payload?.error ?? "Could not remove this company.");
      setRemoving(false);
      return;
    }

    router.push("/companies");
    router.refresh();
  }

  return (
    <section className="mb-8 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6">
      <div className="flex flex-col gap-4">
        <EditableInput
          label="Company name"
          value={values.name}
          onChange={(value) => updateField("name", value)}
          onBlur={() => saveField("name")}
          state={savingField === "name" ? "saving" : savedField === "name" ? "saved" : "idle"}
          inputClassName="text-2xl font-semibold"
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <EditableInput
            label="Website"
            value={values.domain}
            onChange={(value) => updateField("domain", value)}
            onBlur={() => saveField("domain")}
            state={
              savingField === "domain" ? "saving" : savedField === "domain" ? "saved" : "idle"
            }
            placeholder="example.com"
          />
          <EditableInput
            label="Industry"
            value={values.industry}
            onChange={(value) => updateField("industry", value)}
            onBlur={() => saveField("industry")}
            state={
              savingField === "industry"
                ? "saving"
                : savedField === "industry"
                  ? "saved"
                  : "idle"
            }
            placeholder="Construction"
          />
          <EditableInput
            label="Size"
            value={values.size}
            onChange={(value) => updateField("size", value)}
            onBlur={() => saveField("size")}
            state={savingField === "size" ? "saving" : savedField === "size" ? "saved" : "idle"}
            placeholder="500-1000"
          />
        </div>
        <EditableTextarea
          label="Notes"
          value={values.notes}
          onChange={(value) => updateField("notes", value)}
          onBlur={() => saveField("notes")}
          state={savingField === "notes" ? "saving" : savedField === "notes" ? "saved" : "idle"}
          placeholder="Add context the team should remember..."
        />
        {values.domain.trim() && (
          <a
            href={domainHref(values.domain.trim())}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex self-start text-sm text-[var(--accent)] transition-colors hover:text-[var(--ink)]"
          >
            Open website
          </a>
        )}
        {error && (
          <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        <div className="mt-2 border-t border-[var(--line)] pt-4">
          {!confirmingRemove ? (
            <button
              type="button"
              onClick={() => setConfirmingRemove(true)}
              className="text-sm font-medium text-red-300 transition-colors hover:text-red-200"
            >
              Remove this company
            </button>
          ) : (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4">
              <p className="text-sm leading-6 text-[var(--ink)]">
                Remove {values.name || "this company"}? This deletes the company record. People and
                evidence already linked to it stay, but lose their link to this company. This can&apos;t
                be undone.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={removeCompany}
                  disabled={removing}
                  className="rounded-lg border border-red-500/30 bg-red-500/15 px-3 py-1.5 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {removing ? "Removing..." : "Yes, remove it"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingRemove(false);
                    setRemoveError(null);
                  }}
                  disabled={removing}
                  className="rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-1.5 text-sm font-medium text-[var(--ink-2)] transition-colors hover:border-[var(--ink-2)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
              {removeError && (
                <p className="mt-3 text-sm text-red-300">{removeError}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function FieldState({ state }: { state: "idle" | "saving" | "saved" }) {
  if (state === "idle") return null;
  return (
    <span className="text-xs text-[var(--ink-faint)]">
      {state === "saving" ? "Saving..." : "Saved"}
    </span>
  );
}

function EditableInput({
  label,
  value,
  onChange,
  onBlur,
  state,
  placeholder,
  inputClassName = "text-sm",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  state: "idle" | "saving" | "saved";
  placeholder?: string;
  inputClassName?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between gap-3 text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
        {label}
        <FieldState state={state} />
      </span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        className={`w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)] ${inputClassName}`}
      />
    </label>
  );
}

function EditableTextarea({
  label,
  value,
  onChange,
  onBlur,
  state,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  state: "idle" | "saving" | "saved";
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between gap-3 text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
        {label}
        <FieldState state={state} />
      </span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        rows={3}
        placeholder={placeholder}
        className="w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm leading-6 text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)]"
      />
    </label>
  );
}
