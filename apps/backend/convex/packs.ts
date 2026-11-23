import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireToken } from "./access";
import { TOPICS } from "./entryRules";
import { MINIMUM_RANKS, newSettings, preferences } from "./study";

/**
 * The web's Packs page: learning preferences and pack installation, written the way Android
 * writes them so every phone adopts them on its next sync.
 */

/** The starting rank and topic interests that pick new meanings. */
export const learningPreferences = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    requireToken(token);
    return preferences(await ctx.db.query("settings").first());
  },
});

/**
 * Changes the preferences with a new change clock, so the latest change wins on every device.
 * At least one topic stays selected, as on Android.
 */
export const setPreferences = mutation({
  args: { token: v.string(), minimumRank: v.number(), interests: v.array(v.string()) },
  handler: async (ctx, { token, minimumRank, interests }) => {
    requireToken(token);
    if (!MINIMUM_RANKS.includes(minimumRank)) throw new ConvexError("Unknown starting rank");
    const topics = TOPICS.filter((t) => interests.includes(t));
    if (topics.length === 0 || topics.length !== new Set(interests).size) throw new ConvexError("Choose at least one known topic");
    const settings = await ctx.db.query("settings").first();
    const now = Date.now();
    const changed = { minimumRank, interests: topics.join(","), preferencesChangedAt: Math.max(now, (settings?.preferencesChangedAt ?? 0) + 1), updatedAt: now };
    if (settings) await ctx.db.patch(settings._id, changed);
    // No daily counters yet: an empty day loses to any device's real day.
    else await ctx.db.insert("settings", { ...newSettings(""), ...changed });
  },
});

/** Pack IDs installed on some device (a pack's source row is keyed by its pack ID). */
export const installedPacks = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    requireToken(token);
    return (await ctx.db.query("sources").collect()).filter((s) => !s.sourceId.includes("|")).map((s) => s.sourceId);
  },
});

/**
 * Installs a catalogue pack by recording its source row as Android does. Convex already holds
 * the pack's entries, so they are studied on the web at once and phones install the pack on their
 * next sync. There is no uninstall.
 */
export const installPack = mutation({
  args: { token: v.string(), packId: v.string(), packVersion: v.number(), source: v.string(), license: v.string() },
  handler: async (ctx, { token, packId, packVersion, source, license }) => {
    requireToken(token);
    if (!/^[a-z0-9-]+$/.test(packId) || !source.trim() || !license.trim() || !Number.isInteger(packVersion)) {
      throw new ConvexError("Invalid pack");
    }
    if (await ctx.db.query("sources").withIndex("by_source", (q) => q.eq("sourceId", packId)).first()) return;
    // Android's source JSON, in its key order.
    await ctx.db.insert("sources", { sourceId: packId, source: JSON.stringify({ source, license, packId, packVersion }), updatedAt: Date.now() });
  },
});
