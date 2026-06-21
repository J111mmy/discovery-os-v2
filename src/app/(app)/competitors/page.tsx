import { createClient } from "@/lib/supabase/server";
import { getOrgScopedReadForUser } from "@/lib/auth/support-read";
import { redirect } from "next/navigation";
import { DirectoryList, type DirectoryItem } from "@/app/(app)/components/DirectoryList";

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

export default async function CompetitorsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const read = await getOrgScopedReadForUser(user.id, supabase);
  const { data: competitors } = read
    ? await read
        .from("competitors")
        .select(
          "id, name, slug, website, positioning, known_strengths, known_gaps, last_researched, digest_updated_at"
        )
        .order("name", { ascending: true })
    : { data: [] };

  const competitorRows = (competitors ?? []) as Omit<CompetitorRow, "evidence_count">[];
  const competitorIds = competitorRows.map((c) => c.id);

  const { data: evidenceLinks } =
    read && competitorIds.length > 0
      ? await read
          .from("evidence_entities")
          .select("entity_id")
          .eq("entity_type", "competitor")
          .in("entity_id", competitorIds)
      : { data: [] };

  const evidenceCounts = new Map<string, number>();
  ((evidenceLinks ?? []) as Array<{ entity_id: string | null }>).forEach((link) => {
    const entityId = link.entity_id;
    if (!entityId) return;
    evidenceCounts.set(entityId, (evidenceCounts.get(entityId) ?? 0) + 1);
  });

  const rows: CompetitorRow[] = competitorRows.map((c) => ({
    ...c,
    evidence_count: evidenceCounts.get(c.id) ?? 0,
  }));

  const items: DirectoryItem[] = rows.map((competitor) => {
    const researchedAt = formatDate(competitor.last_researched);

    const subtitleParts = [
      competitor.website,
      researchedAt ? `Researched ${researchedAt}` : null,
    ].filter(Boolean);

    const meta =
      competitor.evidence_count > 0
        ? `${competitor.evidence_count} mention${competitor.evidence_count !== 1 ? "s" : ""}`
        : null;

    // Compose a short detail blurb for the drawer
    const detail =
      competitor.positioning ||
      [competitor.known_strengths, competitor.known_gaps]
        .filter(Boolean)
        .join(" · ") ||
      null;

    return {
      id: competitor.id,
      name: competitor.name,
      subtitle: subtitleParts.join(" · ") || null,
      meta,
      projectLinks: [],
      detailHref: `/competitors/${competitor.id}`,
      detail,
      evidenceCount: competitor.evidence_count,
      kind: "competitor" as const,
    };
  });

  return (
    <DirectoryList
      title="Competitors"
      lead="Competitive signals surfaced across your research."
      searchPlaceholder="Search competitors…"
      items={items}
      emptyMessage="No competitors tracked yet. Competitors mentioned in research are surfaced automatically during ingest."
    />
  );
}
