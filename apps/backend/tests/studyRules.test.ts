import { afterEach, beforeEach, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { cardToJson } from "../convex/fsrs";
import fixtures from "../../../content/study-rules-fixtures.json";
import { setup, shipped, TOKEN, withToken } from "./helpers";

beforeEach(() => { process.env.SYNC_TOKEN = TOKEN; });
afterEach(() => { delete process.env.SYNC_TOKEN; });

for (const fixture of fixtures.cases) test(fixture.name, async () => {
  const t = setup();
  const client = withToken(t);
  const now = Date.parse(fixtures.now);
  const day = fixtures.day;
  const entries = fixture.entries.map((e) => shipped({ entryId: e.id, rank: "rank" in e ? e.rank : 2501,
    topic: "topic" in e ? e.topic : "daily", lemma: "lemma" in e ? e.lemma : "", examples: ["{Avoir} un.", "{Avoir} deux."] }));
  // Personal content uses the actual sync path, just as entries from a phone do.
  await t.mutation(internal.seed.apply, { entries: entries.filter(e => !e.entryId.startsWith("personal-")) });
  await client.mutation(api.sync.push, {
    cards: (fixture.cards ?? []).map((c, i) => ({ key: c.key, card: cardToJson({ cardId: i, state: "REVIEW", step: null,
      stability: 10, difficulty: 5, due: now + c.due * 1000, lastReview: now - 86400000 }), lastReview: now - 86400000,
      failures: 0, pausedUntil: 0, suspendedUntil: 0, cardEditedAt: 0 })),
    entries: entries.filter(e => e.entryId.startsWith("personal-")).map(({ origin, ...e }) => ({ ...e, editedAt: 1, deletedAt: null })),
    reviews: [], buried: [], sources: [], settings: { placementDone: true, placementIndex: 0, nextCardId: 100,
      minimumRank: fixture.minimumRank ?? 0, interests: JSON.stringify(fixture.interests ?? []), preferencesChangedAt: 1,
      day, seconds: fixture.seconds ?? 0, introduced: fixture.introduced ?? 0 },
  });
  const shown = await client.query(api.study.next, { day, now });
  expect(shown?.key ?? null).toBe(fixture.next);
  if (shown) expect(shown.example).toBe("{Avoir} un.");
  if (shown && fixture.burials) {
    expect((await client.mutation(api.study.answer, { key: shown.key, version: shown.version, example: shown.example, rating: "GOOD", day, now })).status).toBe("ok");
    const buried = await client.query(api.sync.pull, { table: "buried", since: 0, cursor: null });
    expect(buried.page.map(x => "key" in x ? x.key : "").sort()).toEqual([...fixture.burials].sort());
  }
});
