"use client";

import type { PersonStatus } from "@/types/database";
import { useRouter } from "next/navigation";
import { useState } from "react";

const STATUS_OPTIONS: Array<{ value: PersonStatus; label: string }> = [
  { value: "prospect", label: "Prospect" },
  { value: "interviewed", label: "Interviewed" },
  { value: "concept-shown", label: "Concept shown" },
  { value: "demo-shown", label: "Demo shown" },
  { value: "beta-candidate", label: "Beta candidate" },
  { value: "beta-participant", label: "Beta participant" },
  { value: "customer", label: "Customer" },
];

type PersonProfile = {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  status: PersonStatus;
};

type FieldName = "name" | "role" | "email" | "status";

export function PersonProfileEditor({
  person,
  companyLink,
  projectLinks,
}: {
  person: PersonProfile;
  companyLink: React.ReactNode;
  projectLinks: React.ReactNode;
}) {
  const router = useRouter();
  const [values, setValues] = useState({
    name: person.name,
    role: person.role ?? "",
    email: person.email ?? "",
    status: person.status,
  });
  const [savedValues, setSavedValues] = useState(values);
  const [savingField, setSavingField] = useState<FieldName | null>(null);
  const [savedField, setSavedField] = useState<FieldName | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function saveField(field: FieldName) {
    const nextValue = values[field].trim();
    const previousValue = savedValues[field].trim();

    if (nextValue === previousValue) return;
    if (field === "name" && nextValue.length === 0) {
      setError("Person name cannot be blank.");
      setValues((current) => ({ ...current, name: savedValues.name }));
      return;
    }

    setSavingField(field);
    setSavedField(null);
    setError(null);

    const response = await fetch(`/api/people/${person.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: field === "name" || field === "status" ? nextValue : nextValue || null }),
    });

    setSavingField(null);

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(payload?.error ?? "Could not save person profile.");
      setValues(savedValues);
      return;
    }

    setSavedValues((current) => ({ ...current, [field]: nextValue }));
    setSavedField(field);
    window.setTimeout(() => setSavedField(null), 1800);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_220px]">
          <EditableInput
            label="Name"
            value={values.name}
            onChange={(value) => setValues((current) => ({ ...current, name: value }))}
            onBlur={() => saveField("name")}
            state={savingField === "name" ? "saving" : savedField === "name" ? "saved" : "idle"}
            inputClassName="text-2xl font-semibold"
          />
          <EditableSelect
            label="Status"
            value={values.status}
            onChange={(value) => {
              setValues((current) => ({ ...current, status: value }));
              void saveStatus(value);
            }}
            state={
              savingField === "status" ? "saving" : savedField === "status" ? "saved" : "idle"
            }
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <EditableInput
            label="Role"
            value={values.role}
            onChange={(value) => setValues((current) => ({ ...current, role: value }))}
            onBlur={() => saveField("role")}
            state={savingField === "role" ? "saving" : savedField === "role" ? "saved" : "idle"}
            placeholder="Head of Procurement"
          />
          <EditableInput
            label="Email"
            value={values.email}
            onChange={(value) => setValues((current) => ({ ...current, email: value }))}
            onBlur={() => saveField("email")}
            state={
              savingField === "email" ? "saving" : savedField === "email" ? "saved" : "idle"
            }
            placeholder="name@example.com"
          />
        </div>
        <div className="mt-3">{companyLink}</div>
        {error && (
          <p className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}
      </div>
      {projectLinks}
    </div>
  );

  async function saveStatus(status: PersonStatus) {
    if (status === savedValues.status || savingField) return;

    setSavingField("status");
    setSavedField(null);
    setError(null);

    const response = await fetch(`/api/people/${person.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });

    setSavingField(null);

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(payload?.error ?? "Could not save person status.");
      setValues(savedValues);
      return;
    }

    setSavedValues((current) => ({ ...current, status }));
    setSavedField("status");
    window.setTimeout(() => setSavedField(null), 1800);
    router.refresh();
  }
}

function FieldState({ state }: { state: "idle" | "saving" | "saved" }) {
  if (state === "idle") return null;
  return (
    <span className="text-xs normal-case tracking-normal text-[var(--ink-faint)]">
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

function EditableSelect({
  label,
  value,
  onChange,
  state,
}: {
  label: string;
  value: PersonStatus;
  onChange: (value: PersonStatus) => void;
  state: "idle" | "saving" | "saved";
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between gap-3 text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
        {label}
        <FieldState state={state} />
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as PersonStatus)}
        className="w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--ink)] outline-none transition-colors focus:border-[var(--accent)]"
      >
        {STATUS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
