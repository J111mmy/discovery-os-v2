// Front of house: audience lanes for the Documents area.
//
// V1 derives each artifact's audience from its existing `type` (no schema
// change). Phase 2 adds an explicit `audience` column + role-based visibility;
// keep this mapping as the fallback so legacy artifacts stay laned.

import type { ArtifactType } from "@/types/database";

export type AudienceKey =
  | "executive"
  | "gtm"
  | "sales"
  | "product"
  | "research"
  | "library";

export type KitSuggestion = {
  label: string;
  hint: string;
};

export type AudienceLane = {
  key: AudienceKey;
  label: string;
  blurb: string;
  // The standard kit: what this audience expects to find here. Shown as
  // ghost cards when the lane is missing them (evidence-gated generation
  // is #84 Slice 2; V1 just links to compose).
  kit: KitSuggestion[];
};

export const AUDIENCE_LANES: AudienceLane[] = [
  {
    key: "executive",
    label: "Executive",
    blurb: "Reviews, briefs, and decision narratives for leadership.",
    kit: [
      { label: "Executive review", hint: "Where the project stands, argued from evidence." },
      { label: "One-page strategy brief", hint: "The decision and the receipts, one page." },
    ],
  },
  {
    key: "gtm",
    label: "Go-to-market",
    blurb: "Positioning, launch material, and marketing narratives.",
    kit: [
      { label: "Positioning narrative", hint: "Category, promise, and proof points." },
      { label: "Launch pack", hint: "Announcement, FAQ, and talking points." },
    ],
  },
  {
    key: "sales",
    label: "Sales",
    blurb: "Enablement, battlecards, and objection handling for the field.",
    kit: [
      { label: "Battlecard", hint: "Competitor claims vs what customers actually said." },
      { label: "Sales one-pager", hint: "The pitch, grounded in customer evidence." },
      { label: "Objection handling", hint: "Real objections from calls, with answers." },
    ],
  },
  {
    key: "product",
    label: "Product",
    blurb: "PRDs, opportunity briefs, and personas for the build team.",
    kit: [
      { label: "PRD", hint: "Requirements traced to the problems behind them." },
      { label: "Opportunity brief", hint: "One opportunity, its problems, its evidence." },
      { label: "Persona", hint: "Who they are, in their own recorded words." },
    ],
  },
  {
    key: "research",
    label: "Research",
    blurb: "Guides, summaries, and the session record.",
    kit: [{ label: "Interview guide", hint: "Next round's questions, aimed at the gaps." }],
  },
  {
    key: "library",
    label: "Library",
    blurb: "Everything else worth keeping.",
    kit: [],
  },
];

export function audienceForType(type: ArtifactType): AudienceKey {
  switch (type) {
    case "report":
    case "brief":
      return "executive";
    case "gtm":
      return "gtm";
    case "prd":
    case "opportunity":
    case "persona":
      return "product";
    case "interview_guide":
      return "research";
    default:
      return "library";
  }
}
