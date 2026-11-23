import { describe, expect, test } from "vitest";
import fixtures from "../../../content/typed-answer-fixtures.json";
import { MATCH_RATING, typedAnswer } from "../convex/typedAnswer";

describe("typed answers match Android (shared fixtures)", () => {
  test.each(fixtures.cases)("$typed → $example", ({ typed, example, noun, alternatives, expected }) => {
    const answer = typedAnswer(typed, example, noun, alternatives);
    if (expected === null) return expect(answer).toBeNull();
    expect(answer).toMatchObject({
      match: expected.match, target: expected.target, expected: expected.expected,
      typedParts: expected.typedParts, expectedParts: expected.expectedParts,
    });
    expect(MATCH_RATING[answer!.match]).toBe(expected.suggested);
  });
});
