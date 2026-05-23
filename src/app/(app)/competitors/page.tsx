import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { redirect } from "next/navigation";

type CompetitorRow = {
  id: string;
  name: string;
  slug: string;
  website: string | null;
  positioning: string | null;
  known_strengths: string | null;
  known_gaps: string | null;
  last_researched: string | null;
  digest_updated_at: string | null;
  evidence_count: number;
};

function formatDate(value: string | null) {
  if (!value) return null;

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function websiteUrl(value: string) {
  return value.startsWith("http://") || value.startsWith("https://")
    ? value
    : `https://${value}`;
}

export default async function CompetitorsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", user.id)
    .order("joined_at", { ascending: true })
    .limit(1)
    .single();

  const orgId = membership?.org_id;
  const { data: competitors } = orgId
    ? await supabase
        .from("competitors")
        .select("id, name, slug, website, positioning, known_strengths, known_gaps, last_researched, digest_updated_at")
        .eq("org_id", orgId)
        .order("name", { ascending: true })
    : { data: [] };

  const competitorRows = (competitors ?? []) as Omit<CompetitorRow, "evidence_count">[];
  const competitorIds = competitorRows.map((competitor) => competitor.id);
  const { data: evidenceLinks } =
    orgId && competitorIds.length > 0
      ? await supabase
          .from("evidence_entities")
          .select("entity_id")
          .eq("org_id", orgId)
          .eq("entity_type", "competitor")
          .in("entity_id", competitorIds)
      : { data: [] };

  const evidenceCounts = new Map<string, number>();
  (evidenceLinks ?? []).forEach((link) => {
    const entityId = (link as { entity_id: string | null }).entity_id;
    if (!entityId) return;
    evidenceCounts.set(entityId, (evidenceCounts.get(entityId) ?? 0) + 1);
  });

  const rows: CompetitorRow[] = competitorRows.map((competitor) => ({
    ...competitor,
    evidence_count: evidenceCounts.get(competitor.id) ?? 0,
  }));

  return (
    <main className="min-h-screen px-5 py-8 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-[var(--ink)]">Competitors</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            Competitive signals surfaced across your research.
          </p>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-12 text-center text-sm text-[var(--ink-muted)]">
            No competitors tracked yet. Competitors mentioned in research are surfaced automatically during ingest.
          </div>
        ) : (
          <div className="grid gap-3">
            {rows.map((competitor) => {
              const researchedAt = formatDate(competitor.last_researched);

              return (
                <article
                  key={competitor.id}
                  className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <Link
                        href={`/competitors/${competitor.id}`}
                        className="font-semibold text-[var(--ink)] transition-colors hover:text-[var(--brand)]"
                      >
                        {competitor.name}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--ink-muted)]">
                        {competitor.website && (
                          <a
                            href={websiteUrl(competitor.website)}
                            target="_blank"
                            rel="noreferrer"
                            className="transition-colors hover:text-[var(--brand)]"
                          >
                            {competitor.website}
                          </a>
                        )}
                        {researchedAt && <span>Last researched {researchedAt}</span>}
                        {competitor.digest_updated_at && <span>Digest generated</span>}
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap gap-2">
                      <span className="rounded-full border border-[var(--border)] bg-[var(--surface-0)] px-2.5 py-1 text-xs font-medium text-[var(--ink-muted)]">
                        {competitor.evidence_count} evidence
                      </span>
                      <span className="rounded-full border border-[var(--border)] bg-[var(--surface-0)] px-2.5 py-1 text-xs font-medium text-[var(--ink-muted)]">
                        {competitor.slug}
                      </span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
