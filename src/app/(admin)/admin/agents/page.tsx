// /admin/agents - read-only catalog of registered AI jobs and their boundaries.
import Link from "next/link";
import {
  AGENT_CATEGORY_ORDER,
  AGENT_REGISTRY,
  type AgentCategory,
  type AgentRegistryItem,
} from "@/lib/admin/agent-registry";

function groupAgents(): Array<{ category: AgentCategory; agents: AgentRegistryItem[] }> {
  return AGENT_CATEGORY_ORDER.map((category) => ({
    category,
    agents: AGENT_REGISTRY.filter((agent) => agent.category === category),
  })).filter((group) => group.agents.length > 0);
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1 text-xs font-medium text-[var(--ink-2)]">
      {children}
    </span>
  );
}

function DetailList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
        {title}
      </div>
      <ul className="mt-2 space-y-1 text-sm text-[var(--ink-2)]">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[var(--ink-faint)]" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AgentInteractionMap() {
  const handoffs = AGENT_REGISTRY.flatMap((agent) =>
    agent.handoffs.map((handoff) => ({
      from: agent,
      handoff,
      to: AGENT_REGISTRY.find((candidate) => candidate.id === handoff.agentId),
    }))
  );

  return (
    <section className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-[var(--ink)]">Interaction map</h2>
          <p className="mt-1 max-w-3xl text-sm text-[var(--ink-2)]">
            The main handoffs between agents, including the event that carries
            work forward and the condition that causes the handoff.
          </p>
        </div>
        <span className="rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-3 py-1 text-xs font-medium text-[var(--ink-2)]">
          {handoffs.length} handoffs
        </span>
      </div>

      <div className="mt-5 space-y-3">
        {handoffs.map(({ from, handoff, to }) => (
          <div
            key={`${from.id}-${handoff.event}-${handoff.agentId}`}
            className="grid gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-4 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center"
          >
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
                From
              </div>
              <div className="mt-1 font-medium text-[var(--ink)]">{from.name}</div>
              <div className="mt-1 text-xs text-[var(--ink-faint)]">{from.event}</div>
            </div>
            <div className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1 text-center text-xs font-medium text-[var(--ink-2)]">
              {handoff.event}
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
                To
              </div>
              <div className="mt-1 font-medium text-[var(--ink)]">
                {to?.name ?? handoff.agentId}
              </div>
              <div className="mt-1 text-xs text-[var(--ink-2)]">{handoff.when}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function AgentCard({ agent }: { agent: AgentRegistryItem }) {
  return (
    <article className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-[var(--ink)]">{agent.name}</h2>
            <Chip>{agent.id}</Chip>
          </div>
          <p className="mt-2 max-w-3xl text-sm text-[var(--ink-2)]">{agent.purpose}</p>
        </div>
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-xs font-medium text-[var(--ink-2)]">
          {agent.event}
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
            Triggered by
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {agent.triggeredBy.map((trigger) => (
              <Chip key={trigger}>{trigger}</Chip>
            ))}
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
            Completion signal
          </div>
          <p className="mt-2 text-sm text-[var(--ink-2)]">{agent.completionSignal}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
            Inputs
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {agent.input.map((input) => (
              <Chip key={input}>{input}</Chip>
            ))}
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
            Outputs
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {agent.output.map((output) => (
              <Chip key={output}>{output}</Chip>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <DetailList title="Scope" items={agent.scope} />
        <DetailList title="Boundaries" items={agent.boundaries} />
      </div>
    </article>
  );
}

export default function AdminAgentsPage() {
  const groupedAgents = groupAgents();

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/admin"
          className="mb-3 inline-flex text-xs text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]"
        >
          Back to admin
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--ink)]">Agent catalog</h1>
            <p className="mt-2 max-w-3xl text-sm text-[var(--ink-2)]">
              A read-only map of the AI jobs DiscOS can run, what triggers them,
              and the boundaries that keep spend and provenance under control.
            </p>
          </div>
          <span className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1 text-xs font-medium text-[var(--ink-2)]">
            {AGENT_REGISTRY.length} registered agents
          </span>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        <article className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
            Cost posture
          </div>
          <p className="mt-3 text-sm text-[var(--ink-2)]">
            Project-wide LLM work is user-initiated. Intake stays bounded to the
            submitted source and marks synthesis stale instead of auto-spending.
          </p>
        </article>
        <article className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
            Traceability posture
          </div>
          <p className="mt-3 text-sm text-[var(--ink-2)]">
            Creation jobs write typed provenance links so generated artifacts can
            trace claims back through problems, themes, and evidence.
          </p>
        </article>
        <article className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
            Review posture
          </div>
          <p className="mt-3 text-sm text-[var(--ink-2)]">
            Governance jobs review or annotate existing outputs. They do not
            silently mutate user-facing content.
          </p>
        </article>
      </section>

      <AgentInteractionMap />

      {groupedAgents.map((group) => (
        <section key={group.category} className="space-y-3">
          <div className="flex items-center justify-between border-b border-[var(--line)] pb-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
              {group.category}
            </h2>
            <span className="text-xs text-[var(--ink-faint)]">
              {group.agents.length} agent{group.agents.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="space-y-4">
            {group.agents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
