"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface SourceActionsProps {
  projectId: string;
  sourceId: string;
  variant?: "list" | "detail";
}

export function SourceActions({
  projectId,
  sourceId,
  variant = "list",
}: SourceActionsProps) {
  const router = useRouter();
  const [isRetrying, setIsRetrying] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retrySource() {
    setError(null);
    setIsRetrying(true);

    const response = await fetch("/api/ingest/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: projectId, source_id: sourceId }),
    });

    const payload = await response.json();
    setIsRetrying(false);

    if (!response.ok) {
      setError(payload.error ?? "Retry failed.");
      return;
    }

    router.refresh();
  }

  async function deleteSource() {
    setError(null);
    setIsDeleting(true);

    const response = await fetch(`/api/sources/${sourceId}?project_id=${projectId}`, {
      method: "DELETE",
    });

    const payload = await response.json();
    setIsDeleting(false);

    if (!response.ok) {
      setError(payload.error ?? "Delete failed.");
      return;
    }

    if (variant === "detail") {
      router.push(`/projects/${projectId}/sources`);
    } else {
      router.refresh();
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={retrySource}
          disabled={isRetrying || isDeleting}
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--ink)] transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isRetrying ? "Retrying..." : "Retry"}
        </button>
        <button
          type="button"
          onClick={deleteSource}
          disabled={isRetrying || isDeleting}
          className="rounded-lg border border-red-500/20 px-3 py-1.5 text-xs font-medium text-red-300 transition-colors hover:border-red-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isDeleting ? "Deleting..." : "Delete"}
        </button>
      </div>
      {error && <div className="text-xs text-red-300">{error}</div>}
    </div>
  );
}
