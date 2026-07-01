"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";

type OrgOption = {
  id: string;
  name: string;
  slug: string | null;
};

type AccessRequest = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  reason: string | null;
  status: "pending" | "approved" | "declined" | string;
  created_at: string;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  invite_id?: string | null;
};

type AccessRequestsResponse = {
  pending: AccessRequest[];
  reviewed: AccessRequest[];
};

type CustomerInviteState = {
  email: string;
  orgName: string;
  busy: boolean;
  error: string | null;
  success: string | null;
};

type RowState = {
  mode: "new_org" | "existing_org";
  orgName: string;
  orgId: string;
  role: "admin" | "member";
  busy?: "approve" | "decline" | null;
  error?: string | null;
};

type Props = {
  orgs: OrgOption[];
};

function formatDate(value: string | null | undefined) {
  if (!value) return "--";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function statusTone(status: string) {
  if (status === "approved") return "border-green-500/30 bg-green-500/10 text-green-300";
  if (status === "declined") return "border-red-500/30 bg-red-500/10 text-red-300";
  return "border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink-2)]";
}

function defaultOrgName(request: AccessRequest) {
  const company = request.company?.trim();
  if (company) return company;
  const name = request.name?.trim();
  return name ? `${name}'s workspace` : "Customer workspace";
}

async function readError(response: Response) {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error : response.statusText;
  } catch {
    return response.statusText;
  }
}

