import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { articleGender, fromAndroidJson, nounOf } from "../convex/entryRules";
import { skillsOf } from "../convex/skills";
import { TOKEN, setup, shipped, withToken, type T } from "./helpers";

beforeEach(() => { process.env.SYNC_TOKEN = TOKEN; });
afterEach(() => { delete process.env.SYNC_TOKEN; });

const intrigue = (o: Record<string, unknown> = {}) => shipped({
  entryId: "frw-2", word: "une intrigue", english: "a plot", definition: "Ensemble des événements d'une fiction.",
  examples: ["Ce roman développe {une intrigue} complexe."], lemma: "intrigue", gender: "feminine", ...o,
});

/** Stores an entry as rows written before gender existed look: no gender anywhere. */
async function insertLegacy(t: T, word: string, editedWord = word) {
  await t.run(async (ctx) => {
    const { entryId, origin, gender: _, ...content } = intrigue({ word, examples: [`Voici {${word}}.`] });
    await ctx.db.insert("entries", {
      entryId, origin, ...content, word: editedWord, examples: [`Voici {${editedWord}}.`],
      shipped: { ...content }, editedAt: editedWord === word ? null : 10, deletedAt: null,
      upstreamChanged: false, retired: false, updatedAt: 1,
    });
  });
}

describe("article gender", () => {
  test("reads the gender a leading article states", () => {
    expect(articleGender("une intrigue")).toBe("feminine");
    expect(articleGender("Un enjeu")).toBe("masculine");
    expect(articleGender("la plage")).toBe("feminine");
    expect(articleGender("le problème")).toBe("masculine");
    expect(articleGender("l'arbre")).toBeNull();
    expect(articleGender("unique")).toBeNull();
    expect(articleGender("pourtant")).toBeNull();
  });

  test("the noun is the word without its article", () => {
    expect(nounOf("une intrigue")).toBe("intrigue");
    expect(nounOf("l'arbre")).toBe("arbre");
    expect(nounOf("l’école")).toBe("école");
    expect(nounOf("arbre")).toBe("arbre");
  });

  test("content without a gender key takes the article gender; an explicit null stays", () => {
    expect(fromAndroidJson({ word: "une intrigue" }).gender).toBe("feminine");
    expect(fromAndroidJson({ word: "pourtant" }).gender).toBeNull();
    expect(fromAndroidJson({ word: "un peu", gender: null }).gender).toBeNull();
  });

  test("only nouns are studied for gender", () => {
    expect(skillsOf({ gender: null })).toEqual(["Reading", "Listening", "Production"]);
    expect(skillsOf({ gender: "feminine" })).toEqual(["Reading", "Listening", "Production", "Gender"]);
  });
});

describe("gender on stored entries", () => {
  test("the web refuses a gender that contradicts the article", async () => {
    const t = setup();
    const me = withToken(t);
    const { entryId: _, origin: __, ...content } = intrigue({ gender: "masculine" });
    await expect(me.mutation(api.entries.create, content)).rejects.toThrow(/doesn't match the article/);
  });

  test("the migration fills content and snapshot, so an edited noun isn't flagged by the next seed", async () => {
    const t = setup();
    await insertLegacy(t, "une intrigue", "une intrigue politique");
    expect(await t.mutation(internal.migrations.fillGender, {})).toEqual({ updated: 1 });
    expect(await t.mutation(internal.migrations.fillGender, {})).toEqual({ updated: 0 });
    const [row] = await t.run((ctx) => ctx.db.query("entries").collect());
    expect(row.gender).toBe("feminine");
    expect(row.shipped?.gender).toBe("feminine");

    const { gender: _, ...unchanged } = intrigue({ word: "une intrigue", examples: ["Voici {une intrigue}."] });
    await t.mutation(internal.seed.apply, { entries: [{ ...unchanged, gender: "feminine" }] });
    expect(await withToken(t).query(api.entries.upstreamChanges, {})).toEqual([]);
  });

  test("rows not yet migrated read with the article gender", async () => {
    const t = setup();
    await insertLegacy(t, "une intrigue");
    const me = withToken(t);
    expect((await me.query(api.entries.get, { entryId: "frw-2" }))?.gender).toBe("feminine");
    expect((await me.query(api.library.list, {})).entries[0].gender).toBe("feminine");
    const pulled = await t.query(api.sync.pull, { token: TOKEN, table: "entries", since: 0, cursor: null });
    expect(pulled.page[0]).toMatchObject({ gender: "feminine" });
  });

  test("a noun has a Gender card; other entries don't, even for suspend all", async () => {
    const t = setup();
    await t.mutation(internal.seed.apply, { entries: [shipped(), intrigue()] });
    const me = withToken(t);
    expect((await me.query(api.cards.forEntry, { entryId: "frw-1" })).map((c) => c.skill)).toEqual(["Reading", "Listening", "Production"]);
    expect((await me.query(api.cards.forEntry, { entryId: "frw-2" })).map((c) => c.skill)).toContain("Gender");
    await me.mutation(api.cards.suspend, { entryId: "frw-1", until: null });
    const keys = (await t.run((ctx) => ctx.db.query("cards").collect())).map((c) => c.key);
    expect(keys).not.toContain("frw-1:Gender");
  });
});
