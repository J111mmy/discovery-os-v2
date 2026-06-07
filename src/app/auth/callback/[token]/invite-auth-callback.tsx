"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface InviteAuthCallbackProps {
  token: string;
}

function acceptInvitePath(token: string) {
  return `/accept-invite?token=${encodeURIComponent(token)}`;
}

function getHashParams() {
  if (typeof window === "undefined" || !window.location.hash.startsWith("#")) {
    return new URLSearchParams();
  }

  return new URLSearchParams(window.location.hash.slice(1));
}

export function InviteAuthCallback({ token }: InviteAuthCallbackProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    let cancelled = false;

    async function finishAuth() {
      const supabase = createClient();
      const acceptPath = acceptInvitePath(token);
      const code = searchParams.get("code");

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);

        if (!error && !cancelled) {
          router.replace(acceptPath);
          return;
        }
      }

      const hashParams = getHashParams();
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });

        if (!error && !cancelled) {
          router.replace(acceptPath);
          return;
        }
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session && !cancelled) {
        router.replace(acceptPath);
        return;
      }

      if (!cancelled) {
        router.replace(acceptPath);
      }
    }

    finishAuth();

    return () => {
      cancelled = true;
    };
  }, [router, searchParams, token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] px-5 text-[var(--ink)]">
      <div className="w-full max-w-sm rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6 text-center">
        <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent)] text-lg font-bold text-white">
          D
        </div>
        <h1 className="text-lg font-semibold">Finishing your invitation</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--ink-2)]">
          We are signing you in and adding you to the workspace.
        </p>
      </div>
    </div>
  );
}