export function AccessRequestsClient({ orgs }: Props) {
  const [pending, setPending] = useState<AccessRequest[]>([]);
  const [reviewed, setReviewed] = useState<AccessRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [customerInvite, setCustomerInvite] = useState<CustomerInviteState>({
    email: "",
    orgName: "",
    busy: false,
    error: null,
    success: null,
  });

  const defaultOrgId = orgs[0]?.id ?? "";

  const orgNameById = useMemo(
    () => new Map(orgs.map((org) => [org.id, org.name])),
    [orgs]
  );

  async function loadRequests() {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/admin/access-requests", {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const body = (await response.json()) as AccessRequestsResponse;
      setPending(body.pending ?? []);
      setReviewed(body.reviewed ?? []);
      setRowState((current) => {
        const next = { ...current };
        for (const request of body.pending ?? []) {
          next[request.id] ??= {
            mode: "new_org",
            orgName: defaultOrgName(request),
            orgId: defaultOrgId,
            role: "member",
            busy: null,
            error: null,
          };
        }
        return next;
      });
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load access requests.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function patchRow(id: string, patch: Partial<RowState>) {
    setRowState((current) => ({
      ...current,
      [id]: {
        mode: current[id]?.mode ?? "new_org",
        orgName: current[id]?.orgName ?? "Customer workspace",
        orgId: current[id]?.orgId ?? defaultOrgId,
        role: current[id]?.role ?? "member",
        busy: current[id]?.busy ?? null,
        error: current[id]?.error ?? null,
        ...patch,
      },
    }));
  }

  function patchCustomerInvite(patch: Partial<CustomerInviteState>) {
    setCustomerInvite((current) => ({ ...current, ...patch }));
  }

  async function submitCustomerInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const email = customerInvite.email.trim();
    const orgName = customerInvite.orgName.trim();
    if (!email || !orgName || customerInvite.busy) return;

    patchCustomerInvite({ busy: true, error: null, success: null });
    try {
      const response = await fetch("/api/admin/customer-invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, org_name: orgName }),
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      patchCustomerInvite({
        email: "",
        orgName: "",
        busy: false,
        error: null,
        success: `Invite sent to ${email}. ${orgName} was created as a new workspace.`,
      });
    } catch (error) {
      patchCustomerInvite({
        busy: false,
        error: error instanceof Error ? error.message : "Could not invite customer.",
      });
    }
  }

  async function approve(request: AccessRequest) {
    const state = rowState[request.id] ?? {
      mode: "new_org" as const,
      orgName: defaultOrgName(request),
      orgId: defaultOrgId,
      role: "member" as const,
    };

    if (state.mode === "new_org" && !state.orgName.trim()) {
      patchRow(request.id, { error: "Enter a workspace name first." });
      return;
    }

    if (state.mode === "existing_org" && !state.orgId) {
      patchRow(request.id, { error: "Choose an organisation first." });
      return;
    }

    patchRow(request.id, { busy: "approve", error: null });
    try {
      const body =
        state.mode === "new_org"
          ? { mode: "new_org" as const, org_name: state.orgName.trim(), role: "owner" as const }
          : { mode: "existing_org" as const, org_id: state.orgId, role: state.role };

      const response = await fetch(`/api/admin/access-requests/${request.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      await loadRequests();
    } catch (error) {
      patchRow(request.id, {
        busy: null,
        error: error instanceof Error ? error.message : "Could not approve request.",
      });
    }
  }

  async function decline(request: AccessRequest) {
    patchRow(request.id, { busy: "decline", error: null });
    try {
      const response = await fetch(`/api/admin/access-requests/${request.id}/decline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: null }),
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      await loadRequests();
    } catch (error) {
      patchRow(request.id, {
        busy: null,
        error: error instanceof Error ? error.message : "Could not decline request.",
      });
    }
  }

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-[var(--line)] bg-[var(--surface)]">
        <div className="border-b border-[var(--line)] px-5 py-4">
          <h2 className="text-sm font-semibold text-[var(--ink)]">
            Invite customer
          </h2>
          <p className="mt-1 text-xs text-[var(--ink-2)]">
            Create a fresh workspace and invite the customer as Owner. Use this
            when you already know who should start a new account.
          </p>
        </div>

        <form
          onSubmit={(event) => void submitCustomerInvite(event)}
          className="grid gap-3 px-5 py-5 md:grid-cols-[1fr_1fr_auto]"
        >
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-[var(--ink-2)]">
              Customer email
            </span>
            <input
              type="email"
              value={customerInvite.email}
              onChange={(event) =>
                patchCustomerInvite({
                  email: event.target.value,
                  error: null,
                  success: null,
                })
              }
              disabled={customerInvite.busy}
              className="w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--ink)] outline-none transition-colors focus:border-[var(--accent)] disabled:opacity-50"
              placeholder="founder@company.com"
              required
            />
          </label>

          <label className="space-y-1.5">
            <span className="text-xs font-medium text-[var(--ink-2)]">
              Workspace name
            </span>
            <input
              type="text"
              value={customerInvite.orgName}
              onChange={(event) =>
                patchCustomerInvite({
                  orgName: event.target.value,
                  error: null,
                  success: null,
                })
              }
              disabled={customerInvite.busy}
              className="w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--ink)] outline-none transition-colors focus:border-[var(--accent)] disabled:opacity-50"
              placeholder="Customer workspace"
              maxLength={180}
              required
            />
          </label>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={
                customerInvite.busy ||
                !customerInvite.email.trim() ||
                !customerInvite.orgName.trim()
              }
              className="w-full rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50 md:w-auto"
            >
              {customerInvite.busy ? "Sending…" : "Invite customer"}
            </button>
          </div>

          {(customerInvite.error || customerInvite.success) && (
            <div className="md:col-span-3">
              {customerInvite.error ? (
                <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                  {customerInvite.error}
                </p>
              ) : (
                <p className="rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-300">
                  {customerInvite.success}
                </p>
              )}
            </div>
          )}
        </form>
      </section>

      <section className="rounded-xl border border-[var(--line)] bg-[var(--surface)]">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-[var(--ink)]">
              Pending requests · {pending.length}
            </h2>
            <p className="mt-1 text-xs text-[var(--ink-2)]">
              Approving creates a new workspace by default, then sends the existing branded invite email.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadRequests()}
            className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]"
          >
            Refresh
          </button>
        </div>

        {loading ? (
          <p className="px-5 py-8 text-sm text-[var(--ink-2)]">Loading requests…</p>
        ) : loadError ? (
          <div className="px-5 py-8">
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {loadError}
            </p>
          </div>
        ) : pending.length === 0 ? (
          <p className="px-5 py-8 text-sm text-[var(--ink-2)]">No pending access requests.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--line)]">
                  <th className="px-5 py-3 font-semibold text-[var(--ink)]">Requester</th>
                  <th className="px-5 py-3 font-semibold text-[var(--ink)]">Company</th>
                  <th className="px-5 py-3 font-semibold text-[var(--ink)]">Reason</th>
                  <th className="px-5 py-3 font-semibold text-[var(--ink)]">Submitted</th>
                  <th className="px-5 py-3 font-semibold text-[var(--ink)]">Invite target</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {pending.map((request) => {
                  const state = rowState[request.id] ?? {
                    mode: "new_org" as const,
                    orgName: defaultOrgName(request),
                    orgId: defaultOrgId,
                    role: "member" as const,
                    busy: null,
                    error: null,
                  };
                  const busy = Boolean(state.busy);

                  return (
                    <tr key={request.id} className="align-top hover:bg-[var(--surface-2)]">
                      <td className="px-5 py-4">
                        <div className="font-medium text-[var(--ink)]">{request.name}</div>
                        <div className="mt-1 text-xs text-[var(--ink-2)]">{request.email}</div>
                        {request.phone && (
                          <div className="mt-1 text-xs text-[var(--ink-faint)]">
                            {request.phone}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-4 text-[var(--ink-2)]">
                        {request.company || "--"}
                      </td>
                      <td className="max-w-xs px-5 py-4 text-[var(--ink-2)]">
                        <p className="line-clamp-4 whitespace-pre-wrap">
                          {request.reason || "--"}
                        </p>
                      </td>
                      <td className="px-5 py-4 text-xs text-[var(--ink-faint)]">
                        {formatDate(request.created_at)}
                      </td>
                      <td className="px-5 py-4">
                        <div className="space-y-3">
                          <div className="inline-flex rounded-lg border border-[var(--line)] bg-[var(--bg)] p-1">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                patchRow(request.id, { mode: "new_org", error: null })
                              }
                              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                                state.mode === "new_org"
                                  ? "bg-[var(--accent)] text-white"
                                  : "text-[var(--ink-2)] hover:text-[var(--ink)]"
                              }`}
                            >
                              New workspace
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                patchRow(request.id, { mode: "existing_org", error: null })
                              }
                              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                                state.mode === "existing_org"
                                  ? "bg-[var(--accent)] text-white"
                                  : "text-[var(--ink-2)] hover:text-[var(--ink)]"
                              }`}
                            >
                              Existing org
                            </button>
                          </div>

                          {state.mode === "new_org" ? (
                            <div className="space-y-2">
                              <input
                                type="text"
                                value={state.orgName}
                                onChange={(event) =>
                                  patchRow(request.id, {
                                    orgName: event.target.value,
                                    error: null,
                                  })
                                }
                                disabled={busy}
                                className="w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--ink)] outline-none transition-colors focus:border-[var(--accent)] disabled:opacity-50"
                                placeholder="Workspace name"
                              />
                              <div className="rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--ink-2)]">
                                Requester will be invited as Owner.
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <select
                                value={state.orgId}
                                onChange={(event) =>
                                  patchRow(request.id, { orgId: event.target.value, error: null })
                                }
                                disabled={busy || orgs.length === 0}
                                className="w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--ink)] outline-none transition-colors focus:border-[var(--accent)] disabled:opacity-50"
                              >
                                {orgs.length === 0 ? (
                                  <option value="">No organisations</option>
                                ) : (
                                  orgs.map((org) => (
                                    <option key={org.id} value={org.id}>
                                      {org.name}
                                      {org.slug ? ` (${org.slug})` : ""}
                                    </option>
                                  ))
                                )}
                              </select>
                              <select
                                value={state.role}
                                onChange={(event) =>
                                  patchRow(request.id, {
                                    role: event.target.value as RowState["role"],
                                    error: null,
                                  })
                                }
                                disabled={busy}
                                className="w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--ink)] outline-none transition-colors focus:border-[var(--accent)] disabled:opacity-50"
                              >
                                <option value="member">Member</option>
                                <option value="admin">Admin</option>
                              </select>
                            </div>
                          )}

                          {state.error && (
                            <p className="text-xs text-red-300">{state.error}</p>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-col gap-2">
                          <button
                            type="button"
                            disabled={busy || (state.mode === "existing_org" && orgs.length === 0)}
                            onClick={() => void approve(request)}
                            className="rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {state.busy === "approve" ? "Approving…" : "Approve"}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void decline(request)}
                            className="rounded-lg border border-red-400/40 px-3 py-2 text-xs font-medium text-red-200 transition-colors hover:border-red-200 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {state.busy === "decline" ? "Declining…" : "Decline"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-[var(--line)] bg-[var(--surface)]">
        <div className="border-b border-[var(--line)] px-5 py-4">
          <h2 className="text-sm font-semibold text-[var(--ink)]">
            Reviewed requests · {reviewed.length}
          </h2>
          <p className="mt-1 text-xs text-[var(--ink-2)]">
            Recently approved or declined submissions.
          </p>
        </div>

        {loading ? (
          <p className="px-5 py-8 text-sm text-[var(--ink-2)]">Loading reviewed requests…</p>
        ) : reviewed.length === 0 ? (
          <p className="px-5 py-8 text-sm text-[var(--ink-2)]">No reviewed requests yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--line)]">
                  <th className="px-5 py-3 font-semibold text-[var(--ink)]">Requester</th>
                  <th className="px-5 py-3 font-semibold text-[var(--ink)]">Status</th>
                  <th className="px-5 py-3 font-semibold text-[var(--ink)]">Reviewed</th>
                  <th className="px-5 py-3 font-semibold text-[var(--ink)]">Invite</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {reviewed.map((request) => (
                  <tr key={request.id} className="hover:bg-[var(--surface-2)]">
                    <td className="px-5 py-4">
                      <div className="font-medium text-[var(--ink)]">{request.name}</div>
                      <div className="mt-1 text-xs text-[var(--ink-2)]">{request.email}</div>
                      {request.company && (
                        <div className="mt-1 text-xs text-[var(--ink-faint)]">
                          {request.company}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusTone(
                          request.status
                        )}`}
                      >
                        {request.status}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-xs text-[var(--ink-faint)]">
                      {formatDate(request.reviewed_at)}
                    </td>
                    <td className="px-5 py-4 text-xs text-[var(--ink-2)]">
                      {request.invite_id ? (
                        <div>
                          <div>{request.email}</div>
                          <div className="mt-1 font-mono text-[var(--ink-faint)]">
                            {request.invite_id}
                          </div>
                        </div>
                      ) : (
                        "--"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
