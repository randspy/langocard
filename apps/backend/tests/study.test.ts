import type { FunctionArgs } from "convex/server";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { cardFromJson, cardToJson, Scheduler, newCard } from "../convex/fsrs";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { TOKEN, modules, setup, shipped, withToken, type T } from "./helpers";

beforeEach(() => { process.env.SYNC_TOKEN = TOKEN; });
afterEach(() => { delete process.env.SYNC_TOKEN; });

const DAY = 86_400_000;
const now = Date.parse("2026-11-20T09:00:00Z");
const day = "2026-11-20";
const clock = { day, now };
const empty = { cards: [], reviews: [], entries: [], sources: [], buried: [] };

/** A Reading card reviewed long ago, due `dueIn` ms from `now` (negative: overdue). */
function reviewedCard(cardId: number, dueIn: number) {
  const reviewed = new Scheduler({ enableFuzzing: false }).review(newCard(cardId, now - 30 * DAY), "GOOD", now - 30 * DAY).card;
  return cardToJson({ ...reviewed, due: now + dueIn });
}
const cardRow = (key: string, card: string | null, o: Partial<{ lastReview: number; pausedUntil: number; suspendedUntil: number }> = {}) =>
  ({ key, card, lastReview: now - 30 * DAY, failures: 0, pausedUntil: 0, suspendedUntil: 0, cardEditedAt: 0, ...o });

async function seed(t: T, entries: ReturnType<typeof shipped>[]) {
  for (let i = 0; i < entries.length; i += 500) await t.mutation(internal.seed.apply, { entries: entries.slice(i, i + 500) });
}
async function push(t: T, args: Partial<FunctionArgs<typeof api.sync.push>>) {
  return t.mutation(api.sync.push, { token: TOKEN, ...empty, ...args });
}

describe("study.next", () => {
  test("offers the due Reading card due soonest, skipping blocked ones", async () => {
    const t = setup();
    const ids = ["paused", "suspended", "buried", "deleted", "dormant", "listening", "later", "chosen", "future"];
    await seed(t, ids.map((id) => shipped({ entryId: id, origin: id === "dormant" ? "pack:fr-other" : "bundled", examples: ["{Avoir} un.", "{Avoir} deux."] })));
    await t.run(async (ctx) => {
      const row = (await ctx.db.query("entries").collect()).find((e) => e.entryId === "deleted")!;
      await ctx.db.patch(row._id, { deletedAt: 5 });
    });
    await push(t, {
      cards: [
        cardRow("paused:Reading", reviewedCard(1, -9 * DAY), { pausedUntil: now + DAY }),
        cardRow("suspended:Reading", reviewedCard(2, -8 * DAY), { suspendedUntil: now + DAY }),
        cardRow("buried:Reading", reviewedCard(3, -7 * DAY)),
        cardRow("deleted:Reading", reviewedCard(4, -6 * DAY)),
        cardRow("dormant:Reading", reviewedCard(5, -5 * DAY)),
        cardRow("listening:Listening", reviewedCard(6, -4 * DAY)),
        cardRow("later:Reading", reviewedCard(7, -1 * DAY)),
        cardRow("chosen:Reading", reviewedCard(8, -2 * DAY)),
        cardRow("future:Reading", reviewedCard(9, DAY)),
      ],
      buried: [{ key: "buried:Reading", day }],
      reviews: [{ reviewId: "chosen:Listening@x", key: "chosen:Listening", placement: true, log: "{}" }],
    });
    const client = withToken(t);
    const next = await client.query(api.study.next, clock);
    expect(next).toMatchObject({ key: "chosen:Reading", skill: "Reading", entryId: "chosen", example: "{Avoir} deux." });
    expect(await client.query(api.study.summary, clock)).toEqual({ due: 2, dueCapped: false });
  });

  test("returns null when nothing is due", async () => {
    const t = setup();
    await seed(t, [shipped()]);
    await push(t, { cards: [cardRow("frw-1:Reading", reviewedCard(1, DAY)), cardRow("frw-1:Listening", null)] });
    expect(await withToken(t).query(api.study.next, clock)).toBeNull();
  });

  test("finds the first eligible card behind a page of blocked ones in a full library", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < 20_000; i++) {
        const { entryId: _, origin, ...content } = shipped();
        await ctx.db.insert("entries", { entryId: `frw-${i}`, ...content, origin, shipped: content, editedAt: null, deletedAt: null, upstreamChanged: false, retired: false, updatedAt: 1 });
      }
    });
    const blocked = Array.from({ length: 600 }, (_, i) => cardRow(`frw-${i}:Reading`, reviewedCard(i, -DAY - i * 1000), { pausedUntil: now + DAY }));
    const open = Array.from({ length: 1400 }, (_, i) => cardRow(`frw-${600 + i}:Reading`, reviewedCard(600 + i, -i * 1000)));
    const cards = [...blocked, ...open];
    for (let i = 0; i < cards.length; i += 500) await push(t, { cards: cards.slice(i, i + 500) });
    const client = withToken(t);
    expect((await client.query(api.study.next, clock))?.key).toBe("frw-1999:Reading");
    expect(await client.query(api.study.summary, clock)).toEqual({ due: 100, dueCapped: true });
  }, 120_000);
});

