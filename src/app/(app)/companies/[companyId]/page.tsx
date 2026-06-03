import type { EvidenceClassification, EvidenceSentiment, PersonStatus, TrustScope } from "@/types/database";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CompanyProfileEditor } from "./company-profile-editor";
import { DigestRefreshButton } from "./digest-refresh-button";

interface Props {
  params: { companyId: string };
}

type CompanyDetail = {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  size: string | null;
  notes: string | null;
  digest: string | null;
  digest_updated_at: string | null;
};

type CompanyPerson = {
  id: string;
  name: string;
  role: string | null;
  status: PersonStatus | null;
  email: string | null;
};

type CompanyProject = {
  id: string;
  name: string;
};

type CompanyEvidence = {
  id: string;
  content: string;
  summary: string | null;
  classification: EvidenceClassification | null;
  sentiment: EvidenceSentiment | null;
  trust_scope: TrustScope;
  metadata: Record<string, unknown>;
  project_id: string;
  project_name: string | null;
  source_id: string;
  source_title: string | null;
  created_at: string;
};

type CompanyDetailPayload = {
  company: CompanyDetail;
  people: CompanyPerson[];
  projects: CompanyProject[];
  evidence: CompanyEvidence[];
};

async function fetchCompanyDetail(companyId: string) {
  const requestHeaders = headers();
  const host = requestHeaders.get("host");
  if (!host) notFound();

  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  const response = await fetch(`${protocol}://${host}/api/companies/${companyId}`, {
    cache: "no-store",
    headers: {
      cookie: requestHeaders.get("cookie") ?? "",
    },
  });

  if (response.status === 401) redirect("/login");
  if (response.status === 404) notFound();
  if (!response.ok) {
    throw new Error("Could not load company detail.");
  }

  return (await response.json()) as CompanyDetailPayload;
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function StatusBadge({ status }: { status: PersonStatus | null }) {
  return (
    <span className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-xs font-medium capitalize text-[var(--ink-muted)]">
      {status ? status.replace(/-/g, " ") : "unknown"}
    </span>
  );
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

function speakerLabel(metadata: Record<string, unknown>) {
  return typeof metadata.speaker === "string" && metadata.speaker.trim()
    ? metadata.speaker.trim()
    : null;
}

function EvidenceCard({ evidence }: { evidence: CompanyEvidence }) {
  const speaker = speakerLabel(evidence.metadata);

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
      <div className="mt-4 flex flex-wrap gap-2 text-xs text-[var(--ink-faint)]">
        {speaker && <span>{speaker}</span>}
        {evidence.source_title && <span>{evidence.source_title}</span>}
        {evidence.project_name && (
          <Link
            href={`/projects/${evidence.project_id}`}
            className="text-[var(--brand)] transition-colors hover:text-[var(--ink)]"
          >
            {evidence.project_name}
          </Link>
        )}
      </div>
    </article>
  );
}

export default async function CompanyDetailPage({ params }: Props) {
  const { company, people, projects, evidence } = await fetchCompanyDetail(params.companyId);

  return (
    <main className="min-h-screen px-5 py-8 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <Link
          href="/companies"
          className="mb-6 inline-flex text-sm font-medium text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]"
        >
          All companies
        </Link>

        <CompanyProfileEditor company={company} />

        <section className="mb-8">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-[var(--ink)]">Intelligence brief</h2>
              {company.digest_updated_at && (
                <p className="mt-1 text-xs text-[var(--ink-faint)]">
                  Last generated {dateLabel(company.digest_updated_at)}
                </p>
              )}
            </div>
            <DigestRefreshButton companyId={company.id} />
          </div>

          {company.digest ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-6">
              <p className="whitespace-pre-wrap text-sm leading-7 text-[var(--ink)]">
                {company.digest}
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-1)] p-8 text-center">
              <p className="text-sm leading-6 text-[var(--ink-muted)]">
                No digest yet. Digests generate automatically after evidence accumulates from this
                company. You can also generate one now.
              </p>
            </div>
          )}
        </section>

        <section className="mb-8">
          <h2 className="mb-4 text-lg font-semibold text-[var(--ink)]">
            People ({people.length})
          </h2>
          {people.length === 0 ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-8 text-center text-sm text-[var(--ink-muted)]">
              No named contacts yet.
            </div>
          ) : (
            <div className="grid gap-2">
              {people.map((person) => (
                <Link
                  key={person.id}
                  href={`/people/${person.id}`}
                  className="flex items-center justify-between gap-4 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-4 py-3 transition-colors hover:border-[var(--brand)]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--ink)]">{person.name}</p>
                    {(person.role || person.email) && (
                      <p className="mt-1 truncate text-xs text-[var(--ink-muted)]">
                        {[person.role, person.email].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </div>
                  <StatusBadge status={person.status} />
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold text-[var(--ink)]">Projects</h2>
          {projects.length === 0 ? (
            <p className="text-sm text-[var(--ink-muted)]">Not linked to any projects yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {projects.map((project) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="rounded-full border border-[var(--border)] px-3 py-1 text-sm text-[var(--ink-muted)] transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)]"
                >
                  {project.name}
                </Link>
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-[var(--ink)]">Recent evidence</h2>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                Evidence linked to this company by the entity extraction agent.
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
