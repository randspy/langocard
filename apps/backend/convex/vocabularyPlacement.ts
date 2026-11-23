/**
 * The optional vocabulary starting check, mirroring Android's `VocabularyPlacement`: 60 real
 * words in three frequency bands and 30 invented words, answered yes/no. It estimates a
 * conservative starting rank and never marks a card known. `content/placement-fixtures.json`
 * holds cases both must pass. Self-contained, so the web app can import it.
 */

/** A band is a sampled frequency range; -1 identifies an invented control item. */
export type PlacementItem = { word: string; band: number };

export const STARTING_RANKS = [1, 2501, 7001] as const;

/** Words recognised per band, discounted by the false-alarm rate on invented words. */
export function adjustedHits(items: readonly PlacementItem[], answers: readonly boolean[]): number[] {
  if (answers.length !== items.length) throw new Error("Answer every word first");
  const falseAlarms = items.filter((item, i) => item.band === -1 && answers[i]).length;
  return [0, 1, 2].map((band) =>
    Math.max(items.filter((item, i) => item.band === band && answers[i]).length - (20.0 * falseAlarms) / 30, 0));
}

/** The suggested starting rank: the first band not mostly known. */
export function startingRank(items: readonly PlacementItem[], answers: readonly boolean[]): number {
  const hits = adjustedHits(items, answers);
  return hits[0] < 16 ? 1 : hits[1] < 16 ? 2501 : 7001;
}
