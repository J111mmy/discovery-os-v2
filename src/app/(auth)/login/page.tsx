"use client";
import { Suspense, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/projects";
  const isInviteFlow = next === "/accept-invite";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"magic" | "password" | "reset">(
    isInviteFlow ? "magic" : "password"
  );
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    if (mode === "reset") {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
      });
      if (error) setError(error.message);
      else setSent(true);
    } else if (mode === "magic") {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      if (error) setError(error.message);
      else setSent(true);
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
      else router.push(next.startsWith("/") ? next : "/projects");
    }

    setLoading(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--surface-0)]">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="flex items-center gap-3 mb-10">
          <div className="w-9 h-9 rounded-lg bg-[var(--brand)] flex items-center justify-center text-white font-bold text-lg">
            D
          </div>
          <div>
            <div className="font-semibold text-[var(--ink)] text-base">DiscOS</div>
            <div className="text-xs text-[var(--ink-muted)]">Evidence workspace</div>
          </div>
        </div>

        {sent ? (
          <div className="text-center">
            <div className="text-2xl mb-3">Email sent</div>
            <h2 className="text-lg font-semibold text-[var(--ink)] mb-2">Check your email</h2>
            <p className="text-[var(--ink-muted)] text-sm">
              {mode === "reset" ? "We sent a password reset link to " : "We sent a sign-in link to "}
              <strong>{email}</strong>
            </p>
          </div>
        ) : (
          <>
            <h1 className="text-xl font-semibold text-[var(--ink)] mb-1">
              {mode === "reset" ? "Reset password" : isInviteFlow ? "Accept your invitation" : "Sign in"}
            </h1>
            <p className="text-sm text-[var(--ink-muted)] mb-6">
              {mode === "reset"
                ? "We'll send you a link to choose a new password."
                : isInviteFlow && mode === "magic"
                ? "Enter the invited email address. We'll send a sign-in link to finish joining the workspace."
                : mode === "password"
                ? "Sign in with email and password."
                : "We'll send you a magic link."}
            </p>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <input
                type="email"
                required
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:outline-none focus:border-[var(--brand)] text-sm"
              />

              {mode === "password" && (
                <input
                  type="password"
                  required
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:outline-none focus:border-[var(--brand)] text-sm"
                />
              )}

              {error && <p className="text-xs text-[var(--tone-error)]">{error}</p>}

              <button
                type="submit"
                disabled={loading || !email}
                className="w-full py-2.5 rounded-lg bg-[var(--brand)] text-white font-medium text-sm hover:bg-[var(--brand-dim)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading
                  ? "Working..."
                  : mode === "reset"
                  ? "Send reset link"
                  : mode === "password"
                  ? "Sign in"
                  : "Send magic link"}
              </button>
            </form>

            <button
              onClick={() => { setMode(mode === "password" ? "magic" : "password"); setError(""); }}
              className="mt-4 text-xs text-[var(--ink-muted)] hover:text-[var(--ink)] w-full text-center"
            >
              {mode === "password" ? "Use magic link instead" : "Use password instead"}
            </button>
            {mode !== "reset" ? (
              <button
                type="button"
                onClick={() => { setMode("reset"); setError(""); setSent(false); }}
                className="mt-3 text-xs text-[var(--ink-muted)] hover:text-[var(--ink)] w-full text-center"
              >
                Forgot your password?
              </button>
            ) : (
              <button
                type="button"
                onClick={() => { setMode("password"); setError(""); setSent(false); }}
                className="mt-3 text-xs text-[var(--ink-muted)] hover:text-[var(--ink)] w-full text-center"
              >
                Back to sign in
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[var(--surface-0)]" />
      }
    >
      <LoginForm />
    </Suspense>
  );
}
