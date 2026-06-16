"use client";

/**
 * CmdK — Ask + Jump command palette (2C)
 *
 * Ask mode  → POST /api/ask with the active project_id (streaming)
 * Jump mode → client-side Next.js router.push to real routes
 *
 * Global ⌘K / Ctrl+K keybinding is registered in Rail.tsx (layout-level).
 * This component only manages its own keyboard behaviour once open.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// ── Citation / source shape (subset of EvidenceRecord) ────────────

interface AskCitation {
  content: string;
  source_title?: string;
  segment_speaker?: string | null;
}

// Terminal event sent at end of streaming response
interface CmdKTerminalEvent {
  sources: AskCitation[];
  record_count: number;
  prompt_version?: string;
}

// ── Jump item ──────────────────────────────────────────────────────

interface JumpItem {
  group: string;
  label: string;
  href: string;
}

// ── Static jump items ──────────────────────────────────────────────

const GLOBAL_ITEMS: JumpItem[] = [
  { group: "Directory", label: "People",      href: "/people" },
  { group: "Directory", label: "Companies",   href: "/companies" },
  { group: "Directory", label: "Competitors", href: "/competitors" },
  { group: "Account",   label: "Settings",    href: "/settings" },
];

function buildProjectItems(id: string): JumpItem[] {
  return [
    { group: "Project",  label: "Workspace",  href: `/projects/${id}` },
    { group: "Evidence", label: "Sources",    href: `/projects/${id}/sources` },
    { group: "Evidence", label: "Claims",     href: `/projects/${id}/evidence` },
    { group: "Evidence", label: "Problems",   href: `/projects/${id}/problems` },
    { group: "Studio",   label: "Ask",        href: `/projects/${id}/ask` },
    { group: "Studio",   label: "Compose",    href: `/projects/${id}/compose` },
    { group: "Studio",   label: "Documents",  href: `/projects/${id}/documents` },
    ...GLOBAL_ITEMS,
  ];
}

// ── Suggestion prompts ─────────────────────────────────────────────

const SUGGESTIONS = [
  "Who is the primary buyer versus end user?",
  "What are the top problems across all sources?",
  "What product features were requested most often?",
  "What do participants say about the current workflow?",
];

// ── Props ──────────────────────────────────────────────────────────

export interface CmdKProps {
  open: boolean;
  onClose: () => void;
  projectId: string | null;
  projectName: string | null;
}

// ── Inline bold renderer (avoids dangerouslySetInnerHTML) ──────────

function AnswerText({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <strong
            key={i}
            style={{ color: "var(--ink)", fontWeight: 640, fontFamily: "var(--font-sans)" }}
          >
            {part}
          </strong>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

// ── Hairline icons ─────────────────────────────────────────────────

function IcoSparkle({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path d="M10 2l1.8 6.2L18 10l-6.2 1.8L10 18l-1.8-6.2L2 10l6.2-1.8L10 2z" />
    </svg>
  );
}

function IcoSearch({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
      <circle cx="8.5" cy="8.5" r="5.5" />
      <path d="m14.5 14.5 3 3" />
    </svg>
  );
}

function IcoArrow({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 8h8M9 5l3 3-3 3" />
    </svg>
  );
}

// ── Kbd chip helper ────────────────────────────────────────────────

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      style={{
        display: "inline-block",
        padding: "1px 5px",
        borderRadius: 4,
        background: "var(--surface-3)",
        border: "1px solid var(--line-strong)",
        fontSize: 10,
        fontFamily: "var(--font-mono)",
        color: "var(--ink-3)",
        lineHeight: "18px",
      }}
    >
      {children}
    </kbd>
  );
}

// ── Stream utility ─────────────────────────────────────────────────

// Detect the terminal JSON event at the end of the accumulated buffer.
// The API sends raw answer text then \n{json} as the final line.
function extractCmdKTerminalEvent(
  buffer: string
): { answerText: string; terminal: CmdKTerminalEvent } | null {
  const idx = buffer.lastIndexOf("\n{");
  if (idx === -1) return null;

  const candidate = buffer.slice(idx + 1).trim();
  try {
    const parsed = JSON.parse(candidate) as CmdKTerminalEvent;
    if (
      parsed &&
      Array.isArray(parsed.sources) &&
      typeof parsed.record_count === "number"
    ) {
      return { answerText: buffer.slice(0, idx).trimEnd(), terminal: parsed };
    }
  } catch {
    // Incomplete JSON yet
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════
// CmdK — main component
// ══════════════════════════════════════════════════════════════════

export function CmdK({ open, onClose, projectId, projectName }: CmdKProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"ask" | "jump">("ask");
  // thinking = true while waiting for the first streaming byte
  const [thinking, setThinking] = useState(false);
  // cmkBuffer = growing answer text during streaming; persists as final answer
  const [cmkBuffer, setCmkBuffer] = useState("");
  // cmkSources = populated once terminal event arrives
  const [cmkSources, setCmkSources] = useState<AskCitation[]>([]);
  // cmkStreaming = true from first byte until terminal event
  const [cmkStreaming, setCmkStreaming] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [jumpIdx, setJumpIdx] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  // Detect reduced-motion preference
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const h = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);

  // Reset + focus on open
  useEffect(() => {
    if (!open) return;
    setQ("");
    setCmkBuffer("");
    setCmkSources([]);
    setCmkStreaming(false);
    setAskError(null);
    setMode("ask");
    setJumpIdx(0);
    setThinking(false);
    const id = setTimeout(() => inputRef.current?.focus(), 40);
    return () => clearTimeout(id);
  }, [open]);

  // Jump item list
  const allItems = projectId ? buildProjectItems(projectId) : GLOBAL_ITEMS;
  const filteredItems = q.trim()
    ? allItems.filter(
        (j) =>
          j.label.toLowerCase().includes(q.toLowerCase()) ||
          j.group.toLowerCase().includes(q.toLowerCase())
      )
    : allItems;

  // ── Ask handler ──────────────────────────────────────────────────

  async function askQuestion(question: string) {
    const trimmed = question.trim();
    if (!trimmed) return;
    if (!projectId) {
      setAskError("Open a project first to ask questions about your evidence.");
      return;
    }

    setThinking(true);
    setCmkBuffer("");
    setCmkSources([]);
    setCmkStreaming(false);
    setAskError(null);

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, question: trimmed }),
      });

      if (!res.ok) {
        const data: unknown = await res.json().catch(() => null);
        const msg =
          typeof data === "object" &&
          data !== null &&
          "error" in data &&
          typeof (data as { error: unknown }).error === "string"
            ? (data as { error: string }).error
            : "Something went wrong.";
        setAskError(msg);
        return;
      }

      // Fallback: non-streaming JSON response
      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const data = (await res.json()) as {
          answer: string;
          sources: AskCitation[];
        };
        setCmkBuffer(data.answer);
        setCmkSources(data.sources);
        return;
      }

      if (!res.body) {
        setAskError("No response body from server.");
        return;
      }

      // Streaming path — first byte ends the "thinking" state
      setThinking(false);
      setCmkStreaming(true);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        accumulated += decoder.decode(value, { stream: true });

        const extracted = extractCmdKTerminalEvent(accumulated);
        if (extracted) {
          setCmkBuffer(extracted.answerText);
          setCmkSources(extracted.terminal.sources);
          setCmkStreaming(false);
          return;
        }

        setCmkBuffer(accumulated);
      }

      // Flush remaining decoder bytes
      const tail = decoder.decode();
      if (tail) accumulated += tail;

      const extracted = extractCmdKTerminalEvent(accumulated);
      if (extracted) {
        setCmkBuffer(extracted.answerText);
        setCmkSources(extracted.terminal.sources);
      } else {
        setCmkBuffer(accumulated);
      }
    } catch {
      setAskError("Network error — please try again.");
    } finally {
      setThinking(false);
      setCmkStreaming(false);
    }
  }

  // ── Keyboard handler ─────────────────────────────────────────────

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      switchMode(mode === "ask" ? "jump" : "ask");
      return;
    }
    if (mode === "jump") {
      const total = Math.max(filteredItems.length, 1);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setJumpIdx((i) => (i + 1) % total);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setJumpIdx((i) => (i - 1 + total) % total);
      } else if (e.key === "Enter") {
        const target = filteredItems[jumpIdx];
        if (target) {
          e.preventDefault();
          router.push(target.href);
          onClose();
        }
      }
      return;
    }
    if (mode === "ask" && e.key === "Enter" && !e.shiftKey && q.trim()) {
      e.preventDefault();
      void askQuestion(q);
    }
  }

  // ── Mode switch helpers ──────────────────────────────────────────

  function switchMode(next: "ask" | "jump") {
    setMode(next);
    setCmkBuffer("");
    setCmkSources([]);
    setCmkStreaming(false);
    setAskError(null);
    setQ("");
    setJumpIdx(0);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  if (!open) return null;

  const hasAnswer = cmkBuffer.length > 0;

  // Animation — skip when reduced-motion is requested
  const backdropStyle: React.CSSProperties = {
    position: "fixed", inset: 0, zIndex: 100,
    background: "rgba(5,8,18,0.65)", backdropFilter: "blur(5px)",
    display: "flex", alignItems: "flex-start", justifyContent: "center",
    padding: "12vh 20px 20px",
    ...(reducedMotion ? {} : { animation: "fadeIn .15s" }),
  };
  const panelStyle: React.CSSProperties = {
    width: "100%", maxWidth: 640,
    background: "var(--surface)", border: "1px solid var(--line-strong)",
    borderRadius: "var(--r-xl)", boxShadow: "var(--shadow-pop)",
    overflow: "hidden",
    ...(reducedMotion ? {} : { animation: "popIn .18s var(--ease)" }),
  };

  // Group jump items by their group label (preserving order)
  const grouped: [string, JumpItem[]][] = [];
  const seen = new Set<string>();
  for (const item of filteredItems) {
    if (!seen.has(item.group)) {
      seen.add(item.group);
      grouped.push([item.group, []]);
    }
    grouped[grouped.findIndex(([g]) => g === item.group)][1].push(item);
  }

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Command palette"
      onClick={onClose}
      style={backdropStyle}
    >
      <div onClick={(e) => e.stopPropagation()} style={panelStyle}>

        {/* ── Input row ─────────────────────────────────────────── */}
        <div
          style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "14px 18px", borderBottom: "1px solid var(--line)",
          }}
        >
          {/* Leading icon / spinner */}
          <span
            aria-hidden
            style={{
              flexShrink: 0, display: "grid", placeItems: "center",
              color: thinking ? "var(--accent)" : mode === "ask" ? "var(--accent)" : "var(--ink-3)",
              ...(thinking
                ? {
                    width: 18, height: 18,
                    border: "2px solid var(--accent)", borderTopColor: "transparent",
                    borderRadius: "50%", animation: "spin .7s linear infinite",
                  }
                : {}),
            }}
          >
            {!thinking && (mode === "ask" ? <IcoSparkle size={18} /> : <IcoSearch size={18} />)}
          </span>

          {/* Text input */}
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setCmkBuffer("");
              setCmkSources([]);
              setAskError(null);
            }}
            onKeyDown={handleKey}
            placeholder={
              mode === "ask" ? "Ask your evidence anything…" : "Jump to a screen…"
            }
            aria-label={mode === "ask" ? "Ask a question" : "Jump to a screen"}
            style={{
              flex: 1, border: "none", outline: "none",
              background: "transparent", color: "var(--ink)",
              fontSize: 16.5, fontWeight: 500,
              caretColor: "var(--accent)", fontFamily: "inherit",
            }}
          />

          {/* Mode tabs */}
          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
            {(["ask", "jump"] as const).map((m) => (
              <button
                key={m}
                onClick={() => switchMode(m)}
                aria-pressed={mode === m}
                style={{
                  padding: "5px 11px", borderRadius: "var(--r-full)",
                  fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                  fontFamily: "inherit",
                  background: mode === m
                    ? m === "ask" ? "var(--accent-soft)" : "var(--sel)"
                    : "transparent",
                  color: mode === m
                    ? m === "ask" ? "var(--accent)" : "var(--ink)"
                    : "var(--ink-3)",
                  border: mode === m && m === "ask"
                    ? "1px solid color-mix(in srgb, var(--accent) 30%, transparent)"
                    : "1px solid transparent",
                  transition: "background .12s, color .12s",
                }}
              >
                {m === "ask" ? "Ask" : "Jump"}
              </button>
            ))}
          </div>

          <Kbd>esc</Kbd>
        </div>

        {/* ── Body ──────────────────────────────────────────────── */}
        <div style={{ maxHeight: "54vh", overflowY: "auto" }}>

          {/* ASK — suggestion list */}
          {mode === "ask" && !hasAnswer && !thinking && !askError && (
            <div style={{ padding: "14px 18px 18px" }}>
              <div
                style={{
                  fontSize: 11, letterSpacing: ".09em", textTransform: "uppercase",
                  color: "var(--ink-faint)", fontWeight: 700, marginBottom: 10,
                }}
              >
                {projectId ? `Suggestions · ${projectName ?? "this project"}` : "No project selected"}
              </div>
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={i}
                  onClick={() => { setQ(s); void askQuestion(s); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 11, width: "100%",
                    textAlign: "left", padding: "10px 10px", borderRadius: 10,
                    background: "transparent", border: "none", cursor: "pointer",
                    transition: ".12s", fontFamily: "inherit",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--sel)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                >
                  <span style={{ color: "var(--ink-faint)", flexShrink: 0, display: "grid", placeItems: "center" }}>
                    <IcoSparkle size={14} />
                  </span>
                  <span style={{ fontSize: 14, color: "var(--ink-2)", flex: 1 }}>{s}</span>
                  <span style={{ color: "var(--ink-faint)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                    <IcoArrow size={13} />
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* ASK — thinking (waiting for first byte) */}
          {mode === "ask" && thinking && (
            <div
              style={{
                padding: "32px 18px", textAlign: "center",
                color: "var(--ink-3)", fontSize: 14,
              }}
            >
              Searching your evidence…
            </div>
          )}

          {/* ASK — error */}
          {mode === "ask" && askError && !thinking && (
            <div style={{ padding: "18px 20px" }}>
              <div
                style={{
                  padding: "12px 14px", borderRadius: "var(--r-md)",
                  background: "var(--neg-bg)",
                  border: "1px solid rgba(224,89,79,0.2)",
                  fontSize: 13.5, color: "var(--neg)",
                }}
              >
                {askError}
              </div>
            </div>
          )}

          {/* ASK — streaming / answer */}
          {mode === "ask" && hasAnswer && !thinking && (
            <div style={{ padding: "18px 20px 22px" }}>
              <div
                style={{
                  fontSize: 12, color: "var(--ink-faint)",
                  marginBottom: 12, fontWeight: 500,
                }}
              >
                "{q}"
              </div>
              <p
                style={{
                  fontFamily: "var(--font-serif)", fontSize: 17,
                  lineHeight: 1.62, color: "var(--ink-2)", margin: "0 0 18px",
                }}
              >
                <AnswerText text={cmkBuffer} />
                {/* Streaming pulse after the last word */}
                {cmkStreaming && (
                  <span
                    aria-hidden
                    style={{
                      display: "inline-block",
                      width: 2,
                      height: "0.85em",
                      background: "var(--accent)",
                      marginLeft: 3,
                      verticalAlign: "text-bottom",
                      borderRadius: 1,
                      opacity: 0.8,
                      animation: "pulse 1s ease-in-out infinite",
                    }}
                  />
                )}
              </p>

              {/* Sources — shown only after terminal event */}
              {cmkSources.length > 0 && !cmkStreaming && (
                <>
                  <div
                    style={{
                      fontSize: 11, letterSpacing: ".09em", textTransform: "uppercase",
                      color: "var(--ink-faint)", fontWeight: 700, marginBottom: 9,
                    }}
                  >
                    Grounded in
                  </div>
                  {cmkSources.slice(0, 4).map((s, i) => (
                    <div
                      key={i}
                      style={{
                        padding: "12px 14px", borderRadius: "var(--r-md)",
                        background: "var(--surface-2)", border: "1px solid var(--line)",
                        marginBottom: 8,
                      }}
                    >
                      <div
                        style={{
                          fontFamily: "var(--font-serif)", fontSize: 14, lineHeight: 1.52,
                          marginBottom: 6, color: "var(--ink-2)",
                        }}
                      >
                        "{s.content}"
                      </div>
                      {(s.source_title || s.segment_speaker) && (
                        <div style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>
                          {s.source_title && (
                            <span style={{ color: "var(--ink-3)", fontWeight: 580 }}>
                              {s.source_title}
                            </span>
                          )}
                          {s.segment_speaker && <span> · {s.segment_speaker}</span>}
                        </div>
                      )}
                    </div>
                  ))}
                </>
              )}

              {/* Continue in Ask — shown only after streaming completes */}
              {projectId && !cmkStreaming && (
                <button
                  onClick={() => { router.push(`/projects/${projectId}/ask`); onClose(); }}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 7, marginTop: 10,
                    padding: "8px 14px", borderRadius: "var(--r-md)",
                    background: "var(--surface-2)", border: "1px solid var(--line)",
                    color: "var(--ink-2)", fontSize: 13, fontWeight: 540,
                    cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  <IcoArrow size={13} />
                  Continue in Ask ↗
                </button>
              )}
            </div>
          )}

          {/* JUMP mode */}
          {mode === "jump" && (
            <div style={{ padding: "8px 10px 12px" }}>
              {filteredItems.length === 0 ? (
                <div
                  style={{
                    padding: "26px 18px", textAlign: "center",
                    color: "var(--ink-faint)", fontSize: 13.5,
                  }}
                >
                  No results
                </div>
              ) : (
                grouped.map(([group, items]) => (
                  <div key={group}>
                    <div
                      style={{
                        fontSize: 10.5, letterSpacing: ".1em", textTransform: "uppercase",
                        color: "var(--ink-faint)", fontWeight: 700, padding: "8px 8px 4px",
                      }}
                    >
                      {group}
                    </div>
                    {items.map((item) => {
                      const idx = filteredItems.indexOf(item);
                      const active = jumpIdx === idx;
                      return (
                        <button
                          key={item.href}
                          onClick={() => { router.push(item.href); onClose(); }}
                          onMouseEnter={() => setJumpIdx(idx)}
                          style={{
                            display: "flex", alignItems: "center", gap: 11,
                            width: "100%", textAlign: "left", padding: "9px 10px",
                            borderRadius: 10, border: "none", cursor: "pointer",
                            fontFamily: "inherit", transition: ".1s",
                            background: active ? "var(--sel)" : "transparent",
                            color: active ? "var(--ink)" : "var(--ink-2)",
                          }}
                        >
                          {/* Icon chip */}
                          <span
                            aria-hidden
                            style={{
                              width: 28, height: 28, borderRadius: 7,
                              background: "var(--surface-2)", border: "1px solid var(--line)",
                              display: "grid", placeItems: "center",
                              color: "var(--ink-3)", flexShrink: 0,
                            }}
                          >
                            <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase" }}>
                              {item.label.slice(0, 2)}
                            </span>
                          </span>
                          <span style={{ flex: 1, fontSize: 14 }}>{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* ── Footer ────────────────────────────────────────────── */}
        <div
          style={{
            display: "flex", alignItems: "center", gap: 14,
            padding: "9px 18px", borderTop: "1px solid var(--line)",
            background: "var(--surface-2)",
          }}
        >
          <span style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>
            {projectId && projectName ? (
              <>Searching <strong style={{ color: "var(--ink-3)" }}>{projectName}</strong></>
            ) : (
              "No project selected"
            )}
          </span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
            {mode === "ask" && (
              <span style={{ fontSize: 11.5, color: "var(--ink-faint)", display: "flex", alignItems: "center", gap: 5 }}>
                Ask <Kbd>↵</Kbd>
              </span>
            )}
            {mode === "jump" && (
              <span style={{ fontSize: 11.5, color: "var(--ink-faint)", display: "flex", alignItems: "center", gap: 5 }}>
                Navigate <Kbd>↑↓</Kbd>
              </span>
            )}
            <span style={{ fontSize: 11.5, color: "var(--ink-faint)", display: "flex", alignItems: "center", gap: 5 }}>
              Switch <Kbd>tab</Kbd>
            </span>
          </div>
        </div>

      </div>
    </div>
  );
}
