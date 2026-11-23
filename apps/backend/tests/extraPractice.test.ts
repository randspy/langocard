import { beforeEach, afterEach, expect, test } from "vitest";
import type { FunctionArgs } from "convex/server";
import { api, internal } from "../convex/_generated/api";
import { PracticeBlock, type StoredBlock } from "../convex/practiceBlock";
import { cardToJson } from "../convex/fsrs";
import { setup, shipped, TOKEN, withToken, type T } from "./helpers";

beforeEach(() => { process.env.SYNC_TOKEN = TOKEN; });
afterEach(() => { delete process.env.SYNC_TOKEN; });
const now = Date.parse("2026-11-20T09:00:00Z"), day = "2026-11-20";

test("extra offers need the daily target and work; a five-minute grant owns two meanings regardless of daily totals", async () => {
  const t = setup(), client = withToken(t);
  expect(await client.query(api.study.offer, { day, now })).toBe("moreVocabulary");
  await t.mutation(internal.seed.apply, { entries: Array.from({ length: 3 }, (_, i) => meaning(`extra-${i}`)) });
  expect(await client.query(api.study.offer, { day, now })).toBe("practice");
  await push(t, { settings: settings(1020) });
  expect(await client.query(api.study.offer, { day, now })).toBe("extraBlock");
  let block = PracticeBlock.grant(day, 1020, 5).toJSON()!;
  for (let i = 0; i < 2; i++) {
    const shown = (await client.query(api.study.next, { day, now, block }))!;
    expect(shown).toMatchObject({ card: null, newMeaning: true });
    const result = await client.mutation(api.study.answer, { day, now: now + i, block, key: shown.key, version: shown.version, example: shown.example, rating: "EASY" });
    expect(result.status).toBe("ok");
    if (result.status === "ok" && result.block) block = result.block;
  }
  expect(block.meaningsUsed).toBe(2);
  expect(block.gendersUsed).toBe(0);
  expect(await client.query(api.study.next, { day, now, block })).toBeNull();
  expect(await client.query(api.study.offer, { day, now, block })).toBe("extraBlock");
  const daily = await t.run(ctx => ctx.db.query("settings").first());
  expect(daily).toMatchObject({ introduced: 102, seconds: 1020 });
  expect(await client.query(api.study.next, { day, now, block: { ...block, day: "2026-11-19" } })).toBeNull();
});

test("Gender uses its own local quota and malformed usage permits reviews but no introductions", async () => {
  const t = setup(), client = withToken(t);
  await t.mutation(internal.seed.apply, { entries: [meaning("noun-a", true), meaning("noun-b", true), meaning("noun-c", true)] });
  await push(t, { settings: settings(900), cards: ["noun-a", "noun-b", "noun-c"].flatMap((id, i) => [memory(`${id}:Reading`, i * 2), memory(`${id}:Production`, i * 2 + 1)]) });
  let block = PracticeBlock.grant(day, 900, 5).toJSON()!;
  for (let i = 0; i < 2; i++) {
    const shown = (await client.query(api.study.next, { day, now, block }))!;
    expect(shown.skill).toBe("Gender");
    const result = await client.mutation(api.study.answer, { day, now: now + i, block, key: shown.key, version: shown.version, example: shown.example, rating: "EASY" });
    if (result.status === "ok" && result.block) block = result.block;
  }
  expect(block).toMatchObject({ meaningsUsed: 0, gendersUsed: 2 });
  expect(await client.query(api.study.next, { day, now, block })).toBeNull();
  const corrupt: StoredBlock = PracticeBlock.read({ ...block, meaningsUsed: "0" }, day, 900).toJSON()!;
  expect(corrupt).toMatchObject({ meaningsUsed: 2, gendersUsed: 2 });
  await push(t, { cards: [{ ...memory("noun-c:Reading", 4), lastReview: now - 1, card: cardToJson({ cardId: 4, state: "REVIEW", step: null, stability: 10, difficulty: 5, due: now - 1, lastReview: now - 1000 }) }] });
  expect((await client.query(api.study.next, { day, now, block: corrupt }))?.key).toBe("noun-c:Reading");
});

function meaning(id: string, noun = false) {
  const word = noun ? `une ${id}` : id;
  return shipped({ entryId: id, word, rank: 3000, gender: noun ? "feminine" : null, lemma: id, examples: [`Voici {${word}}.`] });
}
function settings(seconds: number) {
  return { placementDone: true, placementIndex: 0, nextCardId: 100, minimumRank: 1, interests: "daily", preferencesChangedAt: 1, day, seconds, introduced: 100, genderIntroduced: 100 };
}
function memory(key: string, cardId: number) {
  return { key, card: cardToJson({ cardId, state: "REVIEW", step: null, stability: 10, difficulty: 5, due: now + 86400000, lastReview: now - 86400000 }),
    lastReview: now - 86400000, failures: 0, pausedUntil: 0, suspendedUntil: 0, cardEditedAt: 0 };
}
function push(t: T, fields: Partial<FunctionArgs<typeof api.sync.push>>) {
  return t.mutation(api.sync.push, { token: TOKEN, entries: [], cards: [], reviews: [], sources: [], buried: [], ...fields });
}
