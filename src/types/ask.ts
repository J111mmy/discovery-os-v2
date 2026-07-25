export type AskRetrievalMode = "semantic" | "stratified";

export type AskCorpusSourceBreakdown = {
  source_id: string;
  source_title: string;
  total_evidence: number;
  trusted_evidence: number;
  pending_evidence: number;
  excluded_evidence: number;
  disputed_evidence: number;
};

export type AskCorpusFacts = {
  total_sources: number;
  evidence_bearing_sources: number;
  total_evidence: number;
  trusted_evidence: number;
  pending_evidence: number;
  excluded_evidence: number;
  disputed_evidence: number;
  structured_participants: number;
  source_breakdown: AskCorpusSourceBreakdown[];
};

export type AskCoverage = {
  retrieval_mode: AskRetrievalMode;
  retrieved_records: number;
  readable_records: number;
  retrieved_sources: number;
  readable_sources: number;
  evidence_bearing_sources: number;
  total_sources: number;
  trust_breakdown: {
    trusted: number;
    pending: number;
    excluded: number;
    disputed: number;
  };
  structured_participants: number;
  participant_count_caveat: string;
};
