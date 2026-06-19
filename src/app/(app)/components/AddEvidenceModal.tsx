"use client";

/**
 * AddEvidenceModal (2D) — quick-add evidence modal wired to /api/ingest.
 *
 * Covers the most common paths: paste raw text, or pick a file (PDF/DOCX/TXT/MD).
 * File extraction uses /api/ingest/extract-text (same as the full ingest page).
 * After a successful ingest the user is navigated to the new source detail page.
 *
 * The full-page ingest form at /projects/[id]/ingest remains available for
 * complex cases (very long polls, retry workflows, etc.).
 *
 * Usage:
 *   <AddEvidenceModal open={open} onClose={() => setOpen(false)} projectId={id} />
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SOURCE_TYPE_LABELS } from "@/lib/labels";
import type { SourceType } from "@/types/database";

// ── Source types available in the modal ───────────────────────────

const MODAL_SOURCE_TYPES: SourceType[] = [
  "customer_interview",
  "sales_call",
  "usability_study",
  "internal_meeting",
  "transcript",
  "document",
  "note",
  "survey",
  "support_ticket",
  "other",
];

const TEXT_EXTENSIONS = new Set(["txt", "md", "markdown"]);
const ALLOWED_EXTENSIONS = new Set(["pdf", "doc", "docx", "txt", "md", "markdown"]);

type JobStatus = "idle" | "queued" | "processing" | "done" | "failed";
type InputMode = "paste" | "file";

// ── Icons ──────────────────────────────────────────────────────────

function IcoUpload({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10 13V4M6 7l4-4 4 4" />
      <path d="M3 14v2a1 1 0 001 1h12a1 1 0 001-1v-2" />
    </svg>
  );
}

function IcoPaste({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="5" y="5" width="11" height="13" rx="1.5" />
      <path d="M5 8H4a1 1 0 01-1-1V3a1 1 0 011-1h7a1 1 0 011 1v2" />
    </svg>
  );
}

function IcoCheck({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m5 12 5 5 9-11" />
    </svg>
  );
}

// ── Props ──────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: string | null;
}

// ── Modal ──────────────────────────────────────────────────────────

export function AddEvidenceModal({ open, onClose, projectId }: Props) {
  const router = useRouter();

  // Form state
  const [inputMode, setInputMode] = useState<InputMode>("paste");
  const [title, setTitle] = useState("");
  const [type, setType] = useState<SourceType>("customer_interview");
  const [rawText, setRawText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);

  // Ingest job state
  const [jobId, setJobId] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus>("idle");
  const [claimsCreated, setClaimsCreated] = useState<number | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Using a ref for the poll count so incrementing it doesn't re-run the
  // polling effect and tear down + recreate the interval every 1800ms (which
  // caused the form/Analyzing flicker).
  const pollCountRef = useRef(0);

  const titleRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset on open
  useEffect(() => {
    if (!open) return;
    setInputMode("paste");
    setTitle("");
    setType("customer_interview");
    setRawText("");
    setFileName(null);
    setFileError(null);
    setExtractingFn(false);
    setJobId(null);
    setSourceId(null);
    setJobStatus("idle");
    setClaimsCreated(null);
    setSubmitError(null);
    pollCountRef.current = 0;
    const id = setTimeout(() => titleRef.current?.focus(), 50);
    return () => clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && jobStatus === "idle") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, jobStatus, onClose]);

  // Poll ingest status.
  // pollCountRef is intentionally excluded from deps — it's a ref, not state,
  // so mutation never causes a re-render or effect teardown. Having a plain
  // state counter in the dep array caused the interval to be torn down and
  // recreated every 1800ms, which produced the form/Analyzing flicker.
  useEffect(() => {
    if (!jobId || jobStatus === "done" || jobStatus === "failed") return;
    pollCountRef.current = 0;

    const interval = window.setInterval(async () => {
      if (pollCountRef.current > 850) {
        setSubmitError("This is taking longer than expected. Check the Sources page — if it shows 'check needed', use Retry.");
        setJobStatus("failed");
        return;
      }
      try {
        const res = await fetch(`/api/ingest/status?job_id=${jobId}`, { cache: "no-store" });
        const data = await res.json();
        pollCountRef.current += 1;
        if (!res.ok) {
          setSubmitError(data.error ?? "Could not read ingest status.");
          setJobStatus("failed");
          return;
        }
        setJobStatus(data.status);
        if (data.status === "done") {
          const result = data.result ?? { evidence_created: 0 };
          if ((result.evidence_created ?? 0) === 0) {
            setSubmitError("No evidence was created. Try again from the full ingest page.");
            setJobStatus("failed");
            return;
          }
          setClaimsCreated(result.evidence_created ?? 0);
          const completedId = typeof data.source_id === "string" ? data.source_id : sourceId;
          if (completedId) setSourceId(completedId);
          router.refresh();
        }
        if (data.status === "failed") {
          setSubmitError(data.error ?? "Ingest failed. Try again from the full ingest page.");
        }
      } catch {
        setSubmitError("Network error while polling status.");
        setJobStatus("failed");
      }
    }, 1800);
    return () => window.clearInterval(interval);
  }, [jobId, jobStatus, router, sourceId]);

  // ── File handling ──────────────────────────────────────────────

  async function readTextFile(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("Could not read this file."));
      reader.readAsText(file);
    });
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setFileError(null);
    setRawText("");
    if (!title.trim()) setTitle(file.name.replace(/\.[^.]+$/, ""));
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext ?? "")) {
      setFileError("Upload a .pdf, .doc, .docx, .txt, or .md file.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setFileError("File is too large — max 10 MB.");
      return;
    }
    setExtractingFn(true);
    try {
      let text = "";
      if (TEXT_EXTENSIONS.has(ext ?? "")) {
        text = await readTextFile(file);
      } else {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/ingest/extract-text", { method: "POST", body: fd });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Could not extract text.");
        text = body.text ?? "";
      }
      if (!text.trim()) throw new Error("No readable text found in this file.");
      setRawText(text.trim());
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not extract text.";
      setFileError(`${msg} You can paste the text manually instead.`);
    } finally {
      setExtractingFn(false);
    }
  }

  // Helper to satisfy the exhaustive-deps linter (useState setter stays stable)
  function setExtractingFn(v: boolean) { setExtracting(v); }

  // ── Submit ─────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!projectId) return;
    setSubmitError(null);
    setJobStatus("queued");
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          title: title.trim(),
          type,
          raw_text: rawText.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(typeof data.error === "string" ? data.error : "Could not start ingest.");
        setJobStatus("idle");
        return;
      }
      setJobId(data.job_id);
      setSourceId(data.source_id ?? null);
      setJobStatus("processing");
    } catch {
      setSubmitError("Network error. Please try again.");
      setJobStatus("idle");
    }
  }

  // ── Derived state ──────────────────────────────────────────────

  const isWorking = jobStatus === "queued" || jobStatus === "processing";
  const isDone = jobStatus === "done";
  const isFailed = jobStatus === "failed";
  const canSubmit =
    !isWorking && !isDone && !extracting &&
    !!title.trim() && !!rawText.trim() && !!projectId;

  if (!open) return null;

  // ── Styles ─────────────────────────────────────────────────────

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "10px 12px",
    borderRadius: 9, background: "var(--surface-2)",
    border: "1px solid var(--line)", color: "var(--ink)",
    fontSize: 13.5, outline: "none", fontFamily: "inherit",
    boxSizing: "border-box", transition: "border-color .14s",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 12.5, fontWeight: 540, color: "var(--ink-2)",
    display: "block", marginBottom: 6,
  };

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Add evidence"
      onClick={isWorking ? undefined : onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 80,
        background: "rgba(5,8,18,0.6)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "6vh 20px 20px", overflowY: "auto",
        animation: "fadeIn .18s",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 580,
          background: "var(--surface)", border: "1px solid var(--line)",
          borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-lg)",
          overflow: "hidden", animation: "popIn .22s var(--ease)",
          marginBottom: 20,
        }}
      >
        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "18px 22px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: "var(--accent-soft)", color: "var(--accent)", display: "grid", placeItems: "center", flexShrink: 0 }}>
            <IcoUpload size={17} />
          </div>
          <div>
            <div style={{ fontWeight: 640, fontSize: 16, color: "var(--ink)" }}>Add evidence</div>
            <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 1 }}>
              Paste or upload a transcript, note, or document.
            </div>
          </div>
          {!isWorking && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{
                marginLeft: "auto", width: 30, height: 30,
                display: "grid", placeItems: "center",
                borderRadius: "var(--r-sm)", border: "none",
                background: "transparent", color: "var(--ink-3)",
                cursor: "pointer", fontSize: 18, lineHeight: 1, flexShrink: 0,
              }}
            >×</button>
          )}
        </div>

        {/* ── Input stage ── */}
        {!isWorking && !isDone && (
          <form onSubmit={handleSubmit}>
            <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 14 }}>

              {/* Title + Type row */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 180px", gap: 10 }}>
                <div>
                  <label style={labelStyle} htmlFor="ae-title">Title</label>
                  <input
                    ref={titleRef}
                    id="ae-title"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Q1 call with Sarah K., Acme Corp"
                    disabled={isWorking}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle} htmlFor="ae-type">Type</label>
                  <select
                    id="ae-type"
                    value={type}
                    onChange={(e) => setType(e.target.value as SourceType)}
                    disabled={isWorking}
                    style={{ ...inputStyle, cursor: "pointer" }}
                  >
                    {MODAL_SOURCE_TYPES.map((t) => (
                      <option key={t} value={t}>{SOURCE_TYPE_LABELS[t]}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Paste / File toggle */}
              <div style={{ display: "flex", gap: 6 }}>
                {(["paste", "file"] as InputMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => { setInputMode(m); setRawText(""); setFileName(null); setFileError(null); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "6px 13px", borderRadius: "var(--r-full)",
                      fontSize: 12.5, fontWeight: 580, cursor: "pointer",
                      fontFamily: "inherit", transition: ".12s",
                      background: inputMode === m ? "var(--sel)" : "transparent",
                      color: inputMode === m ? "var(--ink)" : "var(--ink-3)",
                      border: "1px solid " + (inputMode === m ? "var(--line-strong)" : "transparent"),
                    }}
                  >
                    {m === "paste" ? <IcoPaste size={13} /> : <IcoUpload size={13} />}
                    {m === "paste" ? "Paste text" : "Upload file"}
                  </button>
                ))}
              </div>

              {/* Paste input */}
              {inputMode === "paste" && (
                <div>
                  <label style={labelStyle} htmlFor="ae-text">Raw text</label>
                  <textarea
                    id="ae-text"
                    required
                    minLength={20}
                    rows={10}
                    value={rawText}
                    onChange={(e) => setRawText(e.target.value)}
                    placeholder="Paste an interview transcript, meeting notes, sales call summary, or any research text…"
                    disabled={isWorking}
                    style={{ ...inputStyle, resize: "vertical", minHeight: 160 }}
                  />
                </div>
              )}

              {/* File input */}
              {inputMode === "file" && (
                <div>
                  <label style={labelStyle}>File <span style={{ color: "var(--ink-faint)", fontWeight: 400 }}>(PDF, DOCX, TXT, MD · max 10 MB)</span></label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.doc,.docx,.txt,.md,.markdown"
                    disabled={isWorking || extracting}
                    onChange={handleFileChange}
                    style={{
                      display: "block", width: "100%",
                      padding: "10px 12px", borderRadius: 9,
                      border: "1.5px dashed var(--line-strong)",
                      background: "var(--surface-2)", color: "var(--ink-2)",
                      fontSize: 13, cursor: "pointer", boxSizing: "border-box",
                    }}
                  />
                  {extracting && (
                    <p style={{ marginTop: 8, fontSize: 13, color: "var(--ink-3)" }}>Extracting text…</p>
                  )}
                  {!extracting && fileName && rawText && !fileError && (
                    <p style={{ marginTop: 8, fontSize: 13, color: "var(--pos)" }}>
                      ✓ Loaded {fileName} — text ready.
                    </p>
                  )}
                  {fileError && (
                    <div style={{ marginTop: 8, padding: "9px 12px", borderRadius: 8, background: "var(--neg-bg)", border: "1px solid rgba(224,89,79,0.2)", fontSize: 13, color: "var(--neg)" }}>
                      {fileError}
                    </div>
                  )}
                </div>
              )}

              {/* Submit error */}
              {isFailed && submitError && (
                <div style={{ padding: "10px 14px", borderRadius: "var(--r-md)", background: "var(--neg-bg)", border: "1px solid rgba(224,89,79,0.2)", fontSize: 13.5, color: "var(--neg)" }}>
                  {submitError}
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 22px", borderTop: "1px solid var(--line)", background: "var(--surface-2)" }}>
              <p style={{ fontSize: 12, color: "var(--ink-faint)", flex: 1, margin: 0 }}>
                Processing usually takes under a minute.
              </p>
              <button
                type="button"
                onClick={onClose}
                style={{ padding: "8px 14px", borderRadius: "var(--r-sm)", background: "transparent", border: "1px solid var(--line)", color: "var(--ink-2)", fontWeight: 540, fontSize: 13.5, cursor: "pointer", fontFamily: "inherit" }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "9px 18px", borderRadius: "var(--r-md)",
                  background: "var(--accent)", color: "#fff",
                  fontWeight: 580, fontSize: 14, cursor: canSubmit ? "pointer" : "not-allowed",
                  border: "none", fontFamily: "inherit",
                  opacity: canSubmit ? 1 : 0.55, transition: "opacity .14s",
                }}
              >
                Start ingest
              </button>
            </div>
          </form>
        )}

        {/* ── Processing stage ── */}
        {isWorking && (
          <>
            <div style={{ padding: "36px 26px 40px", textAlign: "center" }}>
              <div style={{ display: "inline-flex", width: 52, height: 52, borderRadius: "50%", background: "var(--accent-soft)", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                <span style={{ width: 24, height: 24, border: "2.5px solid var(--accent)", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin .7s linear infinite" }} />
              </div>
              <div style={{ fontSize: 17, fontWeight: 640, color: "var(--ink)", marginBottom: 6 }}>
                {jobStatus === "queued" ? "Queued" : "Analyzing"}
              </div>
              <div style={{ fontSize: 13.5, color: "var(--ink-3)", maxWidth: 360, margin: "0 auto", lineHeight: 1.5 }}>
                {jobStatus === "queued"
                  ? "Waiting for the current source to finish — you can leave this page and check Sources later."
                  : "Extracting source-backed evidence from your material. This usually takes under a minute."}
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "center", padding: "0 22px 22px" }}>
              <button
                type="button"
                onClick={onClose}
                style={{ padding: "8px 18px", borderRadius: "var(--r-sm)", background: "transparent", border: "1px solid var(--line)", color: "var(--ink-2)", fontWeight: 540, fontSize: 13.5, cursor: "pointer", fontFamily: "inherit" }}
              >
                Run in background
              </button>
            </div>
          </>
        )}

        {/* ── Done stage ── */}
        {isDone && (
          <>
            <div style={{ padding: "36px 26px 32px", textAlign: "center" }}>
              <div style={{ width: 56, height: 56, margin: "0 auto 16px", borderRadius: "50%", background: "var(--pos-bg)", color: "var(--pos)", display: "grid", placeItems: "center", animation: "popIn .3s var(--ease)" }}>
                <IcoCheck size={26} />
              </div>
              <div style={{ fontSize: 18, fontWeight: 640, color: "var(--ink)", marginBottom: 6 }}>
                Evidence added
              </div>
              <div style={{ fontSize: 13.5, color: "var(--ink-3)", maxWidth: 380, margin: "0 auto", lineHeight: 1.55 }}>
                {claimsCreated !== null
                  ? <><strong style={{ color: "var(--ink-2)" }}>{claimsCreated}</strong> evidence records created and queued for review.</>
                  : "Source processed successfully."}
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", padding: "14px 22px", borderTop: "1px solid var(--line)", background: "var(--surface-2)" }}>
              <button
                type="button"
                onClick={onClose}
                style={{ padding: "8px 14px", borderRadius: "var(--r-sm)", background: "transparent", border: "1px solid var(--line)", color: "var(--ink-2)", fontWeight: 540, fontSize: 13.5, cursor: "pointer", fontFamily: "inherit" }}
              >
                Close
              </button>
              {sourceId && projectId && (
                <button
                  type="button"
                  onClick={() => { router.push(`/projects/${projectId}/sources/${sourceId}`); onClose(); }}
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 18px", borderRadius: "var(--r-md)", background: "var(--accent)", color: "#fff", fontWeight: 580, fontSize: 14, cursor: "pointer", border: "none", fontFamily: "inherit" }}
                >
                  View source →
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
