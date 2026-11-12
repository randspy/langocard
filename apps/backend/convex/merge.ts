/**
 * Merge rules shared by the server and (mirrored in Kotlin) the Android app.
 * `content/merge-fixtures.json` holds cases both implementations must pass.
 * Every rule is idempotent, so devices can resend the same data without changing
 * the result. Self-contained apart from `entryRules.ts`.
 */
import { contentOf, sameContent, type EntryContent } from "./entryRules";

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

// ---- Entries ---------------------------------------------------------------

export type EntryClocks = { editedAt: number | null; deletedAt: number | null };

/** An entry version's clock: the later of its last edit and its deletion. */
export function entryVersion(e: EntryClocks): number {
  return Math.max(e.editedAt ?? 0, e.deletedAt ?? 0);
}

/** A pushed entry replaces the stored one only if its version is strictly newer. */
export function entryWins(incoming: EntryClocks, stored: EntryClocks): boolean {
  return entryVersion(incoming) > entryVersion(stored);
}

export function isDeleted(e: EntryClocks): boolean {
  return e.deletedAt !== null && e.deletedAt >= (e.editedAt ?? 0);
}

export type SeededEntry = EntryContent & {
  origin: string;
  shipped: EntryContent | null;
  upstreamChanged: boolean;
  retired: boolean;
};

/**
 * Changes needed to bring a stored entry up to date with newly shipped content, or
 * null when it is already current. Unedited entries take the new content; edited
 * entries keep the learner's wording and are flagged when the shipped content moved.
 * An entry counts as edited when its content differs from what was last shipped.
 */
export function applyShipped(stored: SeededEntry, shipped: EntryContent, origin: string): Partial<SeededEntry> | null {
  const patch: Partial<SeededEntry> = {};
  if (stored.retired) patch.retired = false;
  if (stored.origin !== origin) patch.origin = origin;
  const previous = stored.shipped;
  if (!previous || !sameContent(previous, shipped)) {
    patch.shipped = contentOf(shipped);
    const edited = !previous || !sameContent(contentOf(stored), previous);
    if (!edited) Object.assign(patch, contentOf(shipped));
    else {
      const differs = !sameContent(contentOf(stored), shipped);
      if (differs !== stored.upstreamChanged) patch.upstreamChanged = differs;
    }
  }
  return Object.keys(patch).length ? patch : null;
}

// ---- Cards -----------------------------------------------------------------

/** `suspendedUntil` for a suspension without an end date (9999-12-31). */
export const SUSPENDED_INDEFINITELY = 253_402_300_799_999;

export type CardState = {
  card: string | null;
  lastReview: number;
  failures: number;
  pausedUntil: number;
  suspendedUntil: number;
  cardEditedAt: number;
};

/**
 * Review fields follow the newer `lastReview`; manual fields follow the newer
 * `cardEditedAt`. Ties keep the stored value.
 */
export function mergeCard(stored: CardState, incoming: CardState): CardState {
  const review = incoming.lastReview > stored.lastReview ? incoming : stored;
  const manual = incoming.cardEditedAt > stored.cardEditedAt ? incoming : stored;
  return {
    card: review.card,
    lastReview: review.lastReview,
    failures: review.failures,
    pausedUntil: review.pausedUntil,
    suspendedUntil: manual.suspendedUntil,
    cardEditedAt: manual.cardEditedAt,
  };
}

/**
 * A reset makes the card new again. It advances both clocks to `now`, so reviews made
 * before the reset lose even if they sync later; review history is kept separately.
 */
export function resetCard(now: number): CardState {
  return { card: null, lastReview: now, failures: 0, pausedUntil: 0, suspendedUntil: 0, cardEditedAt: now };
}

export function sameCard(a: CardState, b: CardState): boolean {
  return a.card === b.card && a.lastReview === b.lastReview && a.failures === b.failures &&
    a.pausedUntil === b.pausedUntil && a.suspendedUntil === b.suspendedUntil && a.cardEditedAt === b.cardEditedAt;
}
