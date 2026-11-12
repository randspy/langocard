/**
 * Reads the FSRS card and review-log JSON written by the Android app
 * (java-fsrs 1.0.0 via Jackson). Self-contained so the web app can import it.
 */

export type FsrsState = "LEARNING" | "REVIEW" | "RELEARNING";
export type FsrsCard = {
  state: FsrsState;
  step: number | null;
  stability: number | null;
  difficulty: number | null;
  /** ms since epoch */
  due: number;
  lastReview: number | null;
};

const time = (value: unknown): number | null => {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
};
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** Parses a stored card; null for a reset card (`null`) or unreadable JSON. */
export function parseCard(json: string | null): FsrsCard | null {
  if (json === null) return null;
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    const due = time(o.due);
    const state = o.state;
    if (due === null || (state !== "LEARNING" && state !== "REVIEW" && state !== "RELEARNING")) return null;
    return { state, step: num(o.step), stability: num(o.stability), difficulty: num(o.difficulty), due, lastReview: time(o.lastReview) };
  } catch {
    return null;
  }
}

export type Rating = "AGAIN" | "HARD" | "GOOD" | "EASY";
export type FsrsReview = { rating: Rating; at: number; durationMs: number | null };

/** Parses a stored review log; null if unreadable. */
export function parseReviewLog(json: string): FsrsReview | null {
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    const at = time(o.review_datetime);
    const rating = o.rating;
    if (at === null || (rating !== "AGAIN" && rating !== "HARD" && rating !== "GOOD" && rating !== "EASY")) return null;
    return { rating, at, durationMs: num(o.reviewDuration) };
  } catch {
    return null;
  }
}
