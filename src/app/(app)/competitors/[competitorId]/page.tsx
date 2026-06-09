import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/auth/org";
import type {
  CompetitorBattleCard,
  EvidenceClassification,
  EvidenceSentiment,
  TrustScope,
} from "@/types/database";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BattleCardEditableFields, DigestRefreshButton } from "./DigestRefreshButton";

type CompetitorDetail = {
  id: string;
  name: string;
  slug: string;
  website: string | null;
  positioning: string | null;
  known_strengths: string | null;
  known_gaps: string | null;
  last_researched: string | null;
  digest: string | null;
  digest_updated_at: string | null;
  battle_card: CompetitorBattleCard | null;
};

type JoinedEvidence = {
  id: string;
  content: string;
  summary: string | null;
  classification: EvidenceClassification | null;
  sentiment: EvidenceSentiment | null;
  trust_scope: TrustScope;
  metadata: Record<string, unknown>;
  project_id: string;
  source_id: string;
  created_at: string;
};

type EvidenceMention = JoinedEvidence & {
  project_name: string | null;
  source_title: string | null;
};

type EvidenceEntityRow = {
  evidence: JoinedEvidence | JoinedEvidence[] | null;
};

interface Props {
  params: { competitorId: string };
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function websiteUrl(value: string) {
  return value.startsWith("http://") || value.startsWith("https://")
    ? value
    : `https://${value}`;
}

function formatDate(value: string | null) {
  if (!value) return null;

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function relativeDate(value: string | null) {
  if (!value) return null;

  const diffMs = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(diffMs / 60_000));

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  return formatDate(value);
}

function speakerLabel(metadata: Record<string, unknown>) {
  return typeof metadata.speaker === "string" && metadata.speaker.trim()
    ? metadata.speaker.trim()
    : null;
}

function TrustBadge({ trustScope }: { trustScope: TrustScope }) {
  const classes =
    trustScope === "trusted"
      ? "border-green-500/20 bg-green-500/10 text-green-300"
      : trustScope === "pending"
        ? "border-yellow-500/20 bg-yellow-500/10 text-yellow-300"
        : trustScope === "disputed"
          ? "border-[var(--accent)]/30 bg-[var(--accent)]/10 text-[var(--accent)]"
          : "border-red-500/20 bg-red-500/10 text-red-300";

  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${classes}`}>
      {trustScope}
    </span>
  );
}

function ClassificationBadge({ classification }: { classification: EvidenceClassification | null }) {
  if (!classification) return null;

  const classes =
    classification === "insight"
      ? "border-[var(--accent)]/30 bg-[var(--accent)]/10 text-[var(--accent)]"
      : classification === "verbatim"
        ? "border-blue-500/25 bg-blue-500/10 text-blue-300"
        : classification === "data_point"
          ? "border-cyan-500/25 bg-cyan-500/10 text-cyan-300"
          : "border-amber-500/25 bg-amber-500/10 text-amber-300";

  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${classes}`}>
      {classification.replace("_", " ")}
    </span>
  );
}

function SentimentIndicator({ sentiment }: { sentiment: EvidenceSentiment | null }) {
  if (!sentiment) return null;

  const classes =
    sentiment === "positive"
      ? "bg-green-400"
      : sentiment === "negative"
        ? "bg-red-400"
        : sentiment === "mixed"
          ? "bg-yellow-400"
          : "bg-[var(--ink-faint)]";

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--ink-2)]">
      <span className={`h-1.5 w-1.5 rounded-full ${classes}`} />
      {sentiment}
    </span>
  );
}

function ReadOnlyBattleCardField({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-[var(--ink)]">{label}</h3>
        <span className="rounded-full border border-[var(--line)] px-2 py-0.5 text-xs font-medium text-[var(--ink-faint)]">
          AI
        </span>
      </div>
      {value?.trim() ? (
        <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--ink-2)]">{value}</p>
      ) : (
        <p className="text-sm leading-6 text-[var(--ink-faint)]">Not generated yet.</p>
      )}
    </div>
  );
}

