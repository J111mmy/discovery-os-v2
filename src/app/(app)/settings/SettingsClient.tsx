"use client";

import { useEffect, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────
type Theme = "dark" | "light";
type Tab = "appearance" | "team" | "billing";

interface Member {
  id: string;
  user_id: string;
  display_name: string | null;
  role: string;
  joined_at: string;
}

interface Invite {
  id: string;
  email: string;
  role: string;
  expires_at: string | null;
  accepted_at: string | null;
}

interface SettingsClientProps {
  orgId: string;
  orgName: string;
  userEmail: string;
  members: Member[];
  invites: Invite[];
}

// ── Helpers ────────────────────────────────────────────────────────────
function getInitials(name: string): string {
  return name
    .split(/[\s@._\-+]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("") || "?";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
};

// ── Mini components ────────────────────────────────────────────────────
function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <div
      aria-hidden
      style={{
        width: size, height: size, borderRadius: "50%",
        background: "var(--accent-soft)", color: "var(--accent)",
        display: "grid", placeItems: "center",
        fontSize: size * 0.38, fontWeight: 640,
        flexShrink: 0, userSelect: "none",
      }}
    >
      {getInitials(name)}
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  const label = ROLE_LABELS[role] ?? role;
  const isOwner = role === "owner";
  return (
    <span
      style={{
        fontSize: 11, fontWeight: 600, padding: "2px 8px",
        borderRadius: 999,
        background: isOwner ? "var(--accent-soft)" : "var(--surface-3)",
        color: isOwner ? "var(--accent)" : "var(--ink-3)",
        letterSpacing: ".02em",
      }}
    >
      {label}
    </span>
  );
}

// ── Main component ─────────────────────────────────────────────────────
export function SettingsClient({
  orgId,
  orgName,
  userEmail,
  members,
  invites,
}: SettingsClientProps) {
  const [tab, setTab] = useState<Tab>("appearance");
  const [theme, setTheme] = useState<Theme>("dark");

  // Invite form state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviteStatus, setInviteStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [inviteError, setInviteError] = useState("");

  // Sync theme from document on mount
  useEffect(() => {
    const stored =
      (document.documentElement.getAttribute("data-theme") as Theme) ||
      (localStorage.getItem("discos-theme") as Theme) ||
      "dark";
    setTheme(stored);
  }, []);

  function applyTheme(next: Theme) {
    setTheme(next);
    localStorage.setItem("discos-theme", next);
    document.documentElement.setAttribute("data-theme", next);
  }

  async function submitInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviteStatus("loading");
    setInviteError("");
    try {
      const res = await fetch("/api/org-invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole, org_id: orgId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Error ${res.status}`);
      }
      setInviteStatus("ok");
      setInviteEmail("");
      setInviteRole("member");
    } catch (err) {
      setInviteStatus("error");
      setInviteError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: "appearance", label: "Appearance" },
    { id: "team",       label: "Team" },
    { id: "billing",    label: "Billing" },
  ];

  // ── Shared input/label style atoms ──────────────────────────────
  const inputStyle: React.CSSProperties = {
    padding: "9px 12px", borderRadius: "var(--r-sm)",
    background: "var(--surface-2)", border: "1px solid var(--line)",
    color: "var(--ink)", fontSize: 13.5, outline: "none",
    fontFamily: "inherit", width: "100%", boxSizing: "border-box",
    transition: "border-color .14s",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 12.5, fontWeight: 560, color: "var(--ink-2)",
    display: "block", marginBottom: 6,
  };

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "36px 24px 80px" }}>

      {/* Page header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "var(--ink)", letterSpacing: "-0.02em" }}>
          Settings
        </h1>
        <p style={{ margin: "5px 0 0", fontSize: 13.5, color: "var(--ink-3)" }}>
          {orgName}
        </p>
      </div>

      {/* Tab bar */}
      <div style={{
        display: "flex", gap: 2, marginBottom: 28,
        borderBottom: "1px solid var(--line)", paddingBottom: 0,
      }}>
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{
              padding: "8px 14px",
              fontSize: 13.5, fontWeight: tab === id ? 620 : 500,
              color: tab === id ? "var(--ink)" : "var(--ink-3)",
              background: "transparent", border: "none", cursor: "pointer",
              borderBottom: tab === id ? "2px solid var(--accent)" : "2px solid transparent",
              marginBottom: -1, transition: "color .14s",
              fontFamily: "inherit",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── APPEARANCE ────────────────────────────────────────────── */}
      {tab === "appearance" && (
        <Section title="Theme">
          <p style={{ margin: "0 0 18px", fontSize: 13.5, color: "var(--ink-3)" }}>
            Choose how DiscOS looks. Your preference is saved locally per browser.
          </p>

          {/* Segmented control */}
          <div style={{ display: "flex", gap: 8 }}>
            {(["dark", "light"] as Theme[]).map((t) => (
              <button
                key={t}
                onClick={() => applyTheme(t)}
                style={{
                  flex: 1, padding: "14px 18px",
                  borderRadius: "var(--r-md)",
                  border: `1.5px solid ${theme === t ? "var(--accent)" : "var(--line)"}`,
                  background: theme === t ? "var(--accent-soft)" : "var(--surface-2)",
                  cursor: "pointer", textAlign: "left",
                  transition: "border-color .14s, background .14s",
                  fontFamily: "inherit",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  {/* Swatch */}
                  <div style={{
                    width: 32, height: 20, borderRadius: 6,
                    background: t === "dark" ? "#0b1124" : "#eef0f5",
                    border: "1px solid var(--line)",
                    boxShadow: "inset 0 1px 3px rgba(0,0,0,0.12)",
                    flexShrink: 0,
                  }} />
                  <span style={{
                    fontSize: 13.5, fontWeight: 600,
                    color: theme === t ? "var(--accent)" : "var(--ink)",
                  }}>
                    {t === "dark" ? "Dark" : "Light"}
                  </span>
                  {theme === t && (
                    <span style={{
                      marginLeft: "auto", fontSize: 11, fontWeight: 600,
                      color: "var(--accent)", letterSpacing: ".04em",
                    }}>
                      ACTIVE
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                  {t === "dark" ? "Navy background, optimised for low-light." : "Soft grey background, optimised for bright light."}
                </div>
              </button>
            ))}
          </div>
        </Section>
      )}

      {/* ── TEAM ──────────────────────────────────────────────────── */}
      {tab === "team" && (
        <>
          {/* Members */}
          <Section title="Members">
            {members.length === 0 ? (
              <p style={{ fontSize: 13.5, color: "var(--ink-3)", margin: 0 }}>No members found.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {members.map((m) => {
                  const name = m.display_name || m.user_id;
                  return (
                    <div
                      key={m.id}
                      style={{
                        display: "flex", alignItems: "center", gap: 12,
                        padding: "10px 12px", borderRadius: "var(--r-sm)",
                        background: "var(--surface-2)",
                      }}
                    >
                      <Avatar name={name} size={34} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 560, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {name}
                        </div>
                        <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 1 }}>
                          Joined {formatDate(m.joined_at)}
                        </div>
                      </div>
                      <RoleBadge role={m.role} />
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          {/* Invite */}
          <Section title="Invite someone">
            <form onSubmit={submitInvite} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Email address</label>
                  <input
                    type="email"
                    required
                    placeholder="colleague@example.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    style={inputStyle}
                    onFocus={(e) => { (e.target as HTMLElement).style.borderColor = "var(--accent)"; }}
                    onBlur={(e) => { (e.target as HTMLElement).style.borderColor = "var(--line)"; }}
                  />
                </div>
                <div style={{ width: 140 }}>
                  <label style={labelStyle}>Role</label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    style={{ ...inputStyle, cursor: "pointer" }}
                  >
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </div>
              </div>

              {inviteStatus === "error" && (
                <div style={{ fontSize: 12.5, color: "var(--neg)", padding: "8px 12px", background: "var(--neg-bg)", borderRadius: "var(--r-sm)" }}>
                  {inviteError}
                </div>
              )}
              {inviteStatus === "ok" && (
                <div style={{ fontSize: 12.5, color: "var(--pos)", padding: "8px 12px", background: "var(--pos-bg)", borderRadius: "var(--r-sm)" }}>
                  Invite sent.
                </div>
              )}

              <div>
                <button
                  type="submit"
                  disabled={inviteStatus === "loading"}
                  style={{
                    padding: "9px 20px", borderRadius: "var(--r-sm)",
                    background: "var(--accent)", color: "#fff",
                    fontWeight: 580, fontSize: 13.5, cursor: inviteStatus === "loading" ? "default" : "pointer",
                    border: "none", fontFamily: "inherit", opacity: inviteStatus === "loading" ? 0.7 : 1,
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.15), 0 3px 10px -4px var(--accent)",
                    transition: "background .14s",
                  }}
                  onMouseEnter={(e) => { if (inviteStatus !== "loading") (e.currentTarget as HTMLElement).style.background = "var(--accent-hover)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--accent)"; }}
                >
                  {inviteStatus === "loading" ? "Sending…" : "Send invite"}
                </button>
              </div>
            </form>
          </Section>

          {/* Pending invites */}
          {invites.length > 0 && (
            <Section title="Pending invites">
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {invites.map((inv) => (
                  <div
                    key={inv.id}
                    style={{
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "10px 12px", borderRadius: "var(--r-sm)",
                      background: "var(--surface-2)",
                    }}
                  >
                    <div
                      style={{
                        width: 34, height: 34, borderRadius: "50%",
                        background: "var(--surface-3)", color: "var(--ink-3)",
                        display: "grid", placeItems: "center",
                        fontSize: 16, flexShrink: 0,
                      }}
                    >
                      ✉
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {inv.email}
                      </div>
                      {inv.expires_at && (
                        <div style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 1 }}>
                          Expires {formatDate(inv.expires_at)}
                        </div>
                      )}
                    </div>
                    <RoleBadge role={inv.role} />
                    <span style={{
                      fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999,
                      background: "var(--warn-bg)", color: "var(--warn)", letterSpacing: ".02em",
                    }}>
                      Pending
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </>
      )}

      {/* ── BILLING ───────────────────────────────────────────────── */}
      {tab === "billing" && (
        <Section title="Billing">
          <div style={{
            padding: "40px 24px", textAlign: "center",
            border: "1px dashed var(--line)", borderRadius: "var(--r-md)",
            color: "var(--ink-3)",
          }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>💳</div>
            <div style={{ fontSize: 14, fontWeight: 560, color: "var(--ink-2)", marginBottom: 6 }}>
              Billing coming soon
            </div>
            <div style={{ fontSize: 12.5 }}>
              Plan and payment management will appear here.
            </div>
          </div>
        </Section>
      )}
    </div>
  );
}

// ── Section wrapper ────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <h2 style={{
        margin: "0 0 14px",
        fontSize: 13, fontWeight: 700, letterSpacing: ".08em",
        textTransform: "uppercase", color: "var(--ink-faint)",
      }}>
        {title}
      </h2>
      <div style={{
        background: "var(--surface)", border: "1px solid var(--line)",
        borderRadius: "var(--r-lg)", padding: "18px 20px",
      }}>
        {children}
      </div>
    </div>
  );
}
