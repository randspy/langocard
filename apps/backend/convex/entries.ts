import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { contentOf, entryErrors, sameContent, type EntryContent } from "./entryRules";
import { requireToken } from "./access";
import { entryVersion, isDeleted } from "./merge";
import { entryContent } from "./validators";

/**
 * Web app entry management. Every change advances the entry's version clock
 * (`editedAt` / `deletedAt`), so it wins over older copies and reaches Android on its
 * next sync. Deletion is a tombstone, so cards and review history are kept.
 */

function assertValid(entryId: string, content: EntryContent) {
  const errors = entryErrors(entryId, content);
  if (errors.length > 0) throw new ConvexError(errors.map((e) => e.message).join("; "));
}

async function load(ctx: MutationCtx, entryId: string) {
  const entry = await ctx.db.query("entries").withIndex("by_entry", (q) => q.eq("entryId", entryId)).unique();
  if (!entry) throw new ConvexError("Entry not found");
  return entry;
}

/** A clock value strictly after the entry's current version, even within the same millisecond. */
function nextClock(entry: { editedAt: number | null; deletedAt: number | null }): number {
  return Math.max(Date.now(), entryVersion(entry) + 1);
}

export const get = query({
  args: { token: v.string(), entryId: v.string() },
  handler: async (ctx, { token, entryId }) => {
    requireToken(token);
    const entry = await ctx.db.query("entries").withIndex("by_entry", (q) => q.eq("entryId", entryId)).unique();
    if (!entry) return null;
    const { _id, _creationTime, updatedAt, ...row } = entry;
    return {
      ...row,
      edited: row.shipped !== null && !sameContent(contentOf(row), row.shipped),
      deleted: isDeleted(row),
    };
  },
});

export const create = mutation({
  args: { token: v.string(), ...entryContent },
  handler: async (ctx, { token, ...content }) => {
    requireToken(token);
    const entryId = `personal-${crypto.randomUUID()}`;
    assertValid(entryId, content);
    await ctx.db.insert("entries", {
      entryId, ...contentOf(content), editedAt: null, deletedAt: null,
      origin: "personal", shipped: null, upstreamChanged: false, retired: false, updatedAt: Date.now(),
    });
    return entryId;
  },
});

export const update = mutation({
  args: { token: v.string(), entryId: v.string(), ...entryContent },
  handler: async (ctx, { token, entryId, ...content }) => {
    requireToken(token);
    assertValid(entryId, content);
    const entry = await load(ctx, entryId);
    if (isDeleted(entry)) throw new ConvexError("Restore the entry before editing it");
    if (sameContent(contentOf(entry), content)) return;
    // Editing so that the content matches the shipped version again resolves any upstream flag.
    const upstreamChanged = entry.upstreamChanged && !(entry.shipped && sameContent(entry.shipped, content));
    await ctx.db.patch(entry._id, { ...contentOf(content), editedAt: nextClock(entry), upstreamChanged, updatedAt: Date.now() });
  },
});

export const remove = mutation({
  args: { token: v.string(), entryId: v.string() },
  handler: async (ctx, { token, entryId }) => {
    requireToken(token);
    const entry = await load(ctx, entryId);
    if (isDeleted(entry)) return;
    await ctx.db.patch(entry._id, { deletedAt: nextClock(entry), updatedAt: Date.now() });
  },
});

export const restore = mutation({
  args: { token: v.string(), entryId: v.string() },
  handler: async (ctx, { token, entryId }) => {
    requireToken(token);
    const entry = await load(ctx, entryId);
    if (!isDeleted(entry)) return;
    await ctx.db.patch(entry._id, { editedAt: nextClock(entry), updatedAt: Date.now() });
  },
});

/** Edited entries whose shipped content changed since, with both versions to compare. */
export const upstreamChanges = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    requireToken(token);
    const rows = await ctx.db.query("entries").withIndex("by_upstreamChanged", (q) => q.eq("upstreamChanged", true)).take(1000);
    return rows
      .filter((row) => row.shipped !== null && !isDeleted(row))
      .map((row) => ({ entryId: row.entryId, origin: row.origin, mine: contentOf(row), theirs: row.shipped! }))
      .sort((a, b) => a.mine.word.localeCompare(b.mine.word, "fr"));
  },
});

/**
 * Settles an upstream change. "keepMine" keeps the learner's wording; "takeTheirs" adopts
 * the shipped content, after which the entry follows future content updates again.
 */
export const resolveUpstream = mutation({
  args: { token: v.string(), entryId: v.string(), choice: v.union(v.literal("keepMine"), v.literal("takeTheirs")) },
  handler: async (ctx, { token, entryId, choice }) => {
    requireToken(token);
    const entry = await load(ctx, entryId);
    if (!entry.upstreamChanged || !entry.shipped) return;
    if (choice === "keepMine") {
      await ctx.db.patch(entry._id, { upstreamChanged: false, updatedAt: Date.now() });
    } else {
      await ctx.db.patch(entry._id, { ...entry.shipped, editedAt: nextClock(entry), upstreamChanged: false, updatedAt: Date.now() });
    }
  },
});
