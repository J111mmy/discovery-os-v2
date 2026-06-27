import type { createClient, createServiceClient } from "@/lib/supabase/server";
import type { OrgScopedRead } from "@/lib/auth/support-read";
import type { EvidenceRecord } from "@/types/database";
import { VISIBLE_REVIEW_STATES } from "./review-states";

export { VISIBLE_REVIEW_STATES } from "./review-states";

type SupabaseClient =
  | Awaited<ReturnType<typeof createClient>>
  | ReturnType<typeof createServiceClient>
  | OrgScopedRead;

const VISIBLE_REVIEW_STATE_VALUES = [...VISIBLE_REVIEW_STATES];
const PAGE_SIZE = 1000;

type TopicRow = {
  id: string;
  label: string;
  review_state: string | null;
};

type EvidenceTopicRow = {
  evidence_id: string;
  topic_id: string;
  review_state: string | null;
};

export type ProjectTopicGraph = {
  topics: TopicRow[];
  links: EvidenceTopicRow[];
  topicById: Map<string, TopicRow>;
  labelsByEvidenceId: Map<string, string[]>;
  topicIdsByEvidenceId: Map<string, Set<string>>;
  evidenceIdsByTopicId: Map<string, Set<string>>;
};

function addToSetMap(map: Map<string, Set<string>>, key: string, value: string) {
  const set = map.get(key) ?? new Set<string>();
  set.add(value);
  map.set(key, set);
}

function addToArrayMap(map: Map<string, string[]>, key: string, value: string) {
  const list = map.get(key) ?? [];
  list.push(value);
  map.set(key, list);
}

async function fetchProjectEvidenceTopicLinks({
  supabase,
  orgId,
  projectId,
}: {
  supabase: SupabaseClient;
  orgId: string;
  projectId: string;
}) {
  const rows: EvidenceTopicRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("evidence_topics")
      .select("evidence_id, topic_id, review_state")
      .eq("org_id", orgId)
      .eq("project_id", projectId)
      .in("review_state", VISIBLE_REVIEW_STATE_VALUES)
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(`Failed to load evidence topic links: ${error.message}`);

    rows.push(...((data ?? []) as EvidenceTopicRow[]));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

async function fetchProjectTopics({
  supabase,
  orgId,
  projectId,
}: {
  supabase: SupabaseClient;
  orgId: string;
  projectId: string;
}) {
  const rows: TopicRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("topics")
      .select("id, label, review_state")
      .eq("org_id", orgId)
      .eq("project_id", projectId)
      .in("review_state", VISIBLE_REVIEW_STATE_VALUES)
      .order("label", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(`Failed to load topics: ${error.message}`);

    rows.push(...((data ?? []) as TopicRow[]));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

export async function loadVisibleProjectTopicGraph({
  supabase,
  orgId,
  projectId,
}: {
  supabase: SupabaseClient;
  orgId: string;
  projectId: string;
}): Promise<ProjectTopicGraph> {
  const topics = await fetchProjectTopics({ supabase, orgId, projectId });
  const topicById = new Map(topics.map((topic) => [topic.id, topic]));
  const links = (await fetchProjectEvidenceTopicLinks({ supabase, orgId, projectId })).filter(
    (link) => topicById.has(link.topic_id)
  );

  const labelsByEvidenceId = new Map<string, string[]>();
  const topicIdsByEvidenceId = new Map<string, Set<string>>();
  const evidenceIdsByTopicId = new Map<string, Set<string>>();

  for (const link of links) {
    const topic = topicById.get(link.topic_id);
    if (!topic) continue;

    addToArrayMap(labelsByEvidenceId, link.evidence_id, topic.label);
    addToSetMap(topicIdsByEvidenceId, link.evidence_id, link.topic_id);
    addToSetMap(evidenceIdsByTopicId, link.topic_id, link.evidence_id);
  }

  for (const [evidenceId, labels] of Array.from(labelsByEvidenceId.entries())) {
    labelsByEvidenceId.set(
      evidenceId,
      Array.from(new Set<string>(labels)).sort((a, b) => a.localeCompare(b))
    );
  }

  return {
    topics,
    links,
    topicById,
    labelsByEvidenceId,
    topicIdsByEvidenceId,
    evidenceIdsByTopicId,
  };
}

export async function loadTypedTopicLabelsByEvidenceId({
  supabase,
  orgId,
  projectId,
  evidenceIds,
}: {
  supabase: SupabaseClient;
  orgId: string;
  projectId: string;
  evidenceIds: string[];
}) {
  const ids = Array.from(new Set(evidenceIds.filter(Boolean)));
  const labelsByEvidenceId = new Map<string, string[]>();
  if (ids.length === 0) return labelsByEvidenceId;

  const { data: linkData, error: linkError } = await supabase
    .from("evidence_topics")
    .select("evidence_id, topic_id, review_state")
    .eq("org_id", orgId)
    .eq("project_id", projectId)
    .in("review_state", VISIBLE_REVIEW_STATE_VALUES)
    .in("evidence_id", ids);

  if (linkError) throw new Error(`Failed to load evidence topic links: ${linkError.message}`);

  const links = (linkData ?? []) as EvidenceTopicRow[];
  const topicIds = Array.from(new Set(links.map((link) => link.topic_id).filter(Boolean)));
  if (topicIds.length === 0) return labelsByEvidenceId;

  const { data: topicData, error: topicError } = await supabase
    .from("topics")
    .select("id, label, review_state")
    .eq("org_id", orgId)
    .eq("project_id", projectId)
    .in("review_state", VISIBLE_REVIEW_STATE_VALUES)
    .in("id", topicIds);

  if (topicError) throw new Error(`Failed to load topics: ${topicError.message}`);

  const topicById = new Map(((topicData ?? []) as TopicRow[]).map((topic) => [topic.id, topic]));
  for (const link of links) {
    const topic = topicById.get(link.topic_id);
    if (!topic) continue;
    addToArrayMap(labelsByEvidenceId, link.evidence_id, topic.label);
  }

  for (const [evidenceId, labels] of Array.from(labelsByEvidenceId.entries())) {
    labelsByEvidenceId.set(
      evidenceId,
      Array.from(new Set<string>(labels)).sort((a, b) => a.localeCompare(b))
    );
  }

  return labelsByEvidenceId;
}

export async function hydrateEvidenceRecordsWithTypedTopics({
  supabase,
  orgId,
  projectId,
  records,
}: {
  supabase: SupabaseClient;
  orgId: string;
  projectId: string;
  records: EvidenceRecord[];
}) {
  const labelsByEvidenceId = await loadTypedTopicLabelsByEvidenceId({
    supabase,
    orgId,
    projectId,
    evidenceIds: records.map((record) => record.id),
  });

  for (const record of records) {
    record.themes = labelsByEvidenceId.get(record.id) ?? [];
  }

  return records;
}
