/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";
import { mergeSettings, type Settings } from "../convex/merge";

const modules = import.meta.glob("../convex/**/*.*s");
const token = "test-token";
const empty = { cards: [], reviews: [], entries: [], sources: [], buried: [] };
const settings: Settings = {
  placementDone: false, placementIndex: 0, nextCardId: 0, minimumRank: 2501, interests: "daily",
  preferencesChangedAt: 0, day: "2026-11-12", seconds: 0, introduced: 0,
};

beforeEach(() => { process.env.SYNC_TOKEN = token; });
afterEach(() => { delete process.env.SYNC_TOKEN; });

async function pullAll(t: ReturnType<typeof convexTest>, table: "cards" | "reviews" | "buried" | "settings", since = 0) {
  return (await t.query(api.sync.pull, { token, table, since, cursor: null })).page;
}

describe("sync", () => {
  test("rejects a wrong token", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.sync.push, { token: "nope", ...empty })).rejects.toThrow(/Invalid sync token/);
    await expect(t.query(api.sync.pull, { token: "nope", table: "cards", since: 0, cursor: null })).rejects.toThrow(/Invalid sync token/);
  });

  test("keeps the card with the latest review", async () => {
    const t = convexTest(schema, modules);
    const card = (lastReview: number, failures = 0) => ({ key: "e1:Reading", card: `{"v":${lastReview}}`, lastReview, failures, pausedUntil: 0 });
    await t.mutation(api.sync.push, { token, ...empty, cards: [card(200, 1)] });
    await t.mutation(api.sync.push, { token, ...empty, cards: [card(100, 3)] });
    expect(await pullAll(t, "cards")).toMatchObject([{ key: "e1:Reading", lastReview: 200, failures: 1 }]);
    await t.mutation(api.sync.push, { token, ...empty, cards: [card(300, 0)] });
    expect(await pullAll(t, "cards")).toMatchObject([{ lastReview: 300, failures: 0 }]);
  });

  test("stores each review once", async () => {
    const t = convexTest(schema, modules);
    const review = { reviewId: "e1:Reading@2026-11-12T10:00:00Z", key: "e1:Reading", placement: false, log: "{}" };
    await t.mutation(api.sync.push, { token, ...empty, reviews: [review] });
    await t.mutation(api.sync.push, { token, ...empty, reviews: [review] });
    expect(await pullAll(t, "reviews")).toHaveLength(1);
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
      const result: { page: { reviewId?: string }[]; isDone: boolean; continueCursor: string } =
        await t.query(api.sync.pull, { token, table: "reviews", since: 0, cursor, numItems: 7 });
      seen.push(...result.page.map((row) => row.reviewId!));
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