describe("study.next with many other due cards", () => {
  test("other skills' due cards don't use up the walk", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < 2101; i++) {
        const { entryId: _, origin, ...content } = shipped();
        await ctx.db.insert("entries", { entryId: `frw-${i}`, ...content, origin, shipped: content, editedAt: null, deletedAt: null, upstreamChanged: false, retired: false, updatedAt: 1 });
      }
    });
    const listening = Array.from({ length: 2100 }, (_, i) => cardRow(`frw-${i}:Listening`, reviewedCard(i, -2 * DAY - i * 1000)));
    for (let i = 0; i < listening.length; i += 500) await push(t, { cards: listening.slice(i, i + 500) });
    await push(t, { cards: [cardRow("frw-2100:Reading", reviewedCard(9000, -DAY))] });
    expect((await withToken(t).query(api.study.next, clock))?.key).toBe("frw-2100:Reading");
  }, 60_000);

  test("the summary reports what it found when blocked cards exhaust the walk", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < 2101; i++) {
        const { entryId: _, origin, ...content } = shipped();
        await ctx.db.insert("entries", { entryId: `frw-${i}`, ...content, origin, shipped: content, editedAt: null, deletedAt: null, upstreamChanged: false, retired: false, updatedAt: 1 });
      }
    });
    const cards = [cardRow("frw-2100:Reading", reviewedCard(9000, -3 * DAY)),
      ...Array.from({ length: 2100 }, (_, i) => cardRow(`frw-${i}:Reading`, reviewedCard(i, -DAY - i * 1000), { pausedUntil: now + DAY }))];
    for (let i = 0; i < cards.length; i += 500) await push(t, { cards: cards.slice(i, i + 500) });
    const client = withToken(t);
    expect((await client.query(api.study.next, clock))?.key).toBe("frw-2100:Reading");
    expect(await client.query(api.study.summary, clock)).toEqual({ due: 1, dueCapped: false });
  }, 60_000);

  test("a card synced before its entry was seeded becomes studiable", async () => {
    const t = setup();
    await push(t, { cards: [cardRow("frw-1:Reading", reviewedCard(1, -DAY))] });
    expect(await withToken(t).query(api.study.next, clock)).toBeNull();
    await seed(t, [shipped()]);
    expect((await withToken(t).query(api.study.next, clock))?.key).toBe("frw-1:Reading");
  });
});

describe("study.answer", () => {
  test("reschedules the card and logs the review as a phone would", async () => {
    const t = setup();
    await seed(t, [shipped()]);
    await push(t, { cards: [cardRow("frw-1:Reading", reviewedCard(1, -DAY))] });
    const client = withToken(t);
    const shown = (await client.query(api.study.next, clock))!;
    const result = await client.mutation(api.study.answer, { key: shown.key, version: shown.version, rating: "GOOD", example: shown.example, ...clock });
    expect(result.status).toBe("ok");
    const pulled = (await t.query(api.sync.pull, { token: TOKEN, table: "cards", since: 0, cursor: null })).page[0] as Record<string, unknown>;
    expect(Object.keys(pulled).sort()).toEqual(["card", "cardEditedAt", "failures", "key", "lastReview", "pausedUntil", "suspendedUntil", "updatedAt"]);
    const card = cardFromJson(pulled.card as string);
    expect(card.lastReview).toBe(now);
    expect(card.due).toBeGreaterThan(now + DAY);
    expect(pulled.lastReview).toBe(now);
    const reviews = (await t.query(api.sync.pull, { token: TOKEN, table: "reviews", since: 0, cursor: null })).page as Record<string, unknown>[];
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ reviewId: "frw-1:Reading@2026-11-20T09:00:00Z", key: "frw-1:Reading", placement: false });
    expect(JSON.parse(reviews[0].log as string)).toEqual({ cardId: 1, rating: "GOOD", review_datetime: "2026-11-20T09:00:00Z", reviewDuration: null, example: "{Avoir} de la force." });
    expect(await client.query(api.study.next, clock)).toBeNull();
  });

  test("refuses a card a phone reviewed since it was shown, and follows the phone", async () => {
    const t = setup();
    await seed(t, [shipped()]);
    await push(t, { cards: [cardRow("frw-1:Reading", reviewedCard(1, -DAY))] });
    const client = withToken(t);
    const shown = (await client.query(api.study.next, clock))!;
    await push(t, { cards: [cardRow("frw-1:Reading", reviewedCard(1, 5 * DAY), { lastReview: now - 1000 })] });
    expect(await client.mutation(api.study.answer, { key: shown.key, version: shown.version, rating: "AGAIN", example: shown.example, ...clock }))
      .toEqual({ status: "stale" });
    expect(await client.query(api.study.next, clock)).toBeNull();
  });

  test("refuses a card that was suspended or deleted since", async () => {
    const t = setup();
    await seed(t, [shipped()]);
    await push(t, { cards: [cardRow("frw-1:Reading", reviewedCard(1, -DAY))] });
    const client = withToken(t);
    const shown = (await client.query(api.study.next, clock))!;
    await client.mutation(api.entries.remove, { entryId: "frw-1" });
    expect((await client.mutation(api.study.answer, { key: shown.key, version: shown.version, rating: "GOOD", example: shown.example, ...clock })).status).toBe("stale");
    await client.mutation(api.entries.restore, { entryId: "frw-1" });
    await client.mutation(api.cards.suspend, { entryId: "frw-1", skill: "Reading", until: null });
    expect(await client.query(api.study.next, clock)).toBeNull();
  });

  test("gives a new card an ID from the synced settings", async () => {
    const t = setup();
    await seed(t, [shipped()]);
    await push(t, {
      cards: [cardRow("frw-1:Reading", reviewedCard(1, -DAY))],
      settings: { placementDone: true, placementIndex: 18, nextCardId: 41, minimumRank: 1, interests: "daily", preferencesChangedAt: 0, day, seconds: 0, introduced: 0 },
    });
    // A reset card has no FSRS card; answering it starts a new one.
    await t.run(async (ctx) => {
      const row = (await ctx.db.query("cards").collect())[0];
      await ctx.db.patch(row._id, { card: null });
    });
    const shown = { key: "frw-1:Reading", version: now - 30 * DAY };
    await t.run(async (ctx) => {
      const row = (await ctx.db.query("cards").collect())[0];
      await ctx.db.patch(row._id, { active: true, due: now - DAY });
    });
    const result = await withToken(t).mutation(api.study.answer, { ...shown, rating: "GOOD", example: "{Avoir} de la force.", ...clock });
    expect(result.status).toBe("ok");
    expect(cardFromJson((result as { card: string }).card).cardId).toBe(41);
    expect((await t.query(api.sync.pull, { token: TOKEN, table: "settings", since: 0, cursor: null })).page[0]).toMatchObject({ nextCardId: 42 });
  });
});

