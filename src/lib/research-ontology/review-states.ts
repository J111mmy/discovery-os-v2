export const VISIBLE_REVIEW_STATES = ["suggested", "accepted", "edited"] as const;

export type VisibleReviewState = (typeof VISIBLE_REVIEW_STATES)[number];

export function isVisibleReviewState(value: string | null | undefined): value is VisibleReviewState {
  return (VISIBLE_REVIEW_STATES as readonly string[]).includes(value ?? "");
}
