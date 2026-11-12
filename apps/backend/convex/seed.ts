import { ConvexError, v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { contentOf, entryErrors } from "./entryRules";
import { applyShipped } from "./merge";
import { entryContent } from "./validators";

/**
 * Loads the shipped library (bundled and pack entries) into `entries`. Run through
 * `npm run seed`, which reads the repo's content files. Idempotent: re-running with
 * unchanged content writes nothing, so devices pull nothing new.
 */
export const apply = internalMutation({
  args: {
    entries: v.array(v.object({ entryId: v.string(), origin: v.string(), ...entryContent })),
  },
  handler: async (ctx, args) => {
    if (args.entries.length > 500) throw new ConvexError("At most 500 entries per seed batch");
    const updatedAt = Date.now();
    let inserted = 0, updated = 0;
    for (const { entryId, origin, ...content } of args.entries) {
      const problems = entryErrors(entryId, content);
      if (problems.length > 0) throw new ConvexError(`${entryId}: ${problems.map((p) => p.message).join("; ")}`);
      if (origin === "personal") throw new ConvexError(`${entryId}: seeded entries can't be personal`);
      const shipped = contentOf(content);
      const stored = await ctx.db.query("entries").withIndex("by_entry", (q) => q.eq("entryId", entryId)).unique();
      if (!stored) {
        await ctx.db.insert("entries", {
          entryId, ...shipped, origin, shipped, editedAt: null, deletedAt: null,
          upstreamChanged: false, retired: false, updatedAt,
        });
        inserted++;
      } else {
        const patch = applyShipped(stored, shipped, origin);
        if (patch) {
          await ctx.db.patch(stored._id, { ...patch, updatedAt });
          updated++;
        }
      }
    }
    return { inserted, updated };
  },
});

/** Marks seeded entries missing from the shipped library as retired. Personal entries are never touched. */
export const retire = internalMutation({
  args: { keep: v.array(v.string()) },
  handler: async (ctx, args) => {
    const keep = new Set(args.keep);
    const updatedAt = Date.now();
    let retired = 0;
    // The library is bounded (a few thousand entries), so one pass fits in a mutation.
    for (const entry of await ctx.db.query("entries").collect()) {
      if (entry.origin !== "personal" && !entry.retired && !keep.has(entry.entryId)) {
        await ctx.db.patch(entry._id, { retired: true, updatedAt });
        retired++;
      }
    }
    return { retired };
  },
});
