"use client";

import { useEffect, useRef, useState } from "react";

interface UserMenuProps {
  email: string;
}

export function UserMenu({ email }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const initial = (email ?? "?").charAt(0).toUpperCase();

  return (
    <div ref={ref} className="relative ml-2">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="User menu"
        className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--brand)] text-sm font-semibold text-white transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
      >
        {initial}
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-50 min-w-[200px] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-1)] shadow-lg">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <p className="truncate text-xs text-[var(--ink-muted)]">{email}</p>
          </div>
          <form method="POST" action="/api/auth/sign-out">
            <button
              type="submit"
              className="w-full px-4 py-2.5 text-left text-sm text-[var(--ink-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
            >
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
