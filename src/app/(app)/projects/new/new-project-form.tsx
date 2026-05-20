"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createProjectAction, type NewProjectState } from "./actions";

const initialState: NewProjectState = {};

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-dim)] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Creating..." : "Create project"}
    </button>
  );
}

export function NewProjectForm() {
  const [state, action] = useFormState(createProjectAction, initialState);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const previousAutoSlug = useRef("");

  useEffect(() => {
    if (slugTouched) return;
    const nextSlug = slugify(name);
    previousAutoSlug.current = nextSlug;
    setSlug(nextSlug);
  }, [name, slugTouched]);

  return (
    <form action={action} className="space-y-5">
      <div>
        <label className="mb-2 block text-sm font-medium text-[var(--ink)]" htmlFor="name">
          Project name
        </label>
        <input
          id="name"
          name="name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-faint)] focus:border-[var(--brand)]"
          placeholder="Procurement tracking"
        />
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-[var(--ink)]" htmlFor="slug">
          Slug
        </label>
        <input
          id="slug"
          name="slug"
          value={slug}
          onChange={(event) => {
            setSlugTouched(event.target.value !== previousAutoSlug.current);
            setSlug(slugify(event.target.value));
          }}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 font-mono text-sm text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-faint)] focus:border-[var(--brand)]"
          placeholder="procurement-tracking"
        />
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-[var(--ink)]" htmlFor="description">
          Description
        </label>
        <textarea
          id="description"
          name="description"
          rows={5}
          className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-faint)] focus:border-[var(--brand)]"
          placeholder="A short note on the audience, problem, or decision this workspace supports."
        />
      </div>

      {state.error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {state.error}
        </div>
      )}

      <div className="flex justify-end">
        <SubmitButton />
      </div>
    </form>
  );
}
