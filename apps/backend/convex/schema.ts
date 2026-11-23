import { entryStudyFields, progressFields } from "./studyProgress";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { cardFields, derivedCardFields, entryClocks, settingsFields, storedEntryContent } from "./validators";

/**
 * Cloud copy of one learner's study data (sync protocol v2). Each row carries
 * `updatedAt` (server time of the last write) so devices can pull only what changed
 * since their previous sync. Merge rules live in `merge.ts`.
 */
export default defineSchema({
  orphanProgress: defineTable({ entryId: v.string(), ...progressFields }).index("by_entry", ["entryId"]),
  hooks: defineTable({ entryId: v.string(), text: v.string(), editedAt: v.number(), updatedAt: v.number() })
    .index("by_entry", ["entryId"]).index("by_updated", ["updatedAt"]),
  // One FSRS card per "<entryId>:<Skill>". Review fields and manual fields merge separately.
  cards: defineTable({
    key: v.string(),
    ...cardFields,
    updatedAt: v.number(),
    // Server-only scheduling columns for web study (see studyIndex.ts); never pulled.
    ...derivedCardFields,
  })
    .index("by_key", ["key"])
    .index("by_updated", ["updatedAt"])
    .index("by_active_skill_due", ["active", "skill", "due", "studyOrder"]),

  // Append-only review history.
  reviews: defineTable({
    exposureCounted: v.optional(v.boolean()),
    reviewId: v.string(),
    key: v.string(),
    placement: v.boolean(),
    log: v.string(),
    updatedAt: v.number(),
  })
    .index("by_exposureCounted", ["exposureCounted"])
    .index("by_review", ["reviewId"])
    .index("by_key", ["key"])
    .index("by_updated", ["updatedAt"]),

  // The whole library: bundled and pack entries (seeded from the repo) and personal entries.
  entries: defineTable({
    entryId: v.string(),
    ...entryStudyFields,
    ...storedEntryContent,
    ...entryClocks,
    /** "bundled", "personal" or "pack:<packId>". */
    origin: v.string(),
    /** Latest shipped content for seeded entries; null for personal entries. */
    shipped: v.union(v.object(storedEntryContent), v.null()),
    /** Shipped content changed after the learner edited the entry. */
    upstreamChanged: v.boolean(),
    /** No longer in the shipped content. Kept for its history; not introduced as new. */
    retired: v.boolean(),
    updatedAt: v.number(),
  })
    .index("by_entry", ["entryId"])
    .index("by_upstreamChanged", ["upstreamChanged"])
    .index("by_started", ["started"])
    .index("by_missingReading", ["missingReading", "studyOrder"])
    .index("by_missingProduction", ["missingProduction", "studyOrder"])
    .index("by_introducible_origin", ["introducible", "origin", "studyOrder"])
    .index("by_introducible_origin_band", ["introducible", "origin", "rankBand", "studyOrder"])
    .index("by_introducible_origin_rank", ["introducible", "origin", "studyRank"])
    .index("by_lexeme", ["lexeme"])
    .index("by_nounKey", ["nounKey"])
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
