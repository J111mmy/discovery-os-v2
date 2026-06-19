type SupabaseLike = {
  from: (table: string) => any;
};

type StructuralFocus =
  | "topics"
  | "themes"
  | "problems"
  | "opportunities"
  | "actions"
  | "artifacts";

export type AskStructuralIntent = {
  focuses: StructuralFocus[];
  needsEvidence: boolean;
};

export type AskStructuralContext = {
  intent: AskStructuralIntent;
  text: string;
  hasData: boolean;
};

const VISIBLE_REVIEW_STATES = ["suggested", "accepted", "edited"] as const;
const VISIBLE_OPPORTUNITY_STATUSES = ["suggested", "accepted", "active"] as const;

const FOCUS_PATTERNS: Array<[StructuralFocus, RegExp]> = [
  ["topics", /\b(topic|topics|code|codes|tag|tags|label|labels)\b/i],
  ["themes", /\b(theme|themes|pattern|patterns)\b/i],
  ["problems", /\b(problem|problems|pain|pains|friction|unmet need|unmet needs)\b/i],
  ["opportunities", /\b(opportunity|opportunities|how might we|hmw|solution direction|solution directions)\b/i],
  ["actions", /\b(action|actions|todo|to-do|follow[-\s]?up|commitment|commitments)\b/i],
  ["artifacts", /\b(artifact|artifacts|document|documents|deck|decks|brief|briefs|prd|report|reports)\b/i],
];

const STRUCTURAL_VERB_RE =
  /\b(what|which|list|show|summari[sz]e|overview|breakdown|map|count|how many|status|landscape|registry|pipeline|ontology|group|groups|grouped)\b/i;
const EVIDENCE_REQUEST_RE =
  /\b(evidence|quote|quotes|source|sources|transcript|transcripts|support|supports|supporting|example|examples|said|mention|mentioned|who said|where did)\b/i;

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

