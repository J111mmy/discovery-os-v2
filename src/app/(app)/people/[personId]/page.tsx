import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/auth/org";
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
import { PersonProfileEditor } from "./person-profile-editor";

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

function digestDateLabel(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function EvidenceCard({ evidence }: { evidence: EvidenceMention }) {
  return (
    <article className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ClassificationBadge classification={evidence.classification} />
        <SentimentIndicator sentiment={evidence.sentiment} />
        <TrustBadge trustScope={evidence.trust_scope} />
      </div>
      <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--ink)]">
        {evidence.content}
      </p>
      {evidence.summary && (
        <p className="mt-3 text-sm leading-6 text-[var(--ink-2)]">{evidence.summary}</p>
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

  const orgId = await getActiveOrgId(user.id);

  if (!orgId) notFound();
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
          className="mb-6 inline-flex text-sm font-medium text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]"
        >
          ← All people
        </Link>

        <section className="mb-8 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <PersonProfileEditor
            person={personRow}
            companyLink={
              company ? (
                <Link
                  href={`/companies/${company.id}`}
                  className="inline-flex text-sm font-medium text-[var(--accent)] transition-colors hover:text-[var(--ink)]"
                >
                  {company.name}
                </Link>
              ) : null
            }
            projectLinks={
              projectLinks.length > 0 ? (
              <div className="flex flex-wrap gap-2 sm:justify-end">
                {projectLinks.map((relation) => (
                  <Link
                    key={relation.project_id}
                    href={`/projects/${relation.project_id}`}
                    className="rounded-full border border-[var(--line)] bg-[var(--bg)] px-2.5 py-1 text-xs font-medium text-[var(--ink-2)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                  >
                    {projectName(relation.projects)}
                  </Link>
                ))}
              </div>
              ) : null
            }
          />

          <div className="mt-5 border-t border-[var(--line)] pt-5">
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
            <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6">
              <p className="whitespace-pre-wrap text-sm leading-7 text-[var(--ink)]">
                {personRow.digest}
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--surface)] p-8 text-center">
              <p className="text-sm leading-6 text-[var(--ink-2)]">
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
              <p className="mt-1 text-sm text-[var(--ink-2)]">
                Evidence linked to this person by the entity extraction agent.
              </p>
            </div>
            <span className="rounded-full border border-[var(--line)] px-2.5 py-1 text-xs font-medium text-[var(--ink-2)]">
              {evidence.length} mentions
            </span>
          </div>

          {evidence.length === 0 ? (
            <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-12 text-center text-sm text-[var(--ink-2)]">
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
