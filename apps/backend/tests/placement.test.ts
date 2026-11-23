import { afterEach, beforeEach, describe, expect, test } from "vitest";
import items from "../../../content/placement-items.json";
import fixtures from "../../../content/placement-fixtures.json";
import { api } from "../convex/_generated/api";
import { adjustedHits, checkItems, startingRank } from "../convex/vocabularyPlacement";
import { TOKEN, setup, withToken } from "./helpers";

beforeEach(() => { process.env.SYNC_TOKEN = TOKEN; });
afterEach(() => { delete process.env.SYNC_TOKEN; });

describe("starting-check scoring matches Android (shared fixtures)", () => {
  test("the shared items fit the scoring contract", () => expect(() => checkItems(items)).not.toThrow());
  test.each(fixtures.cases)("$name", ({ answers, adjustedHits: hits, startingRank: rank }) => {
    const known = [...answers].map((a) => a === "1");
    expect(startingRank(items, known)).toBe(rank);
    adjustedHits(items, known).forEach((h, band) => expect(h).toBeCloseTo(hits[band], 9));
  });
});

test("answers resume, repeats are ignored, retake clears, and accepting writes the synced rank", async () => {
  const t = setup(), client = withToken(t);
  await client.mutation(api.placement.answer, { index: 0, known: true });
  await client.mutation(api.placement.answer, { index: 0, known: false });
  expect(await client.query(api.placement.progress, {})).toEqual([true]);
  await expect(client.mutation(api.placement.answer, { index: 5, known: true })).rejects.toThrow();
  await expect(client.mutation(api.placement.accept, { rank: 2501 })).rejects.toThrow(/Finish/);
  await client.mutation(api.placement.retake, {});
  expect(await client.query(api.placement.progress, {})).toEqual([]);
  for (let i = 0; i < 90; i++) await client.mutation(api.placement.answer, { index: i, known: items[i].band >= 0 });
  await client.mutation(api.placement.accept, { rank: 7001 });
  const [settings] = (await t.query(api.sync.pull, { token: TOKEN, table: "settings", since: 0, cursor: null })).page as Record<string, unknown>[];
  expect(settings).toMatchObject({ minimumRank: 7001, placementDone: true });
  expect(settings.preferencesChangedAt).toBeGreaterThan(0);
  // No card is marked known.
  expect((await t.query(api.sync.pull, { token: TOKEN, table: "cards", since: 0, cursor: null })).page).toEqual([]);
  await expect(client.mutation(api.placement.accept, { rank: 3000 })).rejects.toThrow();
});
