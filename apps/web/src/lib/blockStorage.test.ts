import { afterEach, expect, test } from "vitest";
import { PracticeBlock } from "@backend/practiceBlock";
import { readExtraBlock, saveExtraBlock } from "./blockStorage";

afterEach(() => localStorage.clear());

test("stored usage survives a fresh read, resets for a new grant, and expires at midnight", () => {
  const day = "2026-11-20";
  const block = PracticeBlock.grant(day, 1020, 10).introduced(true, false);
  saveExtraBlock(block.toJSON());
  expect(PracticeBlock.read(readExtraBlock(), day, 1100).toJSON()).toEqual(block.toJSON());
  expect(PracticeBlock.read(readExtraBlock(), "2026-11-21", 0).isExtra).toBe(false);
  saveExtraBlock(PracticeBlock.grant(day, 1620, 5).toJSON());
  expect(PracticeBlock.read(readExtraBlock(), day, 1620).meaningRoom(100)).toBe(true);
});

test("malformed stored usage is review-only on every reload", () => {
  localStorage.setItem("langocard.extraBlock", JSON.stringify({ day: "2026-11-20", start: 900, minutes: 5, meaningsUsed: "0" }));
  for (let read = 0; read < 2; read++) {
    const block = PracticeBlock.read(readExtraBlock(), "2026-11-20", 950);
    expect(block.end).toBe(1200);
    expect(block.meaningRoom(0)).toBe(false);
    expect(block.genderRoom(0)).toBe(false);
  }
});
