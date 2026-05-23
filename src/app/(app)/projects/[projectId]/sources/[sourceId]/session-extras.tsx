"use client";

import type { ActionStatus, PrioritySignal } from "@/types/database";
import { useEffect, useMemo, useState } from "react";

type SessionAction = {
  id: string;
  description: string;
  owner: string | null;
  due_note: string | null;
  status: ActionStatus;
};

type ProductRequest = {
  id: string;
  description: string;
  requester_name: string | null;
  priority_signal: PrioritySignal;
};

type SessionExtrasResponse = {
  actions?: SessionAction[];
  product_requests?: ProductRequest[];
  error?: string;
};

const priorityLabels: Record<PrioritySignal, string> = {
  critical: "Critical",
  important: "Important",
  nice_to_have: "Nice to have",
};

const priorityClasses: Record<PrioritySignal, string> = {
  critical: "border-red-400/40 bg-red-500/10 text-red-300",
  important: "border-amber-400/40 bg-amber-500/10 text-amber-300",
  nice_to_have: "border-[var(--border)] bg-[var(--surface-2)] text-[var(--ink-muted)]",
};

export function SessionExtras({ sourceId }: { sourceId: string }) {
  const [actions, setActions] = useState<SessionAction[]>([]);
  const [requests, setRequests] = useState<ProductRequest[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadExtras() {
      try {
        const response = await fetch(`/api/sources/${sourceId}/actions`);
        const data = (await response.json()) as SessionExtrasResponse;

        if (!response.ok) {
          throw new Error(data.error ?? "Could not load session actions.");
        }

        if (active) {
          setActions(data.actions ?? []);
          setRequests(data.product_requests ?? []);
          setLoaded(true);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Could not load session actions.");
          setLoaded(true);
        }
      }
    }

    loadExtras();

    return () => {
      active = false;
    };
  }, [sourceId]);

  const openActionCount = useMemo(
    () => actions.filter((action) => action.status === "open").length,
    [actions]
  );

  async function updateActionStatus(action: SessionAction, status: ActionStatus) {
    const previousActions = actions;

    setUpdatingId(action.id);
    setActions((current) =>
      current.map((item) => (item.id === action.id ? { ...item, status } : item))
    );

    try {
      const response = await fetch(`/api/actions/${action.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "Could not update action.");
      }
    } catch (updateError) {
      setActions(previousActions);
      setError(updateError instanceof Error ? updateError.message : "Could not update action.");
    } finally {
      setUpdatingId(null);
    }
  }

  if (!loaded) {
    return null;
  }

  if (error && actions.length === 0 && requests.length === 0) {
    return (
      <div className="mb-6 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
        {error}
      </div>
    );
  }

  if (actions.length === 0 && requests.length === 0) {
    return null;
  }

  return (
    <div className="mb-8 space-y-6">
      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {actions.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-[var(--ink)]">
            Actions ({openActionCount} open)
          </h2>
          <div className="space-y-2">
            {actions.map((action) => {
              const done = action.status === "done";

              return (
                <div
                  key={action.id}
                  className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] px-4 py-3"
                >
                  <button
                    type="button"
                    onClick={() => updateActionStatus(action, done ? "open" : "done")}
                    disabled={updatingId === action.id}
                    className={`mt-0.5 h-4 w-4 shrink-0 rounded border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      done
                        ? "border-[var(--brand)] bg-[var(--brand)]"
                        : "border-[var(--border)] bg-transparent hover:border-[var(--brand)]"
                    }`}
                    aria-label={done ? "Mark action open" : "Mark action done"}
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-sm leading-6 ${
                        done
                          ? "text-[var(--ink-faint)] line-through"
                          : "text-[var(--ink)]"
                      }`}
                    >
                      {action.description}
                    </p>
                    {(action.owner || action.due_note || action.status === "dismissed") && (
                      <div className="mt-0.5 flex flex-wrap gap-2 text-xs text-[var(--ink-faint)]">
                        {action.owner && <span>{action.owner}</span>}
                        {action.due_note && <span>{action.due_note}</span>}
                        {action.status === "dismissed" && <span>Dismissed</span>}
                      </div>
                    )}
                  </div>
                  {action.status !== "dismissed" && (
                    <button
                      type="button"
                      onClick={() => updateActionStatus(action, "dismissed")}
                      disabled={updatingId === action.id}
                      className="shrink-0 rounded-lg border border-[var(--border)] px-2 py-1 text-xs font-medium text-[var(--ink-muted)] transition-colors hover:border-red-400/40 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Dismiss
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {requests.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-[var(--ink)]">
            Product requests ({requests.length})
          </h2>
          <div className="space-y-2">
            {requests.map((request) => (
              <div
                key={request.id}
                className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] px-4 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm leading-6 text-[var(--ink)]">{request.description}</p>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${priorityClasses[request.priority_signal]}`}
                  >
                    {priorityLabels[request.priority_signal]}
                  </span>
                </div>
                {request.requester_name && (
                  <p className="mt-1 text-xs text-[var(--ink-faint)]">{request.requester_name}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
