/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";
import { mergeSettings, SUSPENDED_INDEFINITELY, type Settings } from "../convex/merge";

const modules = import.meta.glob("../convex/**/*.*s");
const token = "test-token";
const empty = { cards: [], reviews: [], entries: [], sources: [], buried: [] };
const settings: Settings = {
  placementDone: false, placementIndex: 0, nextCardId: 0, minimumRank: 2501, interests: "daily",
  preferencesChangedAt: 0, day: "2026-11-12", seconds: 0, introduced: 0,
};
const card = (o: Partial<{ card: string | null; lastReview: number; failures: number; pausedUntil: number; suspendedUntil: number; cardEditedAt: number }> = {}) =>
  ({ key: "e1:Reading", card: '{"v":1}', lastReview: 100, failures: 0, pausedUntil: 0, suspendedUntil: 0, cardEditedAt: 0, ...o });
const entry = (o: Partial<{ entryId: string; word: string; examples: string[]; gender: "masculine" | "feminine" | null; editedAt: number | null; deletedAt: number | null }> = {}) => ({
  entryId: "personal-1", word: "pourtant", english: "however", definition: "Malgré cela.", examples: ["Il pleut, {pourtant} elle sort."],
  topic: "daily", lemma: "", rank: null, sourceUrl: "", license: "", gender: null as "masculine" | "feminine" | null, editedAt: null, deletedAt: null, ...o,
});

beforeEach(() => { process.env.SYNC_TOKEN = token; });
afterEach(() => { delete process.env.SYNC_TOKEN; });

type Table = "cards" | "reviews" | "entries" | "buried" | "settings";
async function pullAll(t: ReturnType<typeof convexTest>, table: Table, since = 0) {
  // Rows of any table; tests read the fields of the table they pulled.
  return (await t.query(api.sync.pull, { token, table, since, cursor: null })).page as Record<string, any>[];
}

