import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { projectEntry } from "../convex/studyProgress";
import { deriveCard } from "../convex/studyIndex";
import { beforeEach, afterEach, expect, test } from "vitest";
import type { FunctionArgs } from "convex/server";
import { api, internal } from "../convex/_generated/api";
import { cardToJson } from "../convex/fsrs";
import { setup, shipped, TOKEN, modules, withToken, type T } from "./helpers";

beforeEach(() => { process.env.SYNC_TOKEN = TOKEN; });
afterEach(() => { delete process.env.SYNC_TOKEN; });
const now = Date.parse("2026-11-20T09:00:00Z"), day = "2026-11-20";

test("five first answers share the daily allowance, while siblings do not spend a meaning", async () => {
  const t = setup(), client = withToken(t);
  await t.mutation(internal.seed.apply, { entries: Array.from({ length: 7 }, (_, i) => entry(`meaning-${i}`)) });
  for (let i = 0; i < 5; i++) {
    const shown = (await client.query(api.study.next, { day, now }))!;
    expect(shown.card).toBeNull();
    expect((await client.mutation(api.study.answer, { day, now: now + i, key: shown.key, version: shown.version, example: shown.example, rating: "EASY" })).status).toBe("ok");
  }
  expect(await client.query(api.study.next, { day, now })).toBeNull();
  const settings = await t.run(ctx => ctx.db.query("settings").first());
  expect(settings).toMatchObject({ introduced: 5, nextCardId: 5 });
  await push(t, { cards: [memory("meaning-5:Listening")] });
  const sibling = (await client.query(api.study.next, { day, now }))!;
  expect(sibling.key).toBe("meaning-5:Reading");
  await client.mutation(api.study.answer, { day, now, key: sibling.key, version: sibling.version, example: sibling.example, rating: "EASY" });
  expect(await t.run(ctx => ctx.db.query("settings").first())).toMatchObject({ introduced: 5, nextCardId: 6 });
  expect((await client.query(api.study.next, { day: "2026-11-21", now }))?.key).toBe("meaning-6:Reading");
});

test("review and card before entry are adopted once; resetting the last card keeps example rotation", async () => {
  const t = setup(), client = withToken(t);
  const review = { reviewId: "orphan:Listening@first", key: "orphan:Listening", placement: true, log: "{}" };
  await push(t, { reviews: [review] });
  await push(t, { cards: [memory("orphan:Listening")] });
  await t.mutation(internal.seed.apply, { entries: [entry("orphan")] });
  await push(t, { reviews: [review] });
  expect(await client.query(api.study.next, { day, now })).toMatchObject({ key: "orphan:Reading", example: "{orphan} deux." });
  await client.mutation(api.cards.reset, { entryId: "orphan", skill: "Listening" });
  const row = await t.run(ctx => ctx.db.query("entries").first());
  expect(row).toMatchObject({ started: false, progress: { exposures: 1 } });
  expect((await client.query(api.study.next, { day, now }))?.example).toBe("{orphan} deux.");
  expect(await t.run(ctx => ctx.db.query("orphanProgress").collect())).toEqual([]);
  const wire = await client.query(api.sync.pull, { table: "entries", since: 0, cursor: null });
  expect(wire.page[0]).not.toHaveProperty("progress");
  expect(wire.page[0]).not.toHaveProperty("studyOrder");
});

test("exposure migration can replay its page after a live review without double counting", async () => {
  const t = setup(), client = withToken(t);
  await t.mutation(internal.seed.apply, { entries: [entry("history")] });
  await t.run(async ctx => {
    await ctx.db.insert("reviews", { reviewId: "old", key: "history:Reading", placement: true, log: "{}", updatedAt: 1 });
  });
  await expect(client.query(api.study.next, { day, now })).rejects.toThrow("countExposures");
  await t.mutation(internal.migrations.countExposures, { cursor: null });
  await push(t, { reviews: [{ reviewId: "late", key: "history:Production", placement: false, log: "{}" }] });
  await t.mutation(internal.migrations.countExposures, { cursor: null });
  await t.mutation(internal.migrations.deriveEntryProgress, { cursor: null });
  expect(await t.run(ctx => ctx.db.query("entries").first())).toMatchObject({ progress: { exposures: 2 }, updatedAt: expect.any(Number) });
  expect((await client.query(api.study.next, { day, now }))?.example).toBe("{history} un.");
});

