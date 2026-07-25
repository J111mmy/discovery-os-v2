import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function loadCorpusFactsModule() {
  const source = fs.readFileSync(new URL("./corpus-facts.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    require() {
      throw new Error("The corpus-facts module must keep runtime dependencies out of this check.");
    },
  });
  vm.runInContext(compiled, context, { filename: "corpus-facts.ts" });
  return module.exports;
}

const { isCorpusQuestion, buildAskCoverage, formatAskCorpusFacts } = loadCorpusFactsModule();

assert.equal(isCorpusQuestion("How many distinct participants are represented?"), true);
assert.equal(isCorpusQuestion("What did Sarah say about onboarding?"), false);
assert.equal(isCorpusQuestion("What patterns appear across all interviews?"), true);

const sourceBreakdown = Array.from({ length: 15 }, (_, index) => ({
  source_id: `source-${index + 1}`,
  source_title: `Interview ${index + 1}`,
  total_evidence: index < 13 ? 4 : 0,
  trusted_evidence: index < 13 ? 3 : 0,
  pending_evidence: index < 13 ? 1 : 0,
  excluded_evidence: 0,
  disputed_evidence: 0,
}));

const facts = {
  total_sources: 15,
  evidence_bearing_sources: 13,
  total_evidence: 52,
  trusted_evidence: 39,
  pending_evidence: 13,
  excluded_evidence: 0,
  disputed_evidence: 0,
  structured_participants: 12,
  source_breakdown: sourceBreakdown,
};
const retrieved = Array.from({ length: 20 }, (_, index) => ({
  id: `evidence-${index + 1}`,
  source_id: `source-${(index % 11) + 1}`,
}));
const coverage = buildAskCoverage({
  facts,
  retrieved,
  trust_scope: "include_pending",
  retrieval_mode: "stratified",
});

assert.equal(coverage.readable_records, 52);
assert.equal(coverage.evidence_bearing_sources, 13);
assert.equal(coverage.total_sources, 15);
assert.equal(coverage.readable_sources, 13);
assert.equal(coverage.retrieved_sources, 11);

const promptFacts = formatAskCorpusFacts({ facts, coverage });
assert.match(promptFacts, /Total sources: 15/);
assert.match(promptFacts, /Sources with Ask-eligible evidence: 13/);
assert.match(promptFacts, /Retrieved answer slice: 20 records from 11 sources/);
assert.match(promptFacts, /Participant-count caveat:/);

const promptSource = fs.readFileSync(
  new URL("../llm/prompts/ask.ts", import.meta.url),
  "utf8"
);
assert.match(promptSource, /Counting and coverage questions must be answered only from CORPUS_FACTS/);
assert.match(promptSource, /Never infer a participant count from the number of sources/);
assert.match(promptSource, /retrieved evidence is a relevance sample/);

const migrationSource = fs.readFileSync(
  new URL("../../../supabase/migrations/0041_ask_corpus_facts_and_stratified_retrieval.sql", import.meta.url),
  "utf8"
);
assert.equal((migrationSource.match(/security invoker/g) ?? []).length, 2);
assert.match(migrationSource, /order by e\.source_rank, e\.distance, e\.id/);
assert.match(migrationSource, /revoke all on function public\.match_evidence_stratified/);
assert.match(migrationSource, /grant execute on function public\.match_evidence_stratified/);

console.log("Ask corpus honesty checks passed.");
