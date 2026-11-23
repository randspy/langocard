import { expect, test } from "vitest";
import { cardToJson, DEFAULT_PARAMETERS, newCard, Scheduler } from "@backend/fsrs";
import { intervals } from "./study";

test("interval previews follow the learner's fitted settings", () => {
  const now = Date.parse("2026-11-20T09:00:00Z");
  const learned = new Scheduler({ enableFuzzing: false }).review(newCard(1, now - 30 * 864e5), "EASY", now - 30 * 864e5).card;
  const card = cardToJson({ ...learned, due: now });
  const fit = { parameters: [...DEFAULT_PARAMETERS], retention: 0.7, reviewCount: 1200, fitDate: "2026-11-15T12:00:00Z" };
  const defaults = intervals(card, now);
  const lowRetention = intervals(card, now, fit);
  expect(parseInt(lowRetention.GOOD)).toBeGreaterThan(parseInt(defaults.GOOD));
});