function asRows<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function truncate(value: string | null | undefined, max = 180) {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function formatList(values: string[] | null | undefined) {
  return Array.isArray(values) && values.length > 0 ? values.join(", ") : "none recorded";
}

function countBy<T extends Record<string, unknown>>(rows: T[], key: keyof T) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = row[key];
    if (typeof value !== "string") continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function countFor(counts: Map<string, number>, id: string) {
  return counts.get(id) ?? 0;
}

async function scopedCount(input: {
  supabase: SupabaseLike;
  table: string;
  org_id: string;
  project_id: string;
}) {
  const { count, error } = await input.supabase
    .from(input.table)
    .select("id", { count: "exact", head: true })
    .eq("org_id", input.org_id)
    .eq("project_id", input.project_id);

  if (error) throw new Error(`Failed to count ${input.table}: ${error.message}`);
  return count ?? 0;
}

export function detectAskStructuralIntent(question: string): AskStructuralIntent | null {
  const focuses = FOCUS_PATTERNS.filter(([, pattern]) => pattern.test(question)).map(
    ([focus]) => focus
  );

  if (focuses.length === 0) return null;
  if (!STRUCTURAL_VERB_RE.test(question) && focuses.length === 1 && focuses[0] === "actions") {
    return null;
  }

  return {
    focuses: unique(focuses),
    needsEvidence: EVIDENCE_REQUEST_RE.test(question),
  };
}

export async function loadAskStructuralContext(input: {
  supabase: SupabaseLike;
  org_id: string;
  project_id: string;
  intent: AskStructuralIntent;
}): Promise<AskStructuralContext> {
  const { supabase, org_id, project_id, intent } = input;
  const wants = (focus: StructuralFocus) => intent.focuses.includes(focus);
  const lines: string[] = [
    "Project registry context. These are DiscOS app records, not raw source quotes.",
  ];
  let hasData = false;

  const countTasks = intent.focuses.map(async (focus) => {
    const table = focus === "artifacts" ? "artifacts" : focus;
    return [focus, await scopedCount({ supabase, table, org_id, project_id })] as const;
  });
  const counts = new Map(await Promise.all(countTasks));

  lines.push(
    `Counts: ${intent.focuses
      .map((focus) => `${focus}=${counts.get(focus) ?? 0}`)
      .join(", ")}.`
  );

  if (wants("topics")) {
    const { data, error } = await supabase
      .from("topics")
      .select("id, label, description, review_state, source, updated_at")
      .eq("org_id", org_id)
      .eq("project_id", project_id)
      .in("review_state", [...VISIBLE_REVIEW_STATES])
      .order("updated_at", { ascending: false })
      .limit(20);

    if (error) throw new Error(`Failed to load topics: ${error.message}`);
    const rows = asRows<{
      id: string;
      label: string;
      description: string | null;
      review_state: string;
      source: string;
    }>(data);
    hasData ||= rows.length > 0;
    lines.push("\nTOPICS / CODES:");
    lines.push(
      rows.length > 0
        ? rows.map((row, index) => `T${index + 1}. ${row.label} (${row.review_state}, ${row.source})${row.description ? `: ${truncate(row.description)}` : ""}`).join("\n")
        : "No visible topics yet."
    );
  }

  if (wants("themes")) {
    const { data, error } = await supabase
      .from("themes")
      .select(
        "id, label, description, evidence_count, central_concept, interpretation, status, review_state, confidence"
      )
      .eq("org_id", org_id)
      .eq("project_id", project_id)
      .in("review_state", [...VISIBLE_REVIEW_STATES])
      .order("evidence_count", { ascending: false })
      .limit(20);

    if (error) throw new Error(`Failed to load themes: ${error.message}`);
    const rows = asRows<{
      id: string;
      label: string;
      description: string | null;
      evidence_count: number | null;
      central_concept: string | null;
      interpretation: string | null;
      status: string | null;
      review_state: string | null;
      confidence: string | null;
    }>(data);
    const themeIds = rows.map((row) => row.id);
    const [evidenceLinksResult, topicLinksResult] = await Promise.all([
      themeIds.length > 0
        ? supabase
            .from("theme_evidence")
            .select("theme_id")
            .eq("org_id", org_id)
            .eq("project_id", project_id)
            .in("theme_id", themeIds)
            .in("review_state", [...VISIBLE_REVIEW_STATES])
        : Promise.resolve({ data: [], error: null }),
      themeIds.length > 0
        ? supabase
            .from("theme_topics")
            .select("theme_id")
            .eq("org_id", org_id)
            .eq("project_id", project_id)
            .in("theme_id", themeIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (evidenceLinksResult.error) {
      throw new Error(`Failed to load theme evidence links: ${evidenceLinksResult.error.message}`);
    }
    if (topicLinksResult.error) {
      throw new Error(`Failed to load theme topic links: ${topicLinksResult.error.message}`);
    }

    const evidenceCounts = countBy(asRows<{ theme_id: string }>(evidenceLinksResult.data), "theme_id");
    const topicCounts = countBy(asRows<{ theme_id: string }>(topicLinksResult.data), "theme_id");

    hasData ||= rows.length > 0;
    lines.push("\nTHEMES:");
    lines.push(
      rows.length > 0
        ? rows
            .map((row, index) => {
              const concept = row.central_concept ?? row.description ?? row.interpretation;
              return `TH${index + 1}. ${row.label} (${row.status ?? "draft"}, ${row.review_state ?? "suggested"}, confidence ${row.confidence ?? "unknown"}, ${countFor(evidenceCounts, row.id) || row.evidence_count || 0} evidence links, ${countFor(topicCounts, row.id)} topic links): ${truncate(concept)}`;
            })
            .join("\n")
        : "No visible themes yet."
    );
  }

  if (wants("problems")) {
    const { data, error } = await supabase
      .from("problems")
      .select(
        "id, title, description, statement, status, severity, confidence, review_state, who_affected, what_is_hard, why_it_matters, current_workarounds, current_tools, created_at"
      )
      .eq("org_id", org_id)
      .eq("project_id", project_id)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) throw new Error(`Failed to load problems: ${error.message}`);
    const rows = asRows<{
      id: string;
      title: string;
      description: string | null;
      statement: string | null;
      status: string | null;
      severity: string | null;
      confidence: string | null;
      review_state: string | null;
      who_affected: string | null;
      what_is_hard: string | null;
      why_it_matters: string | null;
      current_workarounds: string[] | null;
      current_tools: string[] | null;
    }>(data);
    const problemIds = rows.map((row) => row.id);
    const [evidenceLinksResult, themeLinksResult, topicLinksResult] = await Promise.all([
      problemIds.length > 0
        ? supabase
            .from("problem_evidence")
            .select("problem_id")
            .eq("org_id", org_id)
            .eq("project_id", project_id)
            .in("problem_id", problemIds)
            .in("review_state", [...VISIBLE_REVIEW_STATES])
        : Promise.resolve({ data: [], error: null }),
      problemIds.length > 0
        ? supabase
            .from("problem_themes")
            .select("problem_id")
            .eq("org_id", org_id)
            .eq("project_id", project_id)
            .in("problem_id", problemIds)
            .in("review_state", [...VISIBLE_REVIEW_STATES])
        : Promise.resolve({ data: [], error: null }),
      problemIds.length > 0
        ? supabase
            .from("problem_topics")
            .select("problem_id")
            .eq("org_id", org_id)
            .eq("project_id", project_id)
            .in("problem_id", problemIds)
            .in("review_state", [...VISIBLE_REVIEW_STATES])
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (evidenceLinksResult.error) {
      throw new Error(`Failed to load problem evidence links: ${evidenceLinksResult.error.message}`);
    }
    if (themeLinksResult.error) {
      throw new Error(`Failed to load problem theme links: ${themeLinksResult.error.message}`);
    }
    if (topicLinksResult.error) {
      throw new Error(`Failed to load problem topic links: ${topicLinksResult.error.message}`);
    }

    const evidenceCounts = countBy(asRows<{ problem_id: string }>(evidenceLinksResult.data), "problem_id");
    const themeCounts = countBy(asRows<{ problem_id: string }>(themeLinksResult.data), "problem_id");
    const topicCounts = countBy(asRows<{ problem_id: string }>(topicLinksResult.data), "problem_id");

    hasData ||= rows.length > 0;
    lines.push("\nPROBLEMS:");
    lines.push(
      rows.length > 0
        ? rows
            .map((row, index) => {
              const statement = row.statement ?? row.description;
              return [
                `P${index + 1}. ${row.title} (${row.status ?? "surfaced"}, ${row.severity ?? "severity unknown"}, confidence ${row.confidence ?? "unknown"}, ${countFor(evidenceCounts, row.id)} evidence links, ${countFor(themeCounts, row.id)} theme links, ${countFor(topicCounts, row.id)} topic links)`,
                statement ? `   Statement: ${truncate(statement)}` : null,
                row.who_affected ? `   Who: ${truncate(row.who_affected)}` : null,
                row.what_is_hard ? `   Hard part: ${truncate(row.what_is_hard)}` : null,
                row.why_it_matters ? `   Why it matters: ${truncate(row.why_it_matters)}` : null,
                `   Current tools: ${formatList(row.current_tools)}`,
                `   Workarounds: ${formatList(row.current_workarounds)}`,
              ].filter(Boolean).join("\n");
            })
            .join("\n")
        : "No visible problems yet."
    );
  }

  if (wants("opportunities")) {
    const { data, error } = await supabase
      .from("opportunities")
      .select("id, title, description, how_might_we, status, confidence, review_state, updated_at")
      .eq("org_id", org_id)
      .eq("project_id", project_id)
      .in("status", [...VISIBLE_OPPORTUNITY_STATUSES])
      .in("review_state", [...VISIBLE_REVIEW_STATES])
      .order("updated_at", { ascending: false })
      .limit(20);

    if (error) throw new Error(`Failed to load opportunities: ${error.message}`);
    const rows = asRows<{
      id: string;
      title: string;
      description: string | null;
      how_might_we: string | null;
      status: string;
      confidence: string;
      review_state: string;
    }>(data);
    const opportunityIds = rows.map((row) => row.id);
    const [problemLinksResult, evidenceLinksResult, themeLinksResult] = await Promise.all([
      opportunityIds.length > 0
        ? supabase
            .from("problem_opportunities")
            .select("opportunity_id")
            .eq("org_id", org_id)
            .eq("project_id", project_id)
            .in("opportunity_id", opportunityIds)
            .in("review_state", [...VISIBLE_REVIEW_STATES])
        : Promise.resolve({ data: [], error: null }),
      opportunityIds.length > 0
        ? supabase
            .from("opportunity_evidence")
            .select("opportunity_id")
            .eq("org_id", org_id)
            .eq("project_id", project_id)
            .in("opportunity_id", opportunityIds)
        : Promise.resolve({ data: [], error: null }),
      opportunityIds.length > 0
        ? supabase
            .from("opportunity_themes")
            .select("opportunity_id")
            .eq("org_id", org_id)
            .eq("project_id", project_id)
            .in("opportunity_id", opportunityIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (problemLinksResult.error) {
      throw new Error(`Failed to load opportunity problem links: ${problemLinksResult.error.message}`);
    }
    if (evidenceLinksResult.error) {
      throw new Error(`Failed to load opportunity evidence links: ${evidenceLinksResult.error.message}`);
    }
    if (themeLinksResult.error) {
      throw new Error(`Failed to load opportunity theme links: ${themeLinksResult.error.message}`);
    }

    const problemCounts = countBy(asRows<{ opportunity_id: string }>(problemLinksResult.data), "opportunity_id");
    const evidenceCounts = countBy(asRows<{ opportunity_id: string }>(evidenceLinksResult.data), "opportunity_id");
    const themeCounts = countBy(asRows<{ opportunity_id: string }>(themeLinksResult.data), "opportunity_id");

    hasData ||= rows.length > 0;
    lines.push("\nOPPORTUNITIES:");
    lines.push(
      rows.length > 0
        ? rows
            .map((row, index) => {
              const framing = row.how_might_we ?? row.description;
              return `O${index + 1}. ${row.title} (${row.status}, confidence ${row.confidence}, ${countFor(problemCounts, row.id)} problem links, ${countFor(evidenceCounts, row.id)} evidence links, ${countFor(themeCounts, row.id)} theme links): ${truncate(framing)}`;
            })
            .join("\n")
        : "No visible opportunities yet."
    );
  }

  if (wants("actions")) {
    const { data, error } = await supabase
      .from("actions")
      .select("id, description, owner, due_note, status, created_at")
      .eq("org_id", org_id)
      .eq("project_id", project_id)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) throw new Error(`Failed to load actions: ${error.message}`);
    const rows = asRows<{
      description: string;
      owner: string | null;
      due_note: string | null;
      status: string;
    }>(data);
    hasData ||= rows.length > 0;
    lines.push("\nACTIONS:");
    lines.push(
      rows.length > 0
        ? rows
            .map(
              (row, index) =>
                `A${index + 1}. ${truncate(row.description)} (${row.status}, owner ${row.owner ?? "unassigned"}, due ${row.due_note ?? "not set"})`
            )
            .join("\n")
        : "No actions yet."
    );
  }

  if (wants("artifacts")) {
    const { data, error } = await supabase
      .from("artifacts")
      .select("id, title, type, verification_status, created_at, updated_at")
      .eq("org_id", org_id)
      .eq("project_id", project_id)
      .order("updated_at", { ascending: false })
      .limit(20);

    if (error) throw new Error(`Failed to load artifacts: ${error.message}`);
    const rows = asRows<{
      title: string;
      type: string;
      verification_status: string;
    }>(data);
    hasData ||= rows.length > 0;
    lines.push("\nARTIFACTS:");
    lines.push(
      rows.length > 0
        ? rows
            .map(
              (row, index) =>
                `AR${index + 1}. ${row.title} (${row.type}, verification ${row.verification_status})`
            )
            .join("\n")
        : "No artifacts yet."
    );
  }

  return {
    intent,
    text: lines.join("\n"),
    hasData,
  };
}
