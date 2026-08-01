"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { safeInternalPath } from "@/lib/auth/safe-internal-path";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeInternalPath(searchParams.get("next"));
  const authError = searchParams.get("error");
  const initialMode = authError === "recovery_failed" ? "reset" : "magic";
  const initialError =
    authError === "recovery_failed"
      ? "This password reset link could not be completed. It may have expired or already been used. Request a new reset link below."
      : authError === "auth_failed"
      ? "This sign-in link could not be completed. Request a new link and open it in the same browser."
      : "";
  const isInviteFlow = next === "/accept-invite";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const AUTH_ERROR_COPY: Record<string, string> = {
    "Invalid login credentials": "That email and password don't match. Check both and try again.",
    "Email not confirmed": "This email hasn't been confirmed yet. Check your inbox for a confirmation link.",
    "For security purposes, you can only request this after 60 seconds.":
      "You've requested a link recently. Wait a minute and try again.",
  };
  function friendlyAuthError(message: string): string {
    return AUTH_ERROR_COPY[message] ?? "Something went wrong signing in. Please try again.";
  }
  // Passwordless-first: magic link is the default for everyone. Password is a
  // fallback behind "Use password instead". (Invite flow was already magic.)
  const [mode, setMode] = useState<"magic" | "password" | "reset">(initialMode);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialError);
  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    if (mode === "reset") {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/confirm`,
      });
      if (error) setError(friendlyAuthError(error.message));
      else setSent(true);
    } else if (mode === "magic") {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
          shouldCreateUser: false,
        },
      });
      if (error) setError(friendlyAuthError(error.message));
      else setSent(true);
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(friendlyAuthError(error.message));
      else router.push(next);
    }

    setLoading(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="flex items-center gap-3 mb-10">
          <div className="w-9 h-9 rounded-lg bg-[var(--accent)] flex items-center justify-center text-white font-bold text-lg">
            D
          </div>
          <div>
            <div className="font-semibold text-[var(--ink)] text-base">DiscOS</div>
            <div className="text-xs text-[var(--ink-2)]">Evidence workspace</div>
          </div>
        </div>

        {sent ? (
          <div className="text-center">
            <div className="text-2xl mb-3">Email sent</div>
            <h2 className="text-lg font-semibold text-[var(--ink)] mb-2">Check your email</h2>
            <p className="text-[var(--ink-2)] text-sm">
              {mode === "reset" ? "We sent a password reset link to " : "We sent a sign-in link to "}
              <strong>{email}</strong>
            </p>
          </div>
        ) : (
          <>
            <h1 className="text-xl font-semibold text-[var(--ink)] mb-1">
              {mode === "reset" ? "Reset password" : isInviteFlow ? "Accept your invitation" : "Sign in"}
            </h1>
            <p className="text-sm text-[var(--ink-2)] mb-6">
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
                aria-label="Email address"
                autoComplete="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg bg-[var(--surface-2)] border border-[var(--line)] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:outline-none focus:border-[var(--accent)] text-sm"
              />

              {mode === "password" && (
                <input
                  type="password"
                  required
                  aria-label="Password"
                  autoComplete="current-password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg bg-[var(--surface-2)] border border-[var(--line)] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:outline-none focus:border-[var(--accent)] text-sm"
                />
              )}

              {error && (
                <div
                  role="alert"
                  className="rounded-lg border border-[var(--tone-error)]/30 bg-[var(--tone-error)]/10 px-3 py-2.5 text-xs text-[var(--tone-error)]"
                >
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !email}
                className="w-full py-2.5 rounded-lg bg-[var(--accent)] text-white font-medium text-sm hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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

            {mode !== "reset" && (
              <button
                onClick={() => { setMode(mode === "password" ? "magic" : "password"); setError(""); }}
                className="mt-4 text-xs text-[var(--ink-2)] hover:text-[var(--ink)] w-full text-center"
              >
                {mode === "password" ? "Use magic link instead" : "Use password instead"}
              </button>
            )}
            {mode !== "reset" ? (
              <button
                type="button"
                onClick={() => { setMode("reset"); setError(""); setSent(false); }}
                className="mt-3 text-xs text-[var(--ink-2)] hover:text-[var(--ink)] w-full text-center"
              >
                Forgot your password?
              </button>
            ) : (
              <button
                type="button"
                onClick={() => { setMode("magic"); setError(""); setSent(false); }}
                className="mt-4 text-xs text-[var(--ink-2)] hover:text-[var(--ink)] w-full text-center"
              >
                Back to sign in
              </button>
            )}

            {mode !== "reset" && (
              <Link
                href="/request-access"
                className="mt-3 block text-xs text-[var(--ink-2)] hover:text-[var(--ink)] w-full text-center"
              >
                Don&apos;t have access yet? Request access
              </Link>
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
        <div className="min-h-screen bg-[var(--bg)]" />
      }
    >
      <LoginForm />
    </Suspense>
  );
}
