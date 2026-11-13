import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { SUSPENDED_INDEFINITELY } from "../convex/merge";
import { TOKEN, setup, shipped, withToken, type T } from "./helpers";

const token = TOKEN;
const empty = { cards: [], reviews: [], entries: [], sources: [], buried: [] };
beforeEach(() => { process.env.SYNC_TOKEN = token; });
afterEach(() => { delete process.env.SYNC_TOKEN; });

const reviewedCard = (lastReview: string) =>
  JSON.stringify({ cardId: 1, state: "REVIEW", step: null, stability: 4, difficulty: 5, due: "2026-11-20T08:00:00Z", lastReview });

/** The owner, with "frw-1" seeded and its Reading card reviewed on a phone. */
async function setupWithCard(t: T) {
  await t.mutation(internal.seed.apply, { entries: [shipped()] });
  const at = Date.parse("2026-11-12T08:00:00Z");
  await t.mutation(api.sync.push, {
    token, ...empty,
    cards: [{ key: "frw-1:Reading", card: reviewedCard("2026-11-12T08:00:00Z"), lastReview: at, failures: 1, pausedUntil: 0, suspendedUntil: 0, cardEditedAt: 0 }],
    reviews: [{ reviewId: "r1", key: "frw-1:Reading", placement: false, log: '{"cardId":1,"rating":"GOOD","review_datetime":"2026-11-12T08:00:00Z","reviewDuration":null}' }],
  });
  return { me: withToken(t), at };
}
const pullCards = async (t: T) =>
  (await t.query(api.sync.pull, { token, table: "cards", since: 0, cursor: null })).page as Record<string, unknown>[];

describe("cards", () => {
  test("refuses anyone but the owner", async () => {
    const t = setup();
    await setupWithCard(t);
    const stranger = withToken(t, "wrong-token");
    await expect(stranger.mutation(api.cards.reset, { entryId: "frw-1" })).rejects.toThrow(/Invalid sync token/);
    await expect(stranger.query(api.cards.forEntry, { entryId: "frw-1" })).rejects.toThrow(/Invalid sync token/);
  });

  test("shows each skill's state and review history", async () => {
    const t = setup();
    const { me } = await setupWithCard(t);
    const [reading, listening] = await me.query(api.cards.forEntry, { entryId: "frw-1" });
    expect(reading).toMatchObject({ skill: "Reading", card: { state: "REVIEW", stability: 4 }, failures: 1, reviews: [{ rating: "GOOD", placement: false }] });
    expect(listening).toMatchObject({ skill: "Listening", card: null, reviews: [] });
  });

  test("suspends one skill indefinitely and resumes it", async () => {
    const t = setup();
    const { me } = await setupWithCard(t);
    await me.mutation(api.cards.suspend, { entryId: "frw-1", skill: "Reading", until: null });
    expect((await pullCards(t))[0]).toMatchObject({ suspendedUntil: SUSPENDED_INDEFINITELY, card: expect.any(String) });
    await me.mutation(api.cards.resume, { entryId: "frw-1", skill: "Reading" });
    expect((await pullCards(t))[0]).toMatchObject({ suspendedUntil: 0 });
  });

  test("suspending a whole entry covers unstudied skills without touching review clocks", async () => {
    const t = setup();
    const { me } = await setupWithCard(t);
    const until = Date.now() + 86_400_000;
    await me.mutation(api.cards.suspend, { entryId: "frw-1", until });
    const cards = await pullCards(t);
    expect(cards).toHaveLength(3);
    expect(cards.every((c) => c.suspendedUntil === until)).toBe(true);
    expect(cards.find((c) => c.key === "frw-1:Listening")).toMatchObject({ card: null, lastReview: 0 });
    await expect(me.mutation(api.cards.suspend, { entryId: "frw-1", until: 1 })).rejects.toThrow(/future/);
  });

  test("a phone review after the suspension keeps it", async () => {
    const t = setup();
    const { me, at } = await setupWithCard(t);
    await me.mutation(api.cards.suspend, { entryId: "frw-1", skill: "Reading", until: null });
    await t.mutation(api.sync.push, {
      token, ...empty,
      cards: [{ key: "frw-1:Reading", card: reviewedCard("2026-11-13T08:00:00Z"), lastReview: at + 86_400_000, failures: 0, pausedUntil: 0, suspendedUntil: 0, cardEditedAt: 0 }],
    });
    expect((await pullCards(t))[0]).toMatchObject({ lastReview: at + 86_400_000, suspendedUntil: SUSPENDED_INDEFINITELY });
  });

  test("reset makes the card new, keeps history, and beats older reviews", async () => {
    const t = setup();
    const { me, at } = await setupWithCard(t);
    await me.mutation(api.cards.reset, { entryId: "frw-1", skill: "Reading" });
    const [row] = await pullCards(t);
    expect(row).toMatchObject({ card: null, failures: 0, pausedUntil: 0 });
    // A review made before the reset, synced late, loses.
    await t.mutation(api.sync.push, {
      token, ...empty,
      cards: [{ key: "frw-1:Reading", card: reviewedCard("2026-11-12T09:00:00Z"), lastReview: at + 3_600_000, failures: 0, pausedUntil: 0, suspendedUntil: 0, cardEditedAt: 0 }],
    });
    expect((await pullCards(t))[0]).toMatchObject({ card: null });
    const [reading] = await me.query(api.cards.forEntry, { entryId: "frw-1" });
    expect(reading.card).toBeNull();
    expect(reading.reviews).toHaveLength(1);
  });

  test("fails for unknown entries", async () => {
    const t = setup();
    const { me } = await setupWithCard(t);
    await expect(me.mutation(api.cards.reset, { entryId: "nope" })).rejects.toThrow(/not found/);
  });
});