function entry(id: string) {
  // Ranked above Android's default starting rank (2501), which applies without settings.
  return shipped({ entryId: id, word: id, lemma: id, rank: 3000, examples: [`{${id}} un.`, `{${id}} deux.`] });
}
function memory(key: string) {
  return { key, card: cardToJson({ cardId: 100, state: "REVIEW", step: null, stability: 10, difficulty: 5,
    due: now + 86400000, lastReview: now - 86400000 }), lastReview: now - 86400000,
    failures: 0, pausedUntil: 0, suspendedUntil: 0, cardEditedAt: 0 };
}
function push(t: T, fields: Partial<FunctionArgs<typeof api.sync.push>>) {
  return t.mutation(api.sync.push, { token: TOKEN, entries: [], cards: [], reviews: [], sources: [], buried: [], ...fields });
}

test("thousands of Reading-complete meanings stay outside the sibling read range", async () => {
  const t = convexTest({ schema, modules, transactionLimits: true });
  for (let batch = 0; batch < 8; batch++) await t.run(async ctx => {
    for (let i = 0; i < 500; i++) {
      const id = `complete-${batch * 500 + i}`;
      const { origin, entryId: logicalId, ...content } = entry(id);
      const row = memory(`${id}:Reading`);
      const cardId = await ctx.db.insert("cards", { ...row, ...deriveCard(row, { live: true, packId: null }), updatedAt: 1 });
      const stored = { entryId: logicalId, ...content, origin, shipped: content, editedAt: null, deletedAt: null, retired: false, upstreamChanged: false, updatedAt: 1 };
      const entryId = await ctx.db.insert("entries", stored);
      await ctx.db.patch(entryId, projectEntry({ ...stored, _id: entryId, _creationTime: 1 }, {
        slots: { Reading: { id: cardId, cardId: 100, suspendedUntil: 0 } }, exposures: 0,
      }));
    }
  });
  await t.mutation(internal.seed.apply, { entries: [entry("sibling")] });
  await push(t, { cards: [memory("sibling:Listening")] });
  expect((await withToken(t).query(api.study.next, { day, now }))?.key).toBe("sibling:Reading");
});

test("dormant packs neither exhaust introductions nor count as remaining work", async () => {
  const t = setup(), client = withToken(t);
  const bundled = Array.from({ length: 3 }, (_, i) => ({ ...entry(`b-${i}`), rank: 100 + i }));
  const dormant = Array.from({ length: 1500 }, (_, i) => ({ ...entry(`p-${i}`), origin: "pack:fr-core-everyday", rank: 2501 + i }));
  for (const batch of [bundled, ...Array.from({ length: 3 }, (_, i) => dormant.slice(i * 500, (i + 1) * 500))]) {
    await t.mutation(internal.seed.apply, { entries: batch });
  }
  // The learner starts at rank 2501 (Android's default) and has only the built-in pack.
  expect(await client.query(api.study.next, { day, now })).toBeNull();
  expect(await client.query(api.study.offer, { day, now })).toBe("moreVocabulary");
  await t.run(ctx => ctx.db.insert("sources", { sourceId: "fr-core-everyday", source: "{}", updatedAt: 1 }));
  expect((await client.query(api.study.next, { day, now }))?.key).toBe("p-0:Reading");
}, 60_000);

test("settings the web creates or touches are ones Android accepts", async () => {
  const t = setup(), client = withToken(t);
  await client.mutation(api.study.tick, { day, seconds: 10 });
  expect(await t.run(ctx => ctx.db.query("settings").first())).toMatchObject({ minimumRank: 2501, interests: "daily,culture,news", seconds: 10 });
  await t.run(async ctx => { const s = (await ctx.db.query("settings").first())!; await ctx.db.patch(s._id, { minimumRank: 0, interests: "[]", introduced: 3 }); });
  await client.mutation(api.study.tick, { day, seconds: 5 });
  expect(await t.run(ctx => ctx.db.query("settings").first())).toMatchObject({ minimumRank: 2501, interests: "daily,culture,news", seconds: 15, introduced: 3 });
});