test("the migration rebuilds derived columns", async () => {
  const t = setup();
  await seed(t, [shipped()]);
  await push(t, { cards: [cardRow("frw-1:Reading", reviewedCard(1, -DAY))] });
  await t.run(async (ctx) => {
    const row = (await ctx.db.query("cards").collect())[0];
    await ctx.db.patch(row._id, { active: undefined, due: undefined });
  });
  expect(await withToken(t).query(api.study.next, clock)).toBeNull();
  expect(await t.mutation(internal.migrations.deriveCards, { cursor: null })).toMatchObject({ isDone: true });
  expect((await withToken(t).query(api.study.next, clock))?.key).toBe("frw-1:Reading");
});

test("an Android-sized push that deletes entries stays within transaction limits", async () => {
  const t = convexTest({ schema, modules, transactionLimits: true });
  for (let batch = 0; batch < 20; batch++) {
    await t.run(async (ctx) => {
      for (let i = batch * 1000; i < (batch + 1) * 1000; i++) {
        const { entryId: _, origin, ...content } = shipped();
        await ctx.db.insert("entries", { entryId: `frw-${i}`, ...content, origin, shipped: content, editedAt: null, deletedAt: null, upstreamChanged: false, retired: false, updatedAt: 1 });
      }
    });
  }
  const personal = Array.from({ length: 500 }, (_, i) => ({
    entryId: `personal-${i}`, word: "pourtant", english: "however", definition: "Malgré cela.", examples: ["Il pleut, {pourtant} elle sort."],
    topic: "daily", lemma: "", rank: null, sourceUrl: "", license: "", gender: null, editedAt: 1, deletedAt: null as number | null,
  }));
  await push(t, { entries: personal });
  for (const skill of ["Reading", "Listening"]) {
    await push(t, { cards: personal.map((e, i) => cardRow(`${e.entryId}:${skill}`, reviewedCard(i, DAY))) });
  }
  await push(t, {
    entries: personal.map((e) => ({ ...e, deletedAt: 10 })),
    cards: Array.from({ length: 500 }, (_, i) => cardRow(`frw-${i}:Reading`, reviewedCard(i, -DAY))),
    reviews: Array.from({ length: 500 }, (_, i) => ({ reviewId: `frw-${i}:Reading@x`, key: `frw-${i}:Reading`, placement: false, log: "{}" })),
    buried: Array.from({ length: 500 }, (_, i) => ({ key: `frw-${i}:Listening`, day })),
    hooks: Array.from({ length: 500 }, (_, i) => ({ entryId: `frw-${i}`, text: "image", editedAt: 1 })),
  });
  const next = await withToken(t).query(api.study.next, clock);
  expect(next?.key).toMatch(/^frw-\d+:Reading$/);
}, 120_000);
