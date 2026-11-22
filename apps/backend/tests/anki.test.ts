import { afterEach, beforeEach, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { TOKEN, setup, shipped, withToken } from "./helpers";

beforeEach(() => { process.env.SYNC_TOKEN = TOKEN; });
afterEach(() => { delete process.env.SYNC_TOKEN; });

test("pages through the active library and lists installed packs' credits", async () => {
  const t = setup();
  const entries = Array.from({ length: 1200 }, (_, i) => shipped({ entryId: `frw-${i}` }));
  entries.push(shipped({ entryId: "frw-pack", origin: "pack:fr-extra" }), shipped({ entryId: "frw-dormant", origin: "pack:fr-other" }));
  for (let i = 0; i < entries.length; i += 500) await t.mutation(internal.seed.apply, { entries: entries.slice(i, i + 500) });
  await t.run(async (ctx) => {
    await ctx.db.insert("sources", { sourceId: "fr-extra", source: JSON.stringify({ source: "W", license: "L", packId: "fr-extra" }), updatedAt: 1 });
    await ctx.db.insert("sources", { sourceId: "x", source: "not json", updatedAt: 2 });
    const deleted = (await ctx.db.query("entries").collect()).find((e) => e.entryId === "frw-3")!;
    await ctx.db.patch(deleted._id, { deletedAt: 10 });
  });
  const client = withToken(t);
  const ids: string[] = [];
  let cursor: string | null = null;
  for (let pages = 0; ; pages++) {
    const page: { entries: { entryId: string }[]; isDone: boolean; continueCursor: string } = await client.query(api.anki.page, { cursor });
    ids.push(...page.entries.map((e) => e.entryId));
    if (page.isDone) break;
    cursor = page.continueCursor;
    expect(pages).toBeLessThan(10);
  }
  expect(ids).toHaveLength(1200);
  expect(ids).toContain("frw-pack");
  expect(ids).not.toContain("frw-dormant");
  expect(ids).not.toContain("frw-3");
  expect(await client.query(api.anki.credits, {})).toEqual([{ source: "W", license: "L" }]);
});