describe("sync", () => {
  test("rejects a wrong token", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.sync.push, { token: "nope", ...empty })).rejects.toThrow(/Invalid sync token/);
    await expect(t.query(api.sync.pull, { token: "nope", table: "cards", since: 0, cursor: null })).rejects.toThrow(/Invalid sync token/);
  });

  test("rejects a v1 push shape", async () => {
    const t = convexTest(schema, modules);
    const v1Card = { key: "e1:Reading", card: "{}", lastReview: 1, failures: 0, pausedUntil: 0 };
    await expect(t.mutation(api.sync.push, { token, ...empty, cards: [v1Card as never] })).rejects.toThrow();
  });

  test("carries a meaning's examples in order and refuses the old single example", async () => {
    const t = convexTest(schema, modules);
    const examples = ["Il est las, {pourtant} il reste.", "Il pleut, {pourtant} elle sort."];
    const result = await t.mutation(api.sync.push, { token, ...empty, entries: [entry({ examples })] });
    expect(result.rejected).toEqual([]);
    expect(await pullAll(t, "entries")).toMatchObject([{ entryId: "personal-1", examples }]);
    expect((await pullAll(t, "entries"))[0]).not.toHaveProperty("example");
    const { examples: _, ...old } = entry();
    await expect(t.mutation(api.sync.push, { token, ...empty, entries: [{ ...old, example: "Il pleut, {pourtant} elle sort." } as never] })).rejects.toThrow();
  });

  test("rejects entries whose examples break the rules", async () => {
    const t = convexTest(schema, modules);
    const result = await t.mutation(api.sync.push, { token, ...empty, entries: [
      entry({ entryId: "personal-none", examples: [] }),
      entry({ entryId: "personal-twice", examples: ["Il pleut, {pourtant} elle sort.", "Il pleut, {pourtant} elle sort."] }),
    ] });
    expect(result.rejected).toEqual(["personal-none", "personal-twice"]);
  });

  test("keeps the card with the latest review", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.sync.push, { token, ...empty, cards: [card({ lastReview: 200, failures: 1 })] });
    await t.mutation(api.sync.push, { token, ...empty, cards: [card({ lastReview: 100, failures: 3 })] });
    expect(await pullAll(t, "cards")).toMatchObject([{ key: "e1:Reading", lastReview: 200, failures: 1 }]);
    await t.mutation(api.sync.push, { token, ...empty, cards: [card({ lastReview: 300 })] });
    expect(await pullAll(t, "cards")).toMatchObject([{ lastReview: 300, failures: 0 }]);
  });

  test("merges review and manual card fields separately", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.sync.push, { token, ...empty, cards: [card({ suspendedUntil: SUSPENDED_INDEFINITELY, cardEditedAt: 250 })] });
    await t.mutation(api.sync.push, { token, ...empty, cards: [card({ card: '{"v":2}', lastReview: 300 })] });
    expect(await pullAll(t, "cards")).toMatchObject([
      { card: '{"v":2}', lastReview: 300, suspendedUntil: SUSPENDED_INDEFINITELY, cardEditedAt: 250 },
    ]);
  });

  test("stores each review once", async () => {
    const t = convexTest(schema, modules);
    const review = { reviewId: "e1:Reading@2026-11-12T10:00:00Z", key: "e1:Reading", placement: false, log: "{}" };
    await t.mutation(api.sync.push, { token, ...empty, reviews: [review] });
    await t.mutation(api.sync.push, { token, ...empty, reviews: [review] });
    expect(await pullAll(t, "reviews")).toHaveLength(1);
  });

  test("adds personal entries and applies newer edits and deletes", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.sync.push, { token, ...empty, entries: [entry()] });
    await t.mutation(api.sync.push, { token, ...empty, entries: [entry({ word: "néanmoins", editedAt: 100 })] });
    await t.mutation(api.sync.push, { token, ...empty, entries: [entry({ word: "stale", editedAt: 50 })] });
    await t.mutation(api.sync.push, { token, ...empty, entries: [entry({ word: "néanmoins", editedAt: 100, deletedAt: 150 })] });
    const [row] = await pullAll(t, "entries");
    expect(row).toMatchObject({ entryId: "personal-1", word: "néanmoins", origin: "personal", editedAt: 100, deletedAt: 150 });
    expect(row).not.toHaveProperty("shipped");
  });

  test("rejects invalid entries and unknown non-personal entries", async () => {
    const t = convexTest(schema, modules);
    const result = await t.mutation(api.sync.push, {
      token, ...empty,
      entries: [entry({ entryId: "personal-bad", word: "" }), entry({ entryId: "frw-unknown" }), entry({ entryId: "personal-ok" })],
    });
    expect(result.rejected).toEqual(["personal-bad", "frw-unknown"]);
    expect((await pullAll(t, "entries")).map((r) => r.entryId)).toEqual(["personal-ok"]);
  });

  test("pulls only rows changed after the cursor", async () => {
    const t = convexTest(schema, modules);
    const first = await t.mutation(api.sync.push, { token, ...empty, buried: [{ key: "a:Reading", day: "2026-11-12" }] });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await t.mutation(api.sync.push, { token, ...empty, buried: [{ key: "b:Reading", day: "2026-11-12" }, { key: "a:Reading", day: "2026-11-11" }] });
    expect((await pullAll(t, "buried", first.serverTime)).map((row) => row.key)).toEqual(["b:Reading"]);
  });

  test("paginates large tables", async () => {
    const t = convexTest(schema, modules);
    const reviews = Array.from({ length: 30 }, (_, i) => ({ reviewId: `r${i}`, key: "e1:Reading", placement: false, log: "{}" }));
    await t.mutation(api.sync.push, { token, ...empty, reviews });
    const seen: string[] = [];
    let cursor: string | null = null;
    for (;;) {
      const result: { page: object[]; isDone: boolean; continueCursor: string } =
        await t.query(api.sync.pull, { token, table: "reviews", since: 0, cursor, numItems: 7 });
      seen.push(...result.page.map((row) => (row as { reviewId: string }).reviewId));
      if (result.isDone) break;
      cursor = result.continueCursor;
    }
    expect(new Set(seen).size).toBe(30);
  });

  test("merges settings from two devices", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.sync.push, { token, ...empty, settings: { ...settings, placementIndex: 7, minimumRank: 7001, preferencesChangedAt: 50, seconds: 300 } });
    await t.mutation(api.sync.push, { token, ...empty, settings: { ...settings, placementDone: true, minimumRank: 1, preferencesChangedAt: 10, seconds: 120, introduced: 2 } });
    expect(await pullAll(t, "settings")).toMatchObject([
      { placementDone: true, placementIndex: 7, minimumRank: 7001, seconds: 300, introduced: 2 },
    ]);
  });
});

describe("mergeSettings", () => {
  test("a newer day replaces the daily counters", () => {
    const merged = mergeSettings({ ...settings, day: "2026-11-11", seconds: 900 }, { ...settings, day: "2026-11-12", seconds: 60 });
    expect(merged).toMatchObject({ day: "2026-11-12", seconds: 60 });
  });

  test("is commutative", () => {
    const a = { ...settings, interests: "news", preferencesChangedAt: 5, nextCardId: 9 };
    const b = { ...settings, placementDone: true, nextCardId: 3, seconds: 40 };
    expect(mergeSettings(a, b)).toEqual(mergeSettings(b, a));
  });
});
