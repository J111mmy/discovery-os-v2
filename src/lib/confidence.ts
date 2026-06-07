// Evidence confidence scoring
//
// Produces a 0–100 score reflecting how well a project's evidence base supports
// reliable synthesis. Four weighted signals:
//
//  A. Evidence depth     (30 pts) — enough trusted records to generalise from
//  B. Source diversity   (30 pts) — records from multiple distinct sources
//                                   (3 sources with 10 records > 1 source with 30)
//  C. Recency            (20 pts) — evidence collected recently enough to be relevant
//  D. Synthesis breadth  (20 pts) — themes and problems show patterns have been found
//
// Usage:
//   const score = computeConfidence({ trustedCount, sourceIds, mostRecentAt, themeCount, problemCount });

export type ConfidenceInput = {
  /** Total trusted evidence record count */
  trustedCount: number;
  /** source_id values for every trusted evidence record (may have duplicates) */
  sourceIds: string[];
  /** ISO timestamp of the most recently created trusted evidence record, or null */
  mostRecentAt: string | null;
  /** Number of themes surfaced by synthesis */
  themeCount: number;
  /** Number of open/active problems surfaced by synthesis */
  problemCount: number;
};

export type ConfidenceSignal = {
  label: string;
  score: number;
  max: number;
  hint: string;
};

export type ConfidenceResult = {
  score: number;
  label: "Just started" | "Early" | "Building" | "Strong";
  colour: string;
  signals: ConfidenceSignal[];
  /** The lowest-scoring signal, normalised — drives the "Next:" hint */
  weakest: ConfidenceSignal;
};

// ─── Targets ─────────────────────────────────────────────────────────────────

const TARGET_TRUSTED     = 20;  // A: 20 trusted records = full depth score
const TARGET_SOURCES     = 4;   // B: 4 distinct sources = full diversity score
const STALE_DAYS         = 90;  // C: evidence older than this starts losing points
const TARGET_THEMES      = 4;   // D: 4 themes = full theme component
const TARGET_PROBLEMS    = 3;   // D: 3 problems = full problem component

// ─── Recency helper ──────────────────────────────────────────────────────────

function daysSince(isoDate: string): number {
  return Math.floor((Date.now() - new Date(isoDate).getTime()) / 86_400_000);
}

function recencyScore(mostRecentAt: string | null): number {
  if (!mostRecentAt) return 0;
  const days = daysSince(mostRecentAt);
  if (days < 30)  return 20;
  if (days < 60)  return 16;
  if (days < 90)  return 12;
  if (days < 180) return 6;
  return 0; // evidence is stale — flag it
}

function recencyHint(mostRecentAt: string | null): string {
  if (!mostRecentAt) return "No trusted evidence yet";
  const days = daysSince(mostRecentAt);
  if (days < 30)  return `Last evidence ${days}d ago — good`;
  if (days < 60)  return `Last evidence ${days}d ago — still fresh`;
  if (days < 90)  return `Last evidence ${days}d ago — consider refreshing`;
  if (days < 180) return `Last evidence ${days}d ago — evidence is getting stale`;
  return `Last evidence ${days}d ago — add recent sessions to refresh confidence`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function computeConfidence(input: ConfidenceInput): ConfidenceResult {
  const { trustedCount, sourceIds, mostRecentAt, themeCount, problemCount } = input;

  const distinctSources = new Set(sourceIds).size;

  // A — Evidence depth (30 pts)
  const depthScore = Math.min(trustedCount / TARGET_TRUSTED, 1) * 30;
  const depthSignal: ConfidenceSignal = {
    label: "Evidence depth",
    score: depthScore,
    max: 30,
    hint: trustedCount < TARGET_TRUSTED
      ? `${trustedCount} trusted record${trustedCount === 1 ? "" : "s"} — aim for ${TARGET_TRUSTED}+`
      : `${trustedCount} trusted records — good coverage`,
  };

  // B — Source diversity (30 pts)
  // Bonus for having many distinct sources. A single source with many records
  // scores much lower than the same records spread across multiple sources.
  const diversityScore = Math.min(distinctSources / TARGET_SOURCES, 1) * 30;
  const diversitySignal: ConfidenceSignal = {
    label: "Source diversity",
    score: diversityScore,
    max: 30,
    hint: distinctSources < TARGET_SOURCES
      ? `${distinctSources} source${distinctSources === 1 ? "" : "s"} with trusted evidence — aim for ${TARGET_SOURCES}+ distinct sources`
      : `${distinctSources} distinct sources — good diversity`,
  };

  // C — Recency (20 pts)
  const recencyPts = recencyScore(mostRecentAt);
  const recencySignal: ConfidenceSignal = {
    label: "Recency",
    score: recencyPts,
    max: 20,
    hint: recencyHint(mostRecentAt),
  };

  // D — Synthesis breadth (20 pts): themes (10) + problems (10)
  const themesPts   = Math.min(themeCount / TARGET_THEMES, 1) * 10;
  const problemsPts = Math.min(problemCount / TARGET_PROBLEMS, 1) * 10;
  const breadthScore = themesPts + problemsPts;
  const breadthSignal: ConfidenceSignal = {
    label: "Synthesis breadth",
    score: breadthScore,
    max: 20,
    hint:
      themeCount === 0 && problemCount === 0
        ? "Run synthesis to surface themes and problems"
        : themeCount < TARGET_THEMES
        ? `${themeCount} theme${themeCount === 1 ? "" : "s"} found — run synthesis as evidence grows`
        : `${themeCount} themes, ${problemCount} problems — solid synthesis depth`,
  };

  const signals = [depthSignal, diversitySignal, recencySignal, breadthSignal];
  const total = Math.round(depthScore + diversityScore + recencyPts + breadthScore);
  const score = Math.min(total, 100);

  const label: ConfidenceResult["label"] =
    score >= 80 ? "Strong" :
    score >= 55 ? "Building" :
    score >= 25 ? "Early" :
    "Just started";

  const colour =
    score >= 80 ? "bg-green-400" :
    score >= 55 ? "bg-[var(--accent)]" :
    score >= 25 ? "bg-yellow-400" :
    "bg-[var(--ink-faint)]";

  const weakest = signals
    .slice()
    .sort((a, b) => (a.score / a.max) - (b.score / b.max))[0];

  return { score, label, colour, signals, weakest };
}
