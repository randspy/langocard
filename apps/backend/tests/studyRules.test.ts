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
    topic: "topic" in e ? e.topic : "daily", lemma: "lemma" in e ? e.lemma : "",
    word: "word" in e ? e.word as string : "avoir", gender: "gender" in e ? e.gender as "masculine" | "feminine" : null,
    examples: "examples" in e ? e.examples as string[] : ["{Avoir} un.", "{Avoir} deux."] }));
  const at = (seconds: number) => now + seconds * 1000;
  // Personal content uses the actual sync path, just as entries from a phone do.
  await t.mutation(internal.seed.apply, { entries: entries.filter(e => !e.entryId.startsWith("personal-")) });
  await client.mutation(api.sync.push, {
    cards: (fixture.cards ?? []).map((c, i) => {
      const lastReview = at("lastReview" in c ? c.lastReview as number : -86400);
      return { key: c.key, card: cardToJson({ cardId: i, state: "REVIEW", step: null, stability: 10, difficulty: 5, due: at(c.due), lastReview }),
        lastReview, failures: 0, pausedUntil: "pausedUntil" in c ? at(c.pausedUntil as number) : 0, suspendedUntil: 0, cardEditedAt: 0 };
    }),
    entries: entries.filter(e => e.entryId.startsWith("personal-")).map(({ origin, ...e }) => ({ ...e, editedAt: 1, deletedAt: null })),
    reviews: ((fixture as { reviews?: { key: string; at: number; example: string }[] }).reviews ?? []).map((r) => {
      const time = new Date(at(r.at)).toISOString();
      return { reviewId: `${r.key}@${time}`, key: r.key, placement: false,
        log: JSON.stringify({ cardId: 0, rating: "AGAIN", review_datetime: time, reviewDuration: null, example: r.example }) };
    }),
    buried: [], sources: [], settings: { placementDone: true, placementIndex: 0, nextCardId: 100,
      minimumRank: fixture.minimumRank ?? 1, interests: (fixture.interests ?? ["daily", "culture", "news"]).join(","), preferencesChangedAt: 1,
      day, seconds: fixture.seconds ?? 0, introduced: fixture.introduced ?? 0,
      genderIntroduced: (fixture as { genderIntroduced?: number }).genderIntroduced ?? 0 },
  });
  const shown = await client.query(api.study.next, { day, now });
  expect(shown?.key ?? null).toBe(fixture.next);
  if (shown) expect(shown.example).toBe((fixture as { example?: string }).example ?? "{Avoir} un.");
  if (shown && fixture.burials) {
    expect((await client.mutation(api.study.answer, { key: shown.key, version: shown.version, example: shown.example, rating: "GOOD", day, now })).status).toBe("ok");
    const buried = await client.query(api.sync.pull, { table: "buried", since: 0, cursor: null });
    expect(buried.page.map(x => "key" in x ? x.key : "").sort()).toEqual([...fixture.burials].sort());
  }
});
