"use client";

import Link from "next/link";
import Script from "next/script";
import { useRef, useState } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: string | HTMLElement,
        options: {
          sitekey: string;
          callback?: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
        }
      ) => string;
      reset: (widgetId?: string) => void;
    };
  }
}

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

const inputClass =
  "w-full px-3 py-2.5 rounded-lg bg-[var(--surface-2)] border border-[var(--line)] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:outline-none focus:border-[var(--accent)] text-sm";

export default function RequestAccessPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [reason, setReason] = useState("");
  const [website, setWebsite] = useState(""); // honeypot — real users never fill this in

  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileReady, setTurnstileReady] = useState(false);
  const widgetRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  function renderTurnstile() {
    if (!window.turnstile || !widgetRef.current || widgetIdRef.current || !TURNSTILE_SITE_KEY) {
      return;
    }

    widgetIdRef.current = window.turnstile.render(widgetRef.current, {
      sitekey: TURNSTILE_SITE_KEY,
      callback: (token: string) => setTurnstileToken(token),
      "expired-callback": () => setTurnstileToken(null),
      "error-callback": () => setTurnstileToken(null),
    });
    setTurnstileReady(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    // Honeypot tripped — pretend success without submitting (mirrors the API's
    // own honeypot handling, so a bot gets no signal either way).
    if (website.trim()) {
      setSent(true);
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch("/api/access-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          phone: phone.trim() || undefined,
          company,
          reason,
          turnstile_token: turnstileToken,
        }),
      });

      if (!response.ok) {
        setError("Something went wrong submitting your request. Please try again.");
        window.turnstile?.reset(widgetIdRef.current ?? undefined);
        setTurnstileToken(null);
        setSubmitting(false);
        return;
      }

      setSent(true);
    } catch {
      setError("Something went wrong submitting your request. Please try again.");
      window.turnstile?.reset(widgetIdRef.current ?? undefined);
      setTurnstileToken(null);
      setSubmitting(false);
    }
  }

  const canSubmit =
    !submitting &&
    name.trim() &&
    email.trim() &&
    company.trim() &&
    reason.trim() &&
    (!TURNSTILE_SITE_KEY || Boolean(turnstileToken));

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        async
        defer
        onLoad={renderTurnstile}
      />
      <div className="w-full max-w-md px-5">
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
            <h1 className="text-lg font-semibold text-[var(--ink)] mb-2">Request received</h1>
            <p className="text-[var(--ink-2)] text-sm leading-6">
              Thanks — we&apos;ll review your request and be in touch at <strong>{email}</strong>.
            </p>
            <Link
              href="/login"
              className="mt-6 inline-flex text-xs text-[var(--ink-2)] hover:text-[var(--ink)]"
            >
              Already have access? Sign in
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-xl font-semibold text-[var(--ink)] mb-1">Request access</h1>
            <p className="text-sm text-[var(--ink-2)] mb-6">
              DiscOS is currently invite-only. Tell us a bit about you and we&apos;ll be in touch.
            </p>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <input
                type="text"
                required
                placeholder="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
                autoComplete="name"
              />
              <input
                type="email"
                required
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
                autoComplete="email"
              />
              <input
                type="tel"
                placeholder="Phone (optional)"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={inputClass}
                autoComplete="tel"
              />
              <input
                type="text"
                required
                placeholder="Company"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                className={inputClass}
                autoComplete="organization"
              />
              <textarea
                required
                rows={3}
                placeholder="What are you hoping to use DiscOS for?"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className={`${inputClass} resize-none`}
              />

              {/* Honeypot — hidden from real users, left empty by them */}
              <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
                <label htmlFor="website">Leave this field empty</label>
                <input
                  type="text"
                  id="website"
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                />
              </div>

              {TURNSTILE_SITE_KEY && <div ref={widgetRef} className="flex justify-center" />}

              {error && <p className="text-xs text-[var(--tone-error)]">{error}</p>}

              <button
                type="submit"
                disabled={!canSubmit}
                className="w-full py-2.5 rounded-lg bg-[var(--accent)] text-white font-medium text-sm hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? "Submitting..." : "Request access"}
              </button>
              {TURNSTILE_SITE_KEY && !turnstileReady && (
                <p className="text-xs text-[var(--ink-faint)] text-center">Loading verification…</p>
              )}
            </form>

            <Link
              href="/login"
              className="mt-4 text-xs text-[var(--ink-2)] hover:text-[var(--ink)] w-full text-center block"
            >
              Already have access? Sign in
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
