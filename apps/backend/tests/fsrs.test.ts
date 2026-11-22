import { describe, expect, test } from "vitest";
import fixtures from "../../../content/fsrs-fixtures.json";
import {
  cardFromJson, cardToJson, intervalLabel, javaRandom, logFromJson, logToJson, newCard, Scheduler, type Rating,
} from "../convex/fsrs";

const schedulers = new Map(fixtures.schedulers.map((s) => [s.name, s]));

/**
 * Same state, step and times; stability and difficulty may differ in the last bits, since
 * `Math.pow` and `Math.exp` aren't bit-identical across the JVM, ART and JavaScript engines.
 */
function expectSameCard(actual: string, expected: string) {
  const [a, e] = [cardFromJson(actual), cardFromJson(expected)];
  expect({ ...a, stability: null, difficulty: null }).toEqual({ ...e, stability: null, difficulty: null });
  for (const field of ["stability", "difficulty"] as const) {
    expect(a[field]).toBeCloseTo(e[field]!, 10);
  }
}

describe("FSRS matches java-fsrs 1.0.0 (shared fixtures)", () => {
  test.each(fixtures.cases)("$name", ({ scheduler: name, steps }) => {
    const config = schedulers.get(name)!;
    // One scheduler per case, as the generator does, so seeded fuzzing draws the same numbers.
    const scheduler = new Scheduler({
      parameters: config.parameters,
      desiredRetention: config.desiredRetention,
      enableFuzzing: config.enableFuzzing,
      random: javaRandom(config.randomSeed),
    });
    for (const step of steps) {
      const card = cardFromJson(step.card);
      expect(cardToJson(card)).toBe(step.card);
      const result = scheduler.review(card, step.rating as Rating, Date.parse(step.reviewDatetime));
      expectSameCard(cardToJson(result.card), step.expectedCard);
      expect(logToJson(result.log)).toBe(step.expectedLog);
    }
  });

  test("covers every state and rating", () => {
    const outcomes = fixtures.cases.flatMap((c) => c.steps.map((s) => [cardFromJson(s.card).state, s.rating].join(" ")));
    for (const state of ["LEARNING", "REVIEW", "RELEARNING"]) {
      for (const rating of ["AGAIN", "HARD", "GOOD", "EASY"]) expect(outcomes).toContain(`${state} ${rating}`);
    }
  });

  test("serialises new cards and logs as Android does", () => {
    expect(cardToJson(newCard(3, Date.parse("2026-01-05T08:00:00Z")))).toBe(fixtures.serialised.newCard);
    const log = logFromJson(fixtures.serialised.logWithDuration);
    expect(log).toEqual({ cardId: 7, rating: "HARD", reviewDatetime: Date.parse("2026-01-05T08:00:00.123Z"), reviewDuration: 3200 });
    expect(logToJson(log)).toBe(fixtures.serialised.logWithDuration);
  });

  test.each(fixtures.intervals)("interval until $due is $label", ({ now, due, label }) => {
    expect(intervalLabel(Date.parse(now), Date.parse(due))).toBe(label);
  });
});

describe("FSRS", () => {
  test("reads cards that omit null fields", () => {
    expect(cardFromJson('{"cardId":1,"state":"LEARNING","due":"2026-01-01T00:00:00Z"}'))
      .toEqual(newCard(1, Date.parse("2026-01-01T00:00:00Z")));
  });

  test("writes Java's exponent form for very small and large values", () => {
    const card = { ...newCard(1, 0), stability: 0.0001, difficulty: 12345678.5 };
    expect(cardToJson(card)).toContain('"stability":1.0E-4,"difficulty":1.23456785E7');
  });

  test("fuzzing keeps review intervals within java-fsrs's range", () => {
    const review = { cardId: 1, state: "REVIEW" as const, step: null, stability: 30, difficulty: 5, due: 0, lastReview: 0 };
    const at = (random: number) =>
      (new Scheduler({ random: () => random }).review(review, "GOOD", 30 * 86_400_000).card.due - 30 * 86_400_000) / 86_400_000;
    const plain = (new Scheduler({ enableFuzzing: false }).review(review, "GOOD", 30 * 86_400_000).card.due - 30 * 86_400_000) / 86_400_000;
    expect(at(0)).toBeLessThan(plain);
    expect(at(0.999)).toBeGreaterThan(plain);
  });
});