function PositionField({ label, value }: { label: string; value: string | null }) {
  if (!value?.trim()) return null;

  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
        {label}
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--ink-2)]">{value}</p>
    </div>
  );
}

function EvidenceCard({ evidence }: { evidence: EvidenceMention }) {
  const speaker = speakerLabel(evidence.metadata);
  const preview = evidence.summary ?? `${evidence.content.slice(0, 200)}${evidence.content.length > 200 ? "..." : ""}`;

  return (
    <article className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ClassificationBadge classification={evidence.classification} />
        <SentimentIndicator sentiment={evidence.sentiment} />
        <TrustBadge trustScope={evidence.trust_scope} />
      </div>
      <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--ink)]">{preview}</p>
      <div className="mt-4 flex flex-wrap gap-2 text-xs text-[var(--ink-faint)]">
        {speaker && <span>{speaker}</span>}
        {evidence.project_name && (
          <Link
            href={`/projects/${evidence.project_id}`}
            className="text-[var(--accent)] transition-colors hover:text-[var(--ink)]"
          >
            {evidence.project_name}
          </Link>
        )}
        <Link
          href={`/projects/${evidence.project_id}/sources/${evidence.source_id}`}
          className="text-[var(--ink-2)] transition-colors hover:text-[var(--accent)]"
        >
          {evidence.source_title ?? "View source"}
        </Link>
      </div>
    </article>
  );
}

async function loadCompetitorDetail(orgId: string, competitorId: string) {
  const supabase = await createClient();

  const [competitorResult, evidenceResult] = await Promise.all([
    supabase
      .from("competitors")
      .select("*")
      .eq("org_id", orgId)
      .eq("id", competitorId)
      .single(),
    supabase
      .from("evidence_entities")
      .select(
        "evidence(id, content, summary, classification, sentiment, trust_scope, metadata, project_id, source_id, created_at)"
      )
      .eq("org_id", orgId)
      .eq("entity_type", "competitor")
      .eq("entity_id", competitorId)
      .order("created_at", { ascending: false }),
  ]);

  if (competitorResult.error || !competitorResult.data) {
    return null;
  }

  const seen = new Set<string>();
  const evidence = ((evidenceResult.data ?? []) as EvidenceEntityRow[])
    .flatMap((row) => asArray(row.evidence))
    .filter((record): record is JoinedEvidence => {
      if (!record?.id || seen.has(record.id)) return false;
      seen.add(record.id);
      return true;
    });

  const projectIds = Array.from(new Set(evidence.map((record) => record.project_id)));
  const sourceIds = Array.from(new Set(evidence.map((record) => record.source_id)));

  const [projectsResult, sourcesResult] = await Promise.all([
    projectIds.length > 0
      ? supabase
          .from("projects")
          .select("id, name")
          .eq("org_id", orgId)
          .in("id", projectIds)
      : Promise.resolve({ data: [] }),
    sourceIds.length > 0
      ? supabase
          .from("sources")
          .select("id, title")
          .eq("org_id", orgId)
          .in("id", sourceIds)
      : Promise.resolve({ data: [] }),
  ]);

  const projectNames = new Map(
    ((projectsResult.data ?? []) as { id: string; name: string }[]).map((project) => [
      project.id,
      project.name,
    ])
  );
  const sourceTitles = new Map(
    ((sourcesResult.data ?? []) as { id: string; title: string }[]).map((source) => [
      source.id,
      source.title,
    ])
  );

  return {
    competitor: competitorResult.data as CompetitorDetail,
    evidence: evidence.map((record) => ({
      ...record,
      project_name: projectNames.get(record.project_id) ?? null,
      source_title: sourceTitles.get(record.source_id) ?? null,
    })),
  };
}

