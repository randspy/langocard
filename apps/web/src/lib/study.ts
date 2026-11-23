import type { FunctionReturnType } from "convex/server";
import type { api } from "@backend/_generated/api";
import { schedulerFor, type Fit } from "@backend/fittedSettings";
import { cardFromJson, intervalLabel, newCard, type Rating } from "@backend/fsrs";

export type StudyCard = NonNullable<FunctionReturnType<typeof api.study.next>>;
export type AnswerResult = FunctionReturnType<typeof api.study.answer>;

/** The learner's local calendar day, "YYYY-MM-DD", which daily rules and burials follow. */
export function localDay(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * How long each rating would schedule the card for, as the phone's rating buttons show it,
 * with the learner's fitted settings (`fit`) or the defaults.
 */
export function intervals(card: string | null, now: number, fit: Fit | null = null): Record<Rating, string> {
  const preview = schedulerFor(fit, { enableFuzzing: false });
  const current = card === null ? newCard(0, now) : cardFromJson(card);
  const label = (rating: Rating) => intervalLabel(now, preview.review(current, rating, now).card.due);
  return { AGAIN: label("AGAIN"), HARD: label("HARD"), GOOD: label("GOOD"), EASY: label("EASY") };
}
