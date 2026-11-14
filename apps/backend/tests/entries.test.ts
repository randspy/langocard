import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { TOKEN, setup, shipped, withToken, type T } from "./helpers";

const token = TOKEN;
beforeEach(() => { process.env.SYNC_TOKEN = token; });
afterEach(() => { delete process.env.SYNC_TOKEN; });

const content = (o: Record<string, unknown> = {}) => {
  const { entryId: _, origin: __, ...rest } = shipped(o);
  return rest;
};
async function owner(t: T) {
  await t.mutation(internal.seed.apply, { entries: [shipped()] });
  return withToken(t);
}
const pullEntries = async (t: T) =>
  (await t.query(api.sync.pull, { token, table: "entries", since: 0, cursor: null })).page as Record<string, unknown>[];

describe("entries", () => {
  test("refuses anyone but the owner", async () => {
    const t = setup();
    const stranger = withToken(t, "wrong-token");
    await expect(stranger.mutation(api.entries.create, content())).rejects.toThrow(/Invalid sync token/);
    await expect(stranger.query(api.entries.get, { entryId: "frw-1" })).rejects.toThrow(/Invalid sync token/);
  });

  test("creates personal entries that sync to devices", async () => {
    const t = setup();
    const me = await owner(t);
    const entryId = await me.mutation(api.entries.create, content({ word: "une trouvaille", rank: null }));
    expect(entryId).toMatch(/^personal-/);
    expect(await me.query(api.entries.get, { entryId })).toMatchObject({ word: "une trouvaille", origin: "personal", edited: false });
    expect((await pullEntries(t)).map((e) => e.entryId)).toContain(entryId);
  });

  test("rejects invalid content with the entry rule message", async () => {
    const t = setup();
    const me = await owner(t);
    await expect(me.mutation(api.entries.create, content({ examples: ["no answer"] }))).rejects.toThrow(/Mark exactly one answer/);
    await expect(me.mutation(api.entries.update, { entryId: "frw-1", ...content({ topic: "sport" }) })).rejects.toThrow(/Unknown topic/);
  });

  test("edits a shipped entry and marks it edited", async () => {
    const t = setup();
    const me = await owner(t);
    await me.mutation(api.entries.update, { entryId: "frw-1", ...content({ definition: "Ma définition." }) });
    const entry = await me.query(api.entries.get, { entryId: "frw-1" });
    expect(entry).toMatchObject({ definition: "Ma définition.", edited: true, shipped: { definition: "Posséder." } });
    expect(entry!.editedAt).toBeGreaterThan(0);
    // An older device copy can't overwrite the edit.
    await t.mutation(api.sync.push, { token, cards: [], reviews: [], sources: [], buried: [], entries: [{ entryId: "frw-1", ...content(), editedAt: 1, deletedAt: null }] });
    expect((await me.query(api.entries.get, { entryId: "frw-1" }))!.definition).toBe("Ma définition.");
  });

  test("an unchanged save writes nothing", async () => {
    const t = setup();
    const me = await owner(t);
    await me.mutation(api.entries.update, { entryId: "frw-1", ...content() });
    expect((await me.query(api.entries.get, { entryId: "frw-1" }))!.editedAt).toBeNull();
  });

  test("deletes and restores, keeping the content", async () => {
    const t = setup();
    const me = await owner(t);
    await me.mutation(api.entries.remove, { entryId: "frw-1" });
    expect(await me.query(api.entries.get, { entryId: "frw-1" })).toMatchObject({ deleted: true });
    await expect(me.mutation(api.entries.update, { entryId: "frw-1", ...content({ word: "x" }) })).rejects.toThrow(/Restore/);
    await me.mutation(api.entries.restore, { entryId: "frw-1" });
    expect(await me.query(api.entries.get, { entryId: "frw-1" })).toMatchObject({ deleted: false, word: "avoir" });
    expect((await pullEntries(t))[0]).toMatchObject({ entryId: "frw-1" });
  });

  test("editing back to the new shipped wording clears the upstream flag", async () => {
    const t = setup();
    const me = await owner(t);
    await me.mutation(api.entries.update, { entryId: "frw-1", ...content({ definition: "Mine." }) });
    await t.mutation(internal.seed.apply, { entries: [shipped({ definition: "Détenir." })] });
    expect(await me.query(api.entries.get, { entryId: "frw-1" })).toMatchObject({ upstreamChanged: true });
    await me.mutation(api.entries.update, { entryId: "frw-1", ...content({ definition: "Détenir." }) });
    expect(await me.query(api.entries.get, { entryId: "frw-1" })).toMatchObject({ upstreamChanged: false, edited: false });
  });
});

describe("upstream changes", () => {
  async function conflicted(t: T) {
    const me = await owner(t);
    await me.mutation(api.entries.update, { entryId: "frw-1", ...content({ definition: "Mine." }) });
    await t.mutation(internal.seed.apply, { entries: [shipped({ definition: "Détenir." })] });
    return me;
  }

  test("lists edited entries whose shipped content changed", async () => {
    const t = setup();
    const me = await conflicted(t);
    expect(await me.query(api.entries.upstreamChanges, {})).toMatchObject([
      { entryId: "frw-1", mine: { definition: "Mine." }, theirs: { definition: "Détenir." } },
    ]);
  });

  test("keep mine clears the flag and keeps the edit", async () => {
    const t = setup();
    const me = await conflicted(t);
    await me.mutation(api.entries.resolveUpstream, { entryId: "frw-1", choice: "keepMine" });
    expect(await me.query(api.entries.get, { entryId: "frw-1" })).toMatchObject({ definition: "Mine.", upstreamChanged: false, edited: true });
    expect(await me.query(api.entries.upstreamChanges, {})).toEqual([]);
  });

  test("take theirs adopts shipped content, syncs, and follows later updates", async () => {
    const t = setup();
    const me = await conflicted(t);
    const before = (await me.query(api.entries.get, { entryId: "frw-1" }))!.editedAt!;
    await me.mutation(api.entries.resolveUpstream, { entryId: "frw-1", choice: "takeTheirs" });
    const entry = await me.query(api.entries.get, { entryId: "frw-1" });
    expect(entry).toMatchObject({ definition: "Détenir.", upstreamChanged: false, edited: false });
    expect(entry!.editedAt).toBeGreaterThan(before);
    await t.mutation(internal.seed.apply, { entries: [shipped({ definition: "Avoir en sa possession." })] });
    expect(await me.query(api.entries.get, { entryId: "frw-1" })).toMatchObject({ definition: "Avoir en sa possession.", upstreamChanged: false });
  });
});
