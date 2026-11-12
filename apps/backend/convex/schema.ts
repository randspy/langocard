import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { cardFields, entryClocks, entryContent, settingsFields } from "./validators";

/**
 * Cloud copy of one learner's study data (sync protocol v2). Each row carries
 * `updatedAt` (server time of the last write) so devices can pull only what changed
 * since their previous sync. Merge rules live in `merge.ts`.
 */
export default defineSchema({
  // Web app sign-in (Convex Auth). Access is limited by `requireOwner` in owner.ts.
  ...authTables,

  // One FSRS card per "<entryId>:<Skill>". Review fields and manual fields merge separately.
  cards: defineTable({
    key: v.string(),
    ...cardFields,
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
    .index("by_key", ["key"])
    .index("by_updated", ["updatedAt"]),

  // The whole library: bundled and pack entries (seeded from the repo) and personal entries.
  entries: defineTable({
    entryId: v.string(),
    ...entryContent,
    ...entryClocks,
    /** "bundled", "personal" or "pack:<packId>". */
    origin: v.string(),
    /** Latest shipped content for seeded entries; null for personal entries. */
    shipped: v.union(v.object(entryContent), v.null()),
    /** Shipped content changed after the learner edited the entry. */
    upstreamChanged: v.boolean(),
    /** No longer in the shipped content. Kept for its history; not introduced as new. */
    retired: v.boolean(),
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
    ...settingsFields,
    updatedAt: v.number(),
  }).index("by_updated", ["updatedAt"]),
});
