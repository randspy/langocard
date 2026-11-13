import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireToken } from "./access";
import type { DataModel } from "./_generated/dataModel";
import { contentOf, entryErrors } from "./entryRules";
import { entryWins, mergeCard, mergeSettings, sameCard, type Settings } from "./merge";
import { cardFields, entryClocks, entryContent, settingsFields } from "./validators";

/**
 * Single-user sync API for the Android app (protocol v2). Every call carries the shared
 * `SYNC_TOKEN` (see access.ts).
 */

const MAX_BATCH = 500;

export const push = mutation({
  args: {
    token: v.string(),
    cards: v.array(v.object({ key: v.string(), ...cardFields })),
    reviews: v.array(v.object({ reviewId: v.string(), key: v.string(), placement: v.boolean(), log: v.string() })),
    entries: v.array(v.object({ entryId: v.string(), ...entryContent, ...entryClocks })),
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
    /** Entry IDs the server refused: invalid content, or an unknown non-personal entry. */
    const rejected: string[] = [];

    for (const { key, ...incoming } of args.cards) {
      const stored = await ctx.db.query("cards").withIndex("by_key", (q) => q.eq("key", key)).unique();
      if (!stored) await ctx.db.insert("cards", { key, ...incoming, updatedAt });
      else {
        const merged = mergeCard(stored, incoming);
        if (!sameCard(merged, stored)) await ctx.db.patch(stored._id, { ...merged, updatedAt });
      }
    }
    for (const review of args.reviews) {
      const stored = await ctx.db.query("reviews").withIndex("by_review", (q) => q.eq("reviewId", review.reviewId)).unique();
      if (!stored) await ctx.db.insert("reviews", { ...review, updatedAt });
    }
    for (const { entryId, editedAt, deletedAt, ...content } of args.entries) {
      if (entryErrors(entryId, content).length > 0) {
        rejected.push(entryId);
        continue;
      }
      const stored = await ctx.db.query("entries").withIndex("by_entry", (q) => q.eq("entryId", entryId)).unique();
      if (!stored) {
        // Bundled and pack entries come from the seed; devices may only add personal ones.
        if (!entryId.startsWith("personal-")) rejected.push(entryId);
        else {
          await ctx.db.insert("entries", {
            entryId, ...contentOf(content), editedAt, deletedAt,
            origin: "personal", shipped: null, upstreamChanged: false, retired: false, updatedAt,
          });
        }
      } else if (entryWins({ editedAt, deletedAt }, stored)) {
        await ctx.db.patch(stored._id, { ...contentOf(content), editedAt, deletedAt, updatedAt });
      }
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
    return { serverTime: updatedAt, rejected };
  },
});

function sameSettings(a: Settings, b: Settings) {
  return (Object.keys(settingsFields) as (keyof Settings)[]).every((field) => a[field] === b[field]);
}

const tables = ["cards", "reviews", "entries", "sources", "buried", "settings"] as const;
type SyncTable = (typeof tables)[number] & keyof DataModel;

/**
 * Rows of one table changed after `since` (server ms), oldest first, in pages. Rows are
 * already merged on the server, so a device adopts them unless it holds a newer local change.
 * Entries omit the server-only `shipped` snapshot.
 */
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
      page: result.page.map(({ _id, _creationTime, ...row }) => {
        if ("shipped" in row) {
          const { shipped: _, ...entry } = row;
          return { ...entry, ...contentOf(entry) };
        }
        return row;
      }),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
      serverTime: Date.now(),
    };
  },
});
