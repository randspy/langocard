/**
 * Merge rules shared by the server and (mirrored in Kotlin) the Android app.
 * Every rule is commutative and idempotent, so devices can sync in any order
 * and resend the same data without changing the result.
 */

export type Settings = {
  placementDone: boolean;
  placementIndex: number;
  nextCardId: number;
  minimumRank: number;
  interests: string;
  preferencesChangedAt: number;
  day: string;
  seconds: number;
  introduced: number;
};

export function mergeSettings(a: Settings, b: Settings): Settings {
  const preferences = b.preferencesChangedAt > a.preferencesChangedAt ? b : a;
  // Daily counters belong to the most recent local day. On the same day the
  // larger value is kept: it undercounts study split across two devices, but
  // never lets resent data inflate the daily target.
  const daily =
    a.day === b.day
      ? { day: a.day, seconds: Math.max(a.seconds, b.seconds), introduced: Math.max(a.introduced, b.introduced) }
      : a.day > b.day
        ? { day: a.day, seconds: a.seconds, introduced: a.introduced }
        : { day: b.day, seconds: b.seconds, introduced: b.introduced };
  return {
    placementDone: a.placementDone || b.placementDone,
    placementIndex: Math.max(a.placementIndex, b.placementIndex),
    nextCardId: Math.max(a.nextCardId, b.nextCardId),
    minimumRank: preferences.minimumRank,
    interests: preferences.interests,
    preferencesChangedAt: preferences.preferencesChangedAt,
    ...daily,
  };
}

/** A card edit wins only if it records a strictly later review. */
export function cardWins(incomingLastReview: number, storedLastReview: number): boolean {
  return incomingLastReview > storedLastReview;
}
