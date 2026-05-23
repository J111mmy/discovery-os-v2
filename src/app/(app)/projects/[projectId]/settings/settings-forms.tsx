"use client";

import { useState } from "react";
import { generateFrameAction } from "./actions";
import { FrameDraftBanner, type FrameDraft } from "./frame-draft-banner";

interface ProjectSettings {
  frame: string | null;
  frame_draft: FrameDraft | null;
  frame_draft_generated_at: string | null;
  operating_style: string | null;
  gtm_context: string | null;
}

interface TeamMember {
  id: string;
  role: string;
  display_name: string | null;
  user_id: string;
  joined_at: string;
}

interface Invite {
  id: string;
  email: string;
  role: string;
  accepted_at: string | null;
  expires_at: string;
}

interface SettingsFormsProps {
  projectId: string;
  initialProject: ProjectSettings;
  members: TeamMember[];
  invites: Invite[];
  initialTab: "project" | "team";
}

function tabClass(active: boolean) {
  return `rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    active
      ? "bg-[var(--brand)] text-white"
      : "text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
  }`;
}

export function SettingsForms({
  projectId,
  initialProject,
  members,
  invites,
  initialTab,
}: SettingsFormsProps) {
  const [tab, setTab] = useState(initialTab);
  const [frame, setFrame] = useState(initialProject.frame ?? "");
  const [frameDraft, setFrameDraft] = useState(initialProject.frame_draft);
  const [frameDraftGeneratedAt] = useState(initialProject.frame_draft_generated_at);
  const [operatingStyle, setOperatingStyle] = useState(initialProject.operating_style ?? "");
  const [gtmContext, setGtmContext] = useState(initialProject.gtm_context ?? "");
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isGeneratingFrame, setIsGeneratingFrame] = useState(false);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [isInviting, setIsInviting] = useState(false);

  async function saveProjectSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSettingsMessage(null);
    setSettingsError(null);
    setIsSaving(true);

    const response = await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        frame,
        operating_style: operatingStyle,
        gtm_context: gtmContext,
      }),
    });

    const payload = await response.json();
    setIsSaving(false);

    if (!response.ok) {
      setSettingsError(payload.error ?? "Could not save settings.");
      return;
    }

    setSettingsMessage("Project settings saved.");
  }

  async function inviteMember(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInviteMessage(null);
    setInviteError(null);
    setIsInviting(true);

    const response = await fetch("/api/org-invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: projectId, email, role }),
    });

    const payload = await response.json();
    setIsInviting(false);

    if (!response.ok) {
      setInviteError(payload.error ?? "Could not send invite.");
      return;
    }

    setEmail("");
    setInviteMessage(`Invite sent to ${payload.invite.email}.`);
  }

  async function generateFrame() {
    setSettingsMessage(null);
    setSettingsError(null);
    setIsGeneratingFrame(true);

    try {
      const formData = new FormData();
      formData.set("project_id", projectId);
      const generatedFrame = await generateFrameAction(formData);
      setFrame(generatedFrame);
      setSettingsMessage("Project frame generated and saved.");
    } catch (error) {
      setSettingsError(
        error instanceof Error ? error.message : "Could not generate project frame."
      );
    } finally {
      setIsGeneratingFrame(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="inline-flex rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-1">
        <button type="button" onClick={() => setTab("project")} className={tabClass(tab === "project")}>
          Project
        </button>
        <button type="button" onClick={() => setTab("team")} className={tabClass(tab === "team")}>
          Team
        </button>
      </div>

      {tab === "project" && (
        <form onSubmit={saveProjectSettings} className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)]">
          <div className="border-b border-[var(--border)] px-5 py-4">
            <h2 className="text-sm font-semibold text-[var(--ink)]">Project context</h2>
          </div>
          <div className="grid gap-5 p-5">
            {frameDraft && frame.trim().length === 0 && (
              <FrameDraftBanner
                projectId={projectId}
                draft={frameDraft}
                generatedAt={frameDraftGeneratedAt}
                onAccepted={(frameText) => {
                  setFrame(frameText);
                  setFrameDraft(null);
                  setSettingsMessage("AI-proposed frame accepted.");
                }}
                onDiscarded={() => {
                  setFrameDraft(null);
                  setSettingsMessage("AI-proposed frame discarded.");
                }}
              />
            )}
            <div>
              <label className="mb-2 block text-sm font-medium text-[var(--ink)]" htmlFor="frame">
                Project Frame
              </label>
              <textarea
                id="frame"
                rows={7}
                value={frame}
                onChange={(event) => setFrame(event.target.value)}
                className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-faint)] focus:border-[var(--brand)]"
              />
              <div className="mt-3">
                <button
                  type="button"
                  onClick={generateFrame}
                  disabled={isGeneratingFrame}
                  className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--ink)] transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isGeneratingFrame ? "Generating..." : "Auto-generate frame"}
                </button>
              </div>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-[var(--ink)]" htmlFor="operating-style">
                Operating Style
              </label>
              <textarea
                id="operating-style"
                rows={6}
                value={operatingStyle}
                onChange={(event) => setOperatingStyle(event.target.value)}
                className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-faint)] focus:border-[var(--brand)]"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-[var(--ink)]" htmlFor="gtm-context">
                GTM Context
              </label>
              <textarea
                id="gtm-context"
                rows={7}
                value={gtmContext}
                onChange={(event) => setGtmContext(event.target.value)}
                className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-faint)] focus:border-[var(--brand)]"
              />
            </div>
            {settingsError && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {settingsError}
              </div>
            )}
            {settingsMessage && (
              <div className="rounded-lg border border-green-500/20 bg-green-500/10 px-3 py-2 text-sm text-green-300">
                {settingsMessage}
              </div>
            )}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isSaving}
                className="rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-dim)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? "Saving..." : "Save settings"}
              </button>
            </div>
          </div>
        </form>
      )}

      {tab === "team" && (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)]">
            <div className="border-b border-[var(--border)] px-5 py-4">
              <h2 className="text-sm font-semibold text-[var(--ink)]">Members</h2>
            </div>
            <div className="divide-y divide-[var(--border)]">
              {members.map((member) => (
                <div key={member.id} className="flex items-center justify-between gap-4 px-5 py-4">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-[var(--ink)]">
                      {member.display_name || member.user_id}
                    </div>
                    <div className="mt-1 text-xs text-[var(--ink-muted)]">{member.user_id}</div>
                  </div>
                  <span className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-xs font-medium capitalize text-[var(--ink-muted)]">
                    {member.role}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <aside className="space-y-6">
            <form onSubmit={inviteMember} className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5">
              <h2 className="text-sm font-semibold text-[var(--ink)]">Invite teammate</h2>
              <div className="mt-4 space-y-3">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@company.com"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-faint)] focus:border-[var(--brand)]"
                />
                <select
                  value={role}
                  onChange={(event) => setRole(event.target.value as "admin" | "member")}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-[var(--ink)] outline-none transition-colors focus:border-[var(--brand)]"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
                <button
                  type="submit"
                  disabled={isInviting}
                  className="w-full rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-dim)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isInviting ? "Sending..." : "Invite"}
                </button>
              </div>
              {inviteError && <div className="mt-3 text-sm text-red-300">{inviteError}</div>}
              {inviteMessage && <div className="mt-3 text-sm text-green-300">{inviteMessage}</div>}
            </form>

            <section className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5">
              <h2 className="text-sm font-semibold text-[var(--ink)]">Pending invites</h2>
              <div className="mt-4 space-y-3">
                {invites.filter((invite) => !invite.accepted_at).map((invite) => (
                  <div key={invite.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface-0)] p-3">
                    <div className="truncate text-sm font-medium text-[var(--ink)]">{invite.email}</div>
                    <div className="mt-1 text-xs capitalize text-[var(--ink-muted)]">{invite.role}</div>
                  </div>
                ))}
                {invites.filter((invite) => !invite.accepted_at).length === 0 && (
                  <div className="text-sm text-[var(--ink-muted)]">No pending invites.</div>
                )}
              </div>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
