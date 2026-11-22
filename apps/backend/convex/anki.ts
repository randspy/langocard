import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireToken } from "./access";
import { contentOf } from "./entryRules";
import { isDeleted } from "./merge";

/**
 * Library data for the web app's Anki export, read in pages so the whole library never
 * goes through one query. The export file itself is built in the browser.
 */

/** Pack IDs installed on some device (synced `sources` rows carry Android's source JSON). */
async function installedPacks(ctx: QueryCtx): Promise<Set<string>> {
  const packs = new Set<string>();
  for (const row of await ctx.db.query("sources").collect()) {
    const packId = parseSource(row.source)?.packId;
    if (typeof packId === "string" && packId) packs.add(packId);
  }
  return packs;
}

function parseSource(source: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(source);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * One page of the active library, as a phone studies it: bundled, personal and installed-pack
 * entries that aren't deleted. Retired entries stay, as on Android.
 */
export const page = query({
  args: { token: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { token, cursor }) => {
    requireToken(token);
    const installed = await installedPacks(ctx);
    const result = await ctx.db.query("entries").paginate({ cursor, numItems: 500 });
    const entries = result.page
      .filter((e) => !isDeleted(e) && (!e.origin.startsWith("pack:") || installed.has(e.origin.slice("pack:".length))))
      .map((e) => ({ entryId: e.entryId, origin: e.origin, ...contentOf(e) }));
    return { entries, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});

/** Source and licence of each installed pack, in installation order, for the export's attribution. */
export const credits = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    requireToken(token);
    const credits: { source: string; license: string }[] = [];
    for (const row of await ctx.db.query("sources").collect()) {
      const source = parseSource(row.source);
      if (typeof source?.source === "string" && typeof source.license === "string") {
        credits.push({ source: source.source, license: source.license });
      }
    }
    return credits;
  },
});
