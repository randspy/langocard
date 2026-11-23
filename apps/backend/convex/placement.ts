import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireToken } from "./access";
import { newSettings, repairedPreferences } from "./study";
import { STARTING_RANKS } from "./vocabularyPlacement";

/**
 * The web's vocabulary starting check. Answers are saved one at a time so the check resumes after
 * a reload; they stay on the server for the web only. Accepting a starting rank writes the synced
 * preference (and marks placement done) as Android does; no card is ever marked known.
 */
const ITEMS = 90;

export const progress = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    requireToken(token);
    return (await ctx.db.query("placementProgress").first())?.answers ?? [];
  },
});

/** Records the answer to item `index`; a repeated answer (a double click, a retry) changes nothing. */
export const answer = mutation({
  args: { token: v.string(), index: v.number(), known: v.boolean() },
  handler: async (ctx, { token, index, known }) => {
    requireToken(token);
    const row = await ctx.db.query("placementProgress").first();
    const answers = row?.answers ?? [];
    if (index < answers.length) return;
    if (index !== answers.length || index >= ITEMS) throw new ConvexError("Answer the words in order");
    if (row) await ctx.db.patch(row._id, { answers: [...answers, known] });
    else await ctx.db.insert("placementProgress", { answers: [known] });
  },
});

/** Starts the check again from the first word. */
export const retake = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    requireToken(token);
    const row = await ctx.db.query("placementProgress").first();
    if (row) await ctx.db.delete(row._id);
  },
});

/** Saves the starting rank the learner chose after the check, which phones adopt on their next sync. */
export const accept = mutation({
  args: { token: v.string(), rank: v.number() },
  handler: async (ctx, { token, rank }) => {
    requireToken(token);
    if (!(STARTING_RANKS as readonly number[]).includes(rank)) throw new ConvexError("Unknown starting rank");
    if (((await ctx.db.query("placementProgress").first())?.answers.length ?? 0) < ITEMS) throw new ConvexError("Finish the check first");
    const settings = await ctx.db.query("settings").first();
    const now = Date.now();
    const changed = { minimumRank: rank, placementDone: true, preferencesChangedAt: Math.max(now, (settings?.preferencesChangedAt ?? 0) + 1), updatedAt: now };
    // Topics a placeholder row holds in a form Android rejects are repaired too, or the phone would drop the row.
    if (settings) await ctx.db.patch(settings._id, { ...repairedPreferences(settings), ...changed });
    else await ctx.db.insert("settings", { ...newSettings(""), ...changed });
  },
});
