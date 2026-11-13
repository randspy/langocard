import { describe, expect, test } from "vitest";
import ruleFixtures from "../../../content/entry-rules-fixtures.json";
import mergeFixtures from "../../../content/merge-fixtures.json";
import { answerOf, clozeOf, entryErrors, fromAndroidJson } from "../convex/entryRules";
import { entryWins, isDeleted, mergeCard, SUSPENDED_INDEFINITELY, type CardState } from "../convex/merge";

describe("entry rules (shared fixtures)", () => {
  test.each(ruleFixtures.cases)("$name", ({ entry, rule }) => {
    const { entryId, ...content } = fromAndroidJson(entry);
    const rules = [...new Set(entryErrors(entryId, content).map((e) => e.rule))];
    expect(rules).toEqual(rule === null ? [] : [rule]);
  });
});

describe("entry rules", () => {
  test("reports every broken field for form errors", () => {
    const errors = entryErrors("bad id", { word: "", english: "", definition: "d", example: "no answer", topic: "x", lemma: "", rank: null, sourceUrl: "", license: "", gender: null });
    expect(errors.map((e) => e.field)).toEqual(["entryId", "word", "english", "example", "topic"]);
  });

  test("derives the answer and the cloze", () => {
    expect(answerOf("Il pleut, {pourtant} elle sort.")).toBe("pourtant");
    expect(clozeOf("Il pleut, {pourtant} elle sort.")).toBe("Il pleut, ________ elle sort.");
  });
});

describe("merge rules (shared fixtures)", () => {
  test("indefinite suspension sentinel matches", () => {
    expect(mergeFixtures.suspendedIndefinitely).toBe(SUSPENDED_INDEFINITELY);
  });

  test.each(mergeFixtures.cards)("card: $name", ({ stored, incoming, expected }) => {
    expect(mergeCard(stored as CardState, incoming as CardState)).toEqual(expected);
  });

  test.each(mergeFixtures.entries)("entry: $name", ({ stored, incoming, incomingWins, deleted }) => {
    expect(entryWins(incoming, stored)).toBe(incomingWins);
    expect(isDeleted(incoming)).toBe(deleted);
  });
});