export default async function CompetitorDetailPage({ params }: Props) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const orgId = await getActiveOrgId(user.id);

  if (!orgId) notFound();

  const detail = await loadCompetitorDetail(orgId, params.competitorId);

  if (!detail) notFound();

  const { competitor, evidence } = detail;
  const lastResearched = formatDate(competitor.last_researched);
  const digestUpdated = relativeDate(competitor.digest_updated_at);
  const hasPosition =
    Boolean(competitor.positioning?.trim()) ||
    Boolean(competitor.known_strengths?.trim()) ||
    Boolean(competitor.known_gaps?.trim());

  return (
    <main className="min-h-screen px-5 py-8 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <Link
          href="/competitors"
          className="mb-6 inline-flex text-sm font-medium text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]"
        >
          All competitors
        </Link>

        <section className="mb-8 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--ink-faint)]">
                Competitor profile
              </div>
              <h1 className="text-2xl font-semibold text-[var(--ink)]">{competitor.name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--ink-2)]">
                <span>{competitor.slug}</span>
                {competitor.website && (
                  <a
                    href={websiteUrl(competitor.website)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--accent)] transition-colors hover:text-[var(--ink)]"
                  >
                    {competitor.website} →
                  </a>
                )}
                {lastResearched && <span>Last updated {lastResearched}</span>}
              </div>
            </div>
            <DigestRefreshButton competitorId={competitor.id} />
          </div>
        </section>

        {competitor.digest && (
          <section className="mb-8">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-[var(--ink)]">Intelligence Brief</h2>
              {digestUpdated && (
                <p className="mt-1 text-xs text-[var(--ink-faint)]">
                  Last generated {digestUpdated}
                </p>
              )}
            </div>
            <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6">
              <p className="whitespace-pre-wrap text-sm leading-7 text-[var(--ink)]">
                {competitor.digest}
              </p>
            </div>
          </section>
        )}

        <section className="mb-8">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-[var(--ink)]">Battle Card</h2>
              <p className="mt-1 text-sm text-[var(--ink-2)]">
                Evidence-backed competitive positioning plus your field counter-message.
              </p>
            </div>
          </div>

          {competitor.battle_card ? (
            <div className="space-y-3">
              <div className="grid gap-3 lg:grid-cols-3">
                <ReadOnlyBattleCardField
                  label="Their pitch"
                  value={competitor.battle_card.their_pitch}
                />
                <ReadOnlyBattleCardField
                  label="Where they win"
                  value={competitor.battle_card.where_they_win}
                />
                <ReadOnlyBattleCardField
                  label="Their gap"
                  value={competitor.battle_card.their_gap}
                />
              </div>
              <BattleCardEditableFields
                competitorId={competitor.id}
                battleCard={competitor.battle_card}
              />
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--surface)] p-8 text-center">
              <p className="text-sm leading-6 text-[var(--ink-2)]">
                Run the intelligence digest to generate a battle card.
              </p>
            </div>
          )}
        </section>

        {hasPosition && (
          <section className="mb-8">
            <h2 className="mb-4 text-lg font-semibold text-[var(--ink)]">
              Competitive Position
            </h2>
            <div className="grid gap-3 lg:grid-cols-3">
              <PositionField label="Positioning" value={competitor.positioning} />
              <PositionField label="Where they win" value={competitor.known_strengths} />
              <PositionField label="Their gaps" value={competitor.known_gaps} />
            </div>
          </section>
        )}

        <section>
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-[var(--ink)]">
                Evidence ({evidence.length} records)
              </h2>
              <p className="mt-1 text-sm text-[var(--ink-2)]">
                Evidence linked to this competitor by the entity extraction agent.
              </p>
            </div>
          </div>

          {evidence.length === 0 ? (
            <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-12 text-center text-sm text-[var(--ink-2)]">
              No evidence collected yet. This competitor will appear here after they're mentioned in an interview.
            </div>
          ) : (
            <div className="grid gap-3">
              {evidence.map((record) => (
                <EvidenceCard key={record.id} evidence={record} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
