"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    router.push("/projects");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--surface-0)] px-5">
      <div className="w-full max-w-sm">
        <div className="mb-10 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--brand)] text-lg font-bold text-white">
            D
          </div>
          <div>
            <div className="text-base font-semibold text-[var(--ink)]">DiscOS</div>
            <div className="text-xs text-[var(--ink-muted)]">Evidence workspace</div>
          </div>
        </div>

        <h1 className="mb-1 text-xl font-semibold text-[var(--ink)]">Choose a new password</h1>
        <p className="mb-6 text-sm text-[var(--ink-muted)]">
          Enter a new password for your account.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            type="password"
            required
            minLength={6}
            placeholder="New password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-sm text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--brand)] focus:outline-none"
          />
          <input
            type="password"
            required
            minLength={6}
            placeholder="Confirm new password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-sm text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--brand)] focus:outline-none"
          />

          {error && <p className="text-xs text-[var(--tone-error)]">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-[var(--brand)] py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-dim)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Saving..." : "Save password"}
          </button>
        </form>
      </div>
    </div>
  );
}
