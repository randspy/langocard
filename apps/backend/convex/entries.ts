import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { contentOf, entryErrors, sameContent, type EntryContent } from "./entryRules";
import { entryVersion, isDeleted } from "./merge";
import { requireOwner } from "./owner";
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
  args: { entryId: v.string() },
  handler: async (ctx, { entryId }) => {
    await requireOwner(ctx);
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
  args: entryContent,
  handler: async (ctx, content) => {
    await requireOwner(ctx);
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
  args: { entryId: v.string(), ...entryContent },
  handler: async (ctx, { entryId, ...content }) => {
    await requireOwner(ctx);
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
  args: { entryId: v.string() },
  handler: async (ctx, { entryId }) => {
    await requireOwner(ctx);
    const entry = await load(ctx, entryId);
    if (isDeleted(entry)) return;
    await ctx.db.patch(entry._id, { deletedAt: nextClock(entry), updatedAt: Date.now() });
  },
});

export const restore = mutation({
  args: { entryId: v.string() },
  handler: async (ctx, { entryId }) => {
    await requireOwner(ctx);
    const entry = await load(ctx, entryId);
    if (!isDeleted(entry)) return;
    await ctx.db.patch(entry._id, { editedAt: nextClock(entry), updatedAt: Date.now() });
  },
});
