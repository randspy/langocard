import { expect, test } from "vitest";
import fixtures from "../../../content/noun-ending-fixtures.json";
import { endingMatch, ENDING_RULES } from "../convex/nounEndings";
import type { Gender } from "../convex/entryRules";

test("the rules are the shared ones", () => {
  expect(ENDING_RULES.map((r) => [r.ending, r.gender])).toEqual(fixtures.rules.map((r) => [r.ending, r.gender]));
});

test.each(fixtures.cases)("$word", ({ word, gender, ending, follows }) => {
  const match = endingMatch(word, gender as Gender);
  expect(match ? { ending: match.rule.ending, follows: match.follows } : null).toEqual(ending === null ? null : { ending, follows });
});

test("feedback reads as the phone's", () => {
  expect(endingMatch("une image", "feminine")?.feedback).toBe("-age: usually masculine. This noun is an exception.");
  expect(endingMatch("pourtant", null)).toBeNull();
});
