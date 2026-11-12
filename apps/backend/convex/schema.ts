import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Cloud copy of one learner's study data. Each row carries `updatedAt` (server
 * time of the last write) so devices can pull only what changed since their
 * previous sync. Payloads the server doesn't need to inspect stay as JSON strings
 * in the Android app's own format.
 */
export default defineSchema({
  // One FSRS card per "<entryId>:<Skill>". The newest review wins.
  cards: defineTable({
    key: v.string(),
    card: v.string(),
    lastReview: v.number(),
    failures: v.number(),
    pausedUntil: v.number(),
    updatedAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_updated", ["updatedAt"]),

  // Append-only review history.
  reviews: defineTable({
    reviewId: v.string(),
    key: v.string(),
    placement: v.boolean(),
    log: v.string(),
    updatedAt: v.number(),
  })
    .index("by_review", ["reviewId"])
    .index("by_updated", ["updatedAt"]),

  // Personal entries and installed pack entries (anything beyond the bundled library).
  entries: defineTable({
    entryId: v.string(),
    entry: v.string(),
    updatedAt: v.number(),
  })
    .index("by_entry", ["entryId"])
    .index("by_updated", ["updatedAt"]),

  // Attribution for installed packs.
  sources: defineTable({
    sourceId: v.string(),
    source: v.string(),
    updatedAt: v.number(),
  })
    .index("by_source", ["sourceId"])
    .index("by_updated", ["updatedAt"]),

  // Sibling skills hidden until the next local day. The latest day wins.
  buried: defineTable({
    key: v.string(),
    day: v.string(),
    updatedAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_updated", ["updatedAt"]),

  // A single row of placement, preference and daily-counter state.
  settings: defineTable({
    placementDone: v.boolean(),
    placementIndex: v.number(),
    nextCardId: v.number(),
    minimumRank: v.number(),
    interests: v.string(),
    preferencesChangedAt: v.number(),
    day: v.string(),
    seconds: v.number(),
    introduced: v.number(),
    updatedAt: v.number(),
  }).index("by_updated", ["updatedAt"]),
});
