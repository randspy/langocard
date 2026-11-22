/** Daily practice limits, shared with the browser and Android's StudyPolicy. */
export const DAILY_SECONDS = 15 * 60;
export const WIND_DOWN_SECONDS = 2 * 60;
export const CLEANUP_SECONDS = 2 * 60;

/** Checked between cards; a card already shown may always be answered. */
export function practicePhase(seconds: number) {
  if (seconds >= DAILY_SECONDS + CLEANUP_SECONDS) return "done";
  if (seconds >= DAILY_SECONDS) return "cleanup";
  if (seconds >= DAILY_SECONDS - WIND_DOWN_SECONDS) return "wind-down";
  return "practice";
}
