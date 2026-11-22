/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.*s");
const token = "test-token";
const empty = { cards: [], reviews: [], entries: [], sources: [], buried: [] };
const shipped = (o: Partial<{ entryId: string; word: string; definition: string; origin: string; gender: "masculine" | "feminine" | null }> = {}) => ({
  entryId: "frw-1", origin: "bundled", word: "avoir", english: "have", definition: "Posséder.", examples: ["{Avoir} de la force."],
  topic: "daily", lemma: "avoir", rank: 6, sourceUrl: "https://fr.wiktionary.org/wiki/avoir#fr", license: "CC BY-SA 4.0", gender: null as "masculine" | "feminine" | null, ...o,
});

beforeEach(() => { process.env.SYNC_TOKEN = token; });
afterEach(() => { delete process.env.SYNC_TOKEN; });

async function entries(t: ReturnType<typeof convexTest>) {
  return t.run((ctx) => ctx.db.query("entries").collect());
}
/** Simulates a learner edit arriving through sync. */
async function edit(t: ReturnType<typeof convexTest>, definition: string, editedAt: number) {
  const { origin: _, ...content } = shipped({ definition });
  await t.mutation(api.sync.push, { token, ...empty, entries: [{ ...content, editedAt, deletedAt: null }] });
}

describe("seed", () => {
  test("inserts shipped entries and is idempotent", async () => {
    const t = convexTest(schema, modules);
    expect(await t.mutation(internal.seed.apply, { entries: [shipped()] })).toEqual({ inserted: 1, updated: 0 });
    const [before] = await entries(t);
    expect(await t.mutation(internal.seed.apply, { entries: [shipped()] })).toEqual({ inserted: 0, updated: 0 });
    const [after] = await entries(t);
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(after).toMatchObject({ origin: "bundled", editedAt: null, upstreamChanged: false, retired: false });
  });

  test("updates unedited entries when shipped content changes", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.seed.apply, { entries: [shipped()] });
    await t.mutation(internal.seed.apply, { entries: [shipped({ definition: "Détenir." })] });
    expect(await entries(t)).toMatchObject([{ definition: "Détenir.", shipped: { definition: "Détenir." }, upstreamChanged: false }]);
  });

  test("keeps edits and flags upstream changes", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.seed.apply, { entries: [shipped()] });
    await edit(t, "Ma définition.", 100);
    await t.mutation(internal.seed.apply, { entries: [shipped({ definition: "Détenir." })] });
    expect(await entries(t)).toMatchObject([
      { definition: "Ma définition.", editedAt: 100, shipped: { definition: "Détenir." }, upstreamChanged: true },
    ]);
  });

  test("an edit matching the new shipped content isn't flagged", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.seed.apply, { entries: [shipped()] });
    await edit(t, "Détenir.", 100);
    await t.mutation(internal.seed.apply, { entries: [shipped({ definition: "Détenir." })] });
    expect(await entries(t)).toMatchObject([{ definition: "Détenir.", upstreamChanged: false }]);
  });

  test("retires entries missing from the library, never personal ones", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.seed.apply, { entries: [shipped(), shipped({ entryId: "frw-2" })] });
    const { origin: _, ...personal } = shipped({ entryId: "personal-1" });
    await t.mutation(api.sync.push, { token, ...empty, entries: [{ ...personal, editedAt: null, deletedAt: null }] });
    expect(await t.mutation(internal.seed.retire, { keep: ["frw-1"] })).toEqual({ retired: 1 });
    const byId = Object.fromEntries((await entries(t)).map((e) => [e.entryId, e.retired]));
    expect(byId).toEqual({ "frw-1": false, "frw-2": true, "personal-1": false });
    await t.mutation(internal.seed.apply, { entries: [shipped({ entryId: "frw-2" })] });
    expect((await entries(t)).find((e) => e.entryId === "frw-2")?.retired).toBe(false);
  });

  test("refuses invalid shipped entries", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(internal.seed.apply, { entries: [shipped({ word: "" })] })).rejects.toThrow(/Fill every field/);
  });
});

describe("seed with answer alternatives", () => {
  const withExamples = (examples: string[], definition = "Posséder.") => ({ ...shipped({ definition }), examples });
  async function editExamples(t: ReturnType<typeof convexTest>, examples: string[], editedAt: number) {
    const { origin: _, ...content } = withExamples(examples, "Ma définition.");
    await t.mutation(api.sync.push, { token, ...empty, entries: [{ ...content, editedAt, deletedAt: null }] });
  }

  test("an edited entry gains new shipped alternatives without an upstream flag", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.seed.apply, { entries: [withExamples(["Je vais {avoir} faim.", "Il faut {avoir} de la force."])] });
    await editExamples(t, ["Je vais {avoir|ressentir} faim.", "Il faut {avoir} de la force."], 100);
    await t.mutation(internal.seed.apply, { entries: [withExamples(["Je vais {avoir|éprouver} faim.", "Il faut {avoir|posséder} de la force."])] });
    expect(await entries(t)).toMatchObject([{
      definition: "Ma définition.", editedAt: 100, upstreamChanged: false,
      examples: ["Je vais {avoir|ressentir|éprouver} faim.", "Il faut {avoir|posséder} de la force."],
    }]);
  });

  test("a rewritten sentence gains nothing, and a wording change is still flagged", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.seed.apply, { entries: [withExamples(["Je vais {avoir} faim."])] });
    await editExamples(t, ["Je vais {avoir} très faim."], 100);
    await t.mutation(internal.seed.apply, { entries: [withExamples(["Je vais {avoir|éprouver} faim."])] });
    expect(await entries(t)).toMatchObject([{ examples: ["Je vais {avoir} très faim."], upstreamChanged: false }]);
    await t.mutation(internal.seed.apply, { entries: [withExamples(["Je vais {avoir|éprouver} faim."], "Détenir.")] });
    expect(await entries(t)).toMatchObject([{ examples: ["Je vais {avoir} très faim."], upstreamChanged: true }]);
  });

  test("an alternative the learner removed isn't added back", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.seed.apply, { entries: [withExamples(["Je vais {avoir|éprouver} faim."])] });
    await editExamples(t, ["Je vais {avoir} faim."], 100);
    await t.mutation(internal.seed.apply, { entries: [withExamples(["Je vais {avoir|éprouver|ressentir} faim."])] });
    expect(await entries(t)).toMatchObject([{ examples: ["Je vais {avoir|ressentir} faim."], upstreamChanged: false }]);
  });
});
