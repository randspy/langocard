/**
 * Merge rules shared by the server and (mirrored in Kotlin) the Android app.
 * `content/merge-fixtures.json` holds cases both implementations must pass.
 * Every rule is idempotent, so devices can resend the same data without changing
 * the result. Self-contained apart from `entryRules.ts`.
 */
import {
  alternativesOf, contentOf, folded, MAX_ALTERNATIVES, sameContent, withAlternatives, withoutAlternatives,
  type EntryContent, type StoredContent,
} from "./entryRules";

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
  /** Absent from older APKs' pushes; counts as 0. */
  genderIntroduced?: number;
  /** Absent from older APKs' pushes, which then keep the stored fit. */
  fittedSettings?: string | null;
  fittedSettingsChangedAt?: number;
};

export function mergeSettings(a: Settings, b: Settings): Settings {
  const preferences = b.preferencesChangedAt > a.preferencesChangedAt ? b : a;
  // The fit and its clock travel together; a push without the fit can't clear it.
  const fit = b.fittedSettings !== undefined && (b.fittedSettingsChangedAt ?? 0) > (a.fittedSettingsChangedAt ?? 0) ? b : a;
  // Daily counters belong to the most recent local day. On the same day the
  // larger value is kept: it undercounts study split across two devices, but
  // never lets resent data inflate the daily target.
  const counters = (s: Settings) => ({ day: s.day, seconds: s.seconds, introduced: s.introduced, genderIntroduced: s.genderIntroduced ?? 0 });
  const daily =
    a.day === b.day
      ? {
        day: a.day, seconds: Math.max(a.seconds, b.seconds), introduced: Math.max(a.introduced, b.introduced),
        genderIntroduced: Math.max(a.genderIntroduced ?? 0, b.genderIntroduced ?? 0),
      }
      : counters(a.day > b.day ? a : b);
  return {
    placementDone: a.placementDone || b.placementDone,
    placementIndex: Math.max(a.placementIndex, b.placementIndex),
    nextCardId: Math.max(a.nextCardId, b.nextCardId),
    minimumRank: preferences.minimumRank,
    interests: preferences.interests,
    preferencesChangedAt: preferences.preferencesChangedAt,
    ...daily,
    fittedSettings: fit.fittedSettings ?? null,
    fittedSettingsChangedAt: fit.fittedSettingsChangedAt ?? 0,
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

export type SeededEntry = StoredContent & {
  origin: string;
  shipped: StoredContent | null;
  upstreamChanged: boolean;
  retired: boolean;
};

/**
 * Changes needed to bring a stored entry up to date with newly shipped content, or
 * null when it is already current. Unedited entries take the new content; edited
 * entries keep the learner's wording and are flagged when the shipped content moved.
 * An entry counts as edited when its content differs from what was last shipped.
 * Alternatives alone never flag an edited entry: newly shipped ones are carried into it.
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
      const examples = carryAlternatives(stored.examples, previous?.examples ?? [], shipped.examples);
      if (examples.some((example, i) => example !== stored.examples[i])) patch.examples = examples;
      const plainShipped = withoutAnyAlternatives(shipped);
      if (!previous || !sameContent(withoutAnyAlternatives(contentOf(previous)), plainShipped)) {
        const differs = !sameContent(withoutAnyAlternatives(contentOf(stored)), plainShipped);
        if (differs !== stored.upstreamChanged) patch.upstreamChanged = differs;
      }
    }
  }
  return Object.keys(patch).length ? patch : null;
}

const withoutAnyAlternatives = (content: EntryContent): EntryContent =>
  ({ ...content, examples: content.examples.map(withoutAlternatives) });

/**
 * The learner's examples, each followed by the alternatives shipped for the same sentence
 * since `previous`. Alternatives the learner removed stay removed until shipped anew, and a
 * rewritten sentence gains none.
 */
function carryAlternatives(examples: string[], previous: string[], shipped: string[]): string[] {
  const bySentence = (list: string[]) => new Map(list.map((e) => [withoutAlternatives(e), alternativesOf(e)]));
  const [before, now] = [bySentence(previous), bySentence(shipped)];
  return examples.map((example) => {
    const sentence = withoutAlternatives(example);
    const own = alternativesOf(example);
    const known = new Set([...own, ...(before.get(sentence) ?? [])].map(folded));
    const added = (now.get(sentence) ?? []).filter((a) => !known.has(folded(a)));
    return added.length ? withAlternatives(example, [...own, ...added].slice(0, MAX_ALTERNATIVES)) : example;
  });
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
