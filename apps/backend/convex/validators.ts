import { v } from "convex/values";

/** Learner-visible entry content; mirrors `EntryContent` in `entryRules.ts`. */
export const entryContent = {
  word: v.string(),
  english: v.string(),
  definition: v.string(),
  /** 1 to `MAX_EXAMPLES` sentences, each with one `{answer}`; checked by `entryErrors`. */
  examples: v.array(v.string()),
  topic: v.string(),
  lemma: v.string(),
  rank: v.union(v.number(), v.null()),
  sourceUrl: v.string(),
  license: v.string(),
  gender: v.union(v.literal("masculine"), v.literal("feminine"), v.null()),
};

/**
 * Entry content as stored. `gender` is missing only on rows written before it existed,
 * until `migrations:fillGender` runs; `contentOf` reads them with the article gender.
 */
export const storedEntryContent = { ...entryContent, gender: v.optional(entryContent.gender) };

/** Edit clocks on an entry. The later of the two decides between versions. */
export const entryClocks = {
  editedAt: v.union(v.number(), v.null()),
  deletedAt: v.union(v.number(), v.null()),
};

/** A card's two field groups: review fields (clock `lastReview`) and manual fields (clock `cardEditedAt`). */
export const cardFields = {
  /** FSRS card JSON in Android's format; null after a reset (the card is new again). */
  card: v.union(v.string(), v.null()),
  lastReview: v.number(),
  failures: v.number(),
  /** Automatic leech pause set by Android after repeated failures. */
  pausedUntil: v.number(),
  /** Manual suspension; `SUSPENDED_INDEFINITELY` for no end date, 0 when not suspended. */
  suspendedUntil: v.number(),
  cardEditedAt: v.number(),
};

export const settingsFields = {
  placementDone: v.boolean(),
  placementIndex: v.number(),
  nextCardId: v.number(),
  minimumRank: v.number(),
  interests: v.string(),
  preferencesChangedAt: v.number(),
  day: v.string(),
  seconds: v.number(),
  introduced: v.number(),
};
