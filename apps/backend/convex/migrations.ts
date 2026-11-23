import { withStudyProgress } from "./studyProgress";
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { refreshCard } from "./studyIndex";
import { contentOf } from "./entryRules";

const BATCH = 500;

/**
 * Gives every entry stored before gender existed its article gender, on both its own
 * content and its `shipped` snapshot, so edited entries still match what was shipped.
 * Writes nothing new to devices (`updatedAt` is unchanged: the content they hold
 * already reads the same). Run until it reports `updated: 0`.
 */
export const fillGender = internalMutation({
  args: {},
  handler: async (ctx) => {
    let updated = 0;
    for await (const entry of ctx.db.query("entries")) {
      if (updated >= BATCH) break;
      const ownMissing = entry.gender === undefined;
      const shippedMissing = entry.shipped !== null && entry.shipped.gender === undefined;
      if (!ownMissing && !shippedMissing) continue;
      await ctx.db.patch(entry._id, {
        gender: contentOf(entry).gender,
        shipped: entry.shipped && contentOf(entry.shipped),
      });
      updated++;
    }
    return { updated };
  },
});

/**
 * Fills (or rebuilds) the derived scheduling columns of every card for web study. Pass the
 * returned `cursor` back until `isDone`: `npx convex run migrations:deriveCards '{"cursor":null}'`.
 */
export const deriveCards = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("cards").paginate({ cursor, numItems: BATCH });
    for (const row of page.page) await refreshCard(ctx, row._id);
    return { cursor: page.continueCursor, isDone: page.isDone };
  },
});

/** Rebuilds bounded memory slots and entry indexes without changing sync clocks. */
export const deriveEntryProgress = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("entries").paginate({ cursor, numItems: 100 });
    await withStudyProgress(ctx, async (progress) => {
      for (const entry of page.page) await progress.entryChanged(entry);
    });
    return { cursor: page.continueCursor, isDone: page.isDone };
  },
});

/** Counts each historical sentence review exactly once, safely across retries and live sync. */
export const countExposures = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("reviews").paginate({ cursor, numItems: 100 });
    await withStudyProgress(ctx, async (progress) => {
      for (const review of page.page) if (!review.exposureCounted) {
        await progress.review(review.key);
        await ctx.db.patch(review._id, { exposureCounted: true });
      }
    });
    return { cursor: page.continueCursor, isDone: page.isDone };
  },
});
