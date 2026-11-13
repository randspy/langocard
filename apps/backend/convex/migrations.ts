import { internalMutation } from "./_generated/server";
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
