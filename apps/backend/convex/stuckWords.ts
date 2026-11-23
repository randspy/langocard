import { exampleAt, withoutAlternatives } from "./entryRules";

/**
 * Stuck-word handling, mirroring Android's `StuckWords` and `Learner.recordRecall`: four
 * consecutive misses pause a card for three days and offer a memory hook, and a card coming
 * back from a pause shows a sentence it wasn't recently missed in. Self-contained.
 */
export const MISSES_BEFORE_PAUSE = 4;
export const PAUSE_MS = 3 * 86_400_000;

/** The failure streak and pause after an answer, and whether to offer a memory hook. */
export function recordRecall(failures: number, pausedUntil: number, again: boolean, now: number) {
  const missed = again ? failures + 1 : 0;
  if (missed < MISSES_BEFORE_PAUSE) return { failures: missed, pausedUntil, offerHook: false };
  return { failures: 0, pausedUntil: now + PAUSE_MS, offerHook: true };
}

/** A review log's `review_datetime`, the order Android sorts a card's answers in; "" if unreadable. */
export function reviewTime(log: string): string {
  try {
    const at = (JSON.parse(log) as { review_datetime?: unknown }).review_datetime;
    return typeof at === "string" ? at : "";
  } catch {
    return "";
  }
}

/** The example a review log records as shown, or "" when it has none. */
export function loggedExample(log: string): string {
  try {
    // The marked text as logged: it names the example, so only a blank one counts as none.
    const example = (JSON.parse(log) as { example?: unknown }).example;
    return typeof example === "string" && example.trim() ? example : "";
  } catch {
    return "";
  }
}

/** Whether a paused card is due back now and hasn't been answered since its pause ended. */
export const returning = (pausedUntil: number, lastReview: number | null, now: number) =>
  pausedUntil > 0 && pausedUntil <= now && (lastReview ?? 0) < pausedUntil;

/**
 * On return, an example not among the card's recent answers, otherwise the least recently
 * answered one. `recent` lists the last answers' examples, oldest first.
 */
export function returningExample(examples: readonly string[], exposures: number, recent: readonly string[]): string {
  if (examples.length === 1) return examples[0];
  // Failures name an example by its marked text; alternatives added since don't make it another one.
  const seen = recent.map(withoutAlternatives);
  const last = seen.length ? seen : [withoutAlternatives(exampleAt(examples, Math.max(exposures - 1, 0)))];
  const fresh = examples.find((e) => !last.includes(withoutAlternatives(e)));
  if (fresh) return fresh;
  return examples.reduce((best, e) => (last.lastIndexOf(withoutAlternatives(e)) < last.lastIndexOf(withoutAlternatives(best)) ? e : best));
}
