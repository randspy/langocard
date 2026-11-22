import type { FunctionReturnType } from "convex/server";
import type { api } from "@backend/_generated/api";
import { cardFromJson, intervalLabel, newCard, Scheduler, type Rating } from "@backend/fsrs";

export type StudyCard = NonNullable<FunctionReturnType<typeof api.study.next>>;
export type AnswerResult = FunctionReturnType<typeof api.study.answer>;

/** The learner's local calendar day, "YYYY-MM-DD", which daily rules and burials follow. */
export function localDay(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const preview = new Scheduler({ enableFuzzing: false });

/** How long each rating would schedule the card for, as the phone's rating buttons show it. */
export function intervals(card: string | null, now: number): Record<Rating, string> {
  const current = card === null ? newCard(0, now) : cardFromJson(card);
  const label = (rating: Rating) => intervalLabel(now, preview.review(current, rating, now).card.due);
  return { AGAIN: label("AGAIN"), HARD: label("HARD"), GOOD: label("GOOD"), EASY: label("EASY") };
}
