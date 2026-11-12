import { describe, expect, test } from "vitest";
import { parseCard, parseReviewLog } from "../convex/cardState";

describe("cardState", () => {
  test("reads java-fsrs card JSON", () => {
    const json = '{"cardId":7,"state":"RELEARNING","step":0,"stability":1.5,"difficulty":6.2,"due":"2026-11-13T08:00:00Z","lastReview":"2026-11-12T08:00:00Z"}';
    expect(parseCard(json)).toEqual({
      state: "RELEARNING", step: 0, stability: 1.5, difficulty: 6.2,
      due: Date.parse("2026-11-13T08:00:00Z"), lastReview: Date.parse("2026-11-12T08:00:00Z"),
    });
  });

  test("treats a reset or unreadable card as no schedule", () => {
    expect(parseCard(null)).toBeNull();
    expect(parseCard("{")).toBeNull();
    expect(parseCard('{"state":"REVIEW"}')).toBeNull();
  });

  test("reads review logs", () => {
    expect(parseReviewLog('{"cardId":7,"rating":"GOOD","review_datetime":"2026-11-12T08:00:00Z","reviewDuration":null}'))
      .toEqual({ rating: "GOOD", at: Date.parse("2026-11-12T08:00:00Z"), durationMs: null });
    expect(parseReviewLog('{"rating":"MAYBE"}')).toBeNull();
  });
});
