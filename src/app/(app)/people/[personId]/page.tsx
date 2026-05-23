import { createClient } from "@/lib/supabase/server";
import type {
  Affiliation,
  EvidenceClassification,
  EvidenceSentiment,
  PersonStatus,
  TrustScope,
} from "@/types/database";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AffiliationToggle } from "./affiliation-toggle";
import { DigestRefreshButton } from "./digest-refresh-button";

type ProjectRelation = {
  project_id: string;
  projects: { name: string } | { name: string }[] | null;
};

type CompanyRelation = { id: string; name: string } | { id: string; name: string }[] | null;

type PersonDetail = {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  affiliation: Affiliation;
  status: PersonStatus;
  company_id: string | null;
  companies: CompanyRelation;
  digest: string | null;
  digest_updated_at: string | null;
  person_projects: ProjectRelation[] | ProjectRelation | null;
};

type EvidenceMention = {
  id: string;
  content: string;
  summary: string | null;
  classification: EvidenceClassification | null;
  sentiment: EvidenceSentiment | null;
  trust_scope: TrustScope;
  source_id: string;
};

type EvidenceEntityRow = {
  evidence: EvidenceMention | EvidenceMention[] | null;
};

interface Props {
  params: { personId: string };
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function projectName(projects: ProjectRelation["projects"]) {
  const project = Array.isArray(projects) ? projects[0] : projects;
  return project?.name ?? "Project";
}

function companyRelation(company: CompanyRelation) {
  return Array.isArray(company) ? company[0] ?? null : company;
}

function TrustBadge({ trustScope }: { trustScope: TrustScope }) {
  const classes =
    trustScope === "trusted"
      ? "border-green-500/20 bg-green-500/10 text-green-300"
      : trustScope === "pending"
      ? "border-yellow-500/20 bg-yellow-500/10 text-yellow-300"
      : trustScope === "disputed"
      ? "border-[var(--brand)]/30 bg-[var(--brand)]/10 text-[var(--brand)]"
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
      ? "border-[var(--brand)]/30 bg-[var(--brand)]/10 text-[var(--brand)]"
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
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--ink-muted)]">
      <span className={`h-1.5 w-1.5 rounded-full ${classes}`} />
      {sentiment}
    </span>
  );
}

function StatusBadge({ status }: { status: PersonStatus }) {
  const label = status.replace(/-/g, " ");

  return (
    <span className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-xs font-medium capitalize text-[var(--ink-muted)]">
      {label}
    </span>
  );
}

function digestDateLabel(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function EvidenceCard({ evidence }: { evidence: EvidenceMention }) {
  return (
    <article className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ClassificationBadge classification={evidence.classification} />
        <SentimentIndicator sentiment={evidence.sentiment} />
        <TrustBadge trustScope={evidence.trust_scope} />
      </div>
      <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--ink)]">
        {evidence.content}
      </p>
      {evidence.summary && (
        <p className="mt-3 text-sm leading-6 text-[var(--ink-muted)]">{evidence.summary}</p>
      )}
    </article>
  );
}

export default async function PersonDetailPage({ params }: Props) {
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

  if (!membership?.org_id) notFound();

  const orgId = membership.org_id;
  const [{ data: person }, { data: entityRows }] = await Promise.all([
    supabase
      .from("people")
      .select("id, name, role, email, affiliation, status, company_id, companies(id, name), digest, digest_updated_at, person_projects(project_id, projects(name))")
      .eq("org_id", orgId)
      .eq("id", params.personId)
      .single(),
    supabase
      .from("evidence_entities")
      .select("evidence(id, content, summary, classification, sentiment, trust_scope, source_id)")
      .eq("org_id", orgId)
      .eq("entity_type", "person")
      .eq("entity_id", params.personId),
  ]);

  if (!person) notFound();

  const personRow = person as PersonDetail;
  const projectLinks = asArray(personRow.person_projects);
  const company = companyRelation(personRow.companies);
  const evidence = ((entityRows ?? []) as EvidenceEntityRow[])
    .flatMap((row) => asArray(row.evidence))
    .filter((row): row is EvidenceMention => Boolean(row));

  return (
    <main className="min-h-screen px-5 py-8 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <Link
          href="/people"
          className="mb-6 inline-flex text-sm font-medium text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]"
        >
          ← All people
        </Link>

        <section className="mb-8 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <StatusBadge status={personRow.status} />
                {personRow.affiliation === "internal" && (
                  <span className="rounded-full border border-yellow-500/20 bg-yellow-500/10 px-2 py-0.5 text-xs font-medium text-yellow-300">
                    Internal
                  </span>
                )}
              </div>
              <h1 className="text-2xl font-semibold text-[var(--ink)]">{personRow.name}</h1>
              {(personRow.role || personRow.email) && (
                <p className="mt-2 text-sm text-[var(--ink-muted)]">
                  {[personRow.role, personRow.email].filter(Boolean).join(" · ")}
                </p>
              )}
              {company && (
                <Link
                  href={`/companies/${company.id}`}
                  className="mt-2 inline-flex text-sm font-medium text-[var(--brand)] transition-colors hover:text-[var(--ink)]"
                >
                  {company.name}
                </Link>
              )}
            </div>
            {projectLinks.length > 0 && (
              <div className="flex flex-wrap gap-2 sm:justify-end">
                {projectLinks.map((relation) => (
                  <Link
                    key={relation.project_id}
                    href={`/projects/${relation.project_id}`}
                    className="rounded-full border border-[var(--border)] bg-[var(--surface-0)] px-2.5 py-1 text-xs font-medium text-[var(--ink-muted)] transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)]"
                  >
                    {projectName(relation.projects)}
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="mt-5 border-t border-[var(--border)] pt-5">
            <AffiliationToggle
              personId={personRow.id}
              initialAffiliation={personRow.affiliation}
            />
          </div>
        </section>

        <section className="mb-8">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-[var(--ink)]">Intelligence brief</h2>
              {personRow.digest_updated_at && (
                <p className="mt-1 text-xs text-[var(--ink-faint)]">
                  Last generated {digestDateLabel(personRow.digest_updated_at)}
                </p>
              )}
            </div>
            <DigestRefreshButton personId={personRow.id} />
          </div>

          {personRow.digest ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-6">
              <p className="whitespace-pre-wrap text-sm leading-7 text-[var(--ink)]">
                {personRow.digest}
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-1)] p-8 text-center">
              <p className="text-sm leading-6 text-[var(--ink-muted)]">
                No digest yet. Digests are generated automatically after ingest once this person has
                enough linked evidence. You can also generate one now.
              </p>
            </div>
          )}
        </section>

        <section>
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-[var(--ink)]">Evidence mentions</h2>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                Evidence linked to this person by the entity extraction agent.
              </p>
            </div>
            <span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--ink-muted)]">
              {evidence.length} mentions
            </span>
          </div>

          {evidence.length === 0 ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-12 text-center text-sm text-[var(--ink-muted)]">
              No linked evidence mentions yet.
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
