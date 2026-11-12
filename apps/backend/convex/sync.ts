import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { DataModel } from "./_generated/dataModel";
import { cardWins, mergeSettings, type Settings } from "./merge";

/**
 * Single-user sync API. Every call carries the shared secret configured with
 * `npx convex env set SYNC_TOKEN <value>`; there are no accounts.
 */
function requireToken(token: string) {
  const expected = process.env.SYNC_TOKEN;
  if (!expected) throw new ConvexError("SYNC_TOKEN is not configured on the deployment");
  let diff = token.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) diff |= (token.charCodeAt(i) || 0) ^ expected.charCodeAt(i);
  if (diff !== 0) throw new ConvexError("Invalid sync token");
}

const MAX_BATCH = 500;

const settingsFields = {
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

export const push = mutation({
  args: {
    token: v.string(),
    cards: v.array(v.object({ key: v.string(), card: v.string(), lastReview: v.number(), failures: v.number(), pausedUntil: v.number() })),
    reviews: v.array(v.object({ reviewId: v.string(), key: v.string(), placement: v.boolean(), log: v.string() })),
    entries: v.array(v.object({ entryId: v.string(), entry: v.string() })),
    sources: v.array(v.object({ sourceId: v.string(), source: v.string() })),
    buried: v.array(v.object({ key: v.string(), day: v.string() })),
    settings: v.optional(v.object(settingsFields)),
  },
  handler: async (ctx, args) => {
    requireToken(args.token);
    for (const list of [args.cards, args.reviews, args.entries, args.sources, args.buried]) {
      if (list.length > MAX_BATCH) throw new ConvexError(`At most ${MAX_BATCH} items of each kind per push`);
    }
    const updatedAt = Date.now();

    for (const card of args.cards) {
      const stored = await ctx.db.query("cards").withIndex("by_key", (q) => q.eq("key", card.key)).unique();
      if (!stored) await ctx.db.insert("cards", { ...card, updatedAt });
      else if (cardWins(card.lastReview, stored.lastReview)) await ctx.db.patch(stored._id, { ...card, updatedAt });
    }
    for (const review of args.reviews) {
      const stored = await ctx.db.query("reviews").withIndex("by_review", (q) => q.eq("reviewId", review.reviewId)).unique();
      if (!stored) await ctx.db.insert("reviews", { ...review, updatedAt });
    }
    for (const entry of args.entries) {
      const stored = await ctx.db.query("entries").withIndex("by_entry", (q) => q.eq("entryId", entry.entryId)).unique();
      if (!stored) await ctx.db.insert("entries", { ...entry, updatedAt });
    }
    for (const source of args.sources) {
      const stored = await ctx.db.query("sources").withIndex("by_source", (q) => q.eq("sourceId", source.sourceId)).unique();
      if (!stored) await ctx.db.insert("sources", { ...source, updatedAt });
    }
    for (const item of args.buried) {
      const stored = await ctx.db.query("buried").withIndex("by_key", (q) => q.eq("key", item.key)).unique();
      if (!stored) await ctx.db.insert("buried", { ...item, updatedAt });
      else if (item.day > stored.day) await ctx.db.patch(stored._id, { day: item.day, updatedAt });
    }
    if (args.settings) {
      const stored = await ctx.db.query("settings").first();
      if (!stored) await ctx.db.insert("settings", { ...args.settings, updatedAt });
      else {
        const { _id, _creationTime, updatedAt: _, ...current } = stored;
        const merged = mergeSettings(current, args.settings);
        if (!sameSettings(merged, current)) await ctx.db.patch(_id, { ...merged, updatedAt });
      }
    }
    return { serverTime: updatedAt };
  },
});

function sameSettings(a: Settings, b: Settings) {
  return (Object.keys(settingsFields) as (keyof Settings)[]).every((field) => a[field] === b[field]);
}

const tables = ["cards", "reviews", "entries", "sources", "buried", "settings"] as const;
type SyncTable = (typeof tables)[number] & keyof DataModel;

/** Rows of one table changed after `since` (server ms), oldest first, in pages. */
export const pull = query({
  args: {
    token: v.string(),
    table: v.union(...tables.map((t) => v.literal(t))),
    since: v.number(),
    cursor: v.union(v.string(), v.null()),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireToken(args.token);
    const numItems = Math.min(Math.max(args.numItems ?? 500, 1), 1000);
    const table: SyncTable = args.table;
    const result = await ctx.db
      .query(table)
      .withIndex("by_updated", (q) => q.gt("updatedAt", args.since))
      .paginate({ cursor: args.cursor, numItems });
    return {
      page: result.page.map(({ _id, _creationTime, ...row }) => row),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
      serverTime: Date.now(),
    };
  },
});
