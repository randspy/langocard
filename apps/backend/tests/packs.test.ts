import { afterEach, beforeEach, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { TOKEN, setup, shipped, withToken } from "./helpers";

beforeEach(() => { process.env.SYNC_TOKEN = TOKEN; });
afterEach(() => { delete process.env.SYNC_TOKEN; });
const day = "2026-11-20", now = Date.parse("2026-11-20T09:00:00Z");
const pull = async (t: ReturnType<typeof setup>, table: "settings" | "sources") =>
  (await t.query(api.sync.pull, { token: TOKEN, table, since: 0, cursor: null })).page as Record<string, unknown>[];

test("preferences change the next new meaning and sync with a newer clock", async () => {
  const t = setup(), client = withToken(t);
  await t.mutation(internal.seed.apply, { entries: [
    shipped({ entryId: "low", rank: 100, topic: "daily" }), shipped({ entryId: "mid", rank: 3000, topic: "daily" }),
    shipped({ entryId: "news", rank: 3001, topic: "news" }),
  ] });
  expect(await client.query(api.packs.learningPreferences, {})).toEqual({ minimumRank: 2501, interests: ["daily", "culture", "news"] });
  expect((await client.query(api.study.next, { day, now }))?.key).toBe("mid:Reading");
  await client.mutation(api.packs.setPreferences, { minimumRank: 1, interests: ["news"] });
  expect((await client.query(api.study.next, { day, now }))?.key).toBe("low:Reading");
  await client.mutation(api.packs.setPreferences, { minimumRank: 2501, interests: ["culture", "news"] });
  expect((await client.query(api.study.next, { day, now }))?.key).toBe("news:Reading");
  const [settings] = await pull(t, "settings");
  expect(settings).toMatchObject({ minimumRank: 2501, interests: "culture,news" });
  // An older phone change loses; the phone adopts the web's on its next pull.
  await t.mutation(api.sync.push, { token: TOKEN, cards: [], reviews: [], entries: [], sources: [], buried: [], settings: {
    placementDone: false, placementIndex: 0, nextCardId: 0, minimumRank: 7001, interests: "daily",
    preferencesChangedAt: 1, day, seconds: 0, introduced: 0 } });
  expect((await pull(t, "settings"))[0]).toMatchObject({ minimumRank: 2501, interests: "culture,news" });
  await expect(client.mutation(api.packs.setPreferences, { minimumRank: 3, interests: ["daily"] })).rejects.toThrow();
  await expect(client.mutation(api.packs.setPreferences, { minimumRank: 1, interests: [] })).rejects.toThrow();
});

test("installing a pack records Android's source row and makes its entries studied", async () => {
  const t = setup(), client = withToken(t);
  await t.mutation(internal.seed.apply, { entries: [shipped({ entryId: "pack-1", origin: "pack:fr-extra", rank: 3000 })] });
  expect(await client.query(api.study.next, { day, now })).toBeNull();
  const pack = { packId: "fr-extra", packVersion: 2, source: "Wiktionary contributors", license: "CC BY-SA 4.0" };
  await client.mutation(api.packs.installPack, pack);
  await client.mutation(api.packs.installPack, pack);
  expect(await client.query(api.packs.installedPacks, {})).toEqual(["fr-extra"]);
  const sources = await pull(t, "sources");
  expect(sources).toHaveLength(1);
  expect(sources[0]).toMatchObject({ sourceId: "fr-extra" });
  expect(JSON.parse(sources[0].source as string)).toEqual({ source: "Wiktionary contributors", license: "CC BY-SA 4.0", packId: "fr-extra", packVersion: 2 });
  expect((await client.query(api.study.next, { day, now }))?.key).toBe("pack-1:Reading");
});
