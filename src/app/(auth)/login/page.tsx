"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"magic" | "password">("password");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    if (mode === "magic") {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) setError(error.message);
      else setSent(true);
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
      else router.push("/projects");
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
            <div className="text-2xl mb-3">✉️</div>
            <h2 className="text-lg font-semibold text-[var(--ink)] mb-2">Check your email</h2>
            <p className="text-[var(--ink-muted)] text-sm">
              We sent a sign-in link to <strong>{email}</strong>
            </p>
          </div>
        ) : (
          <>
            <h1 className="text-xl font-semibold text-[var(--ink)] mb-1">Sign in</h1>
            <p className="text-sm text-[var(--ink-muted)] mb-6">
              {mode === "password" ? "Sign in with email and password." : "We'll send you a magic link."}
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
                {loading ? "Signing in…" : mode === "password" ? "Sign in" : "Send magic link"}
              </button>
            </form>

            <button
              onClick={() => { setMode(mode === "password" ? "magic" : "password"); setError(""); }}
              className="mt-4 text-xs text-[var(--ink-muted)] hover:text-[var(--ink)] w-full text-center"
            >
              {mode === "password" ? "Use magic link instead" : "Use password instead"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
