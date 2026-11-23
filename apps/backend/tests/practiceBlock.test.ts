import { expect, test } from "vitest";
import { PracticeBlock, EXTRA_MINUTES } from "../convex/practiceBlock";
const day = "2026-11-20";

test("a grant starts after cleanup, owns independent allowances, and repeats consume nothing", () => {
  for (const minutes of EXTRA_MINUTES) {
    let block = PracticeBlock.grant(day, 1020, minutes);
    const limit = minutes === 5 ? 2 : minutes === 10 ? 3 : 5;
    expect(block.end).toBe(1020 + minutes * 60);
    expect(block.phase(block.end - 121)).toBe("practice");
    expect(block.phase(block.end - 120)).toBe("wind-down");
    expect(block.phase(block.end)).toBe("cleanup");
    expect(block.phase(block.end + 120)).toBe("done");
    for (let i = 0; i < limit; i++) {
      expect(block.meaningRoom(100)).toBe(true);
      block = block.introduced(true, false);
    }
    expect(block.meaningRoom(0)).toBe(false);
    for (let i = 0; i < limit; i++) {
      expect(block.genderRoom(100)).toBe(true);
      block = block.introduced(false, true);
    }
    expect(block.genderRoom(0)).toBe(false);
    expect(block.introduced(false, false).toJSON()).toEqual(block.toJSON());
    expect(PracticeBlock.read(block.toJSON(), day, 1100).toJSON()).toEqual(block.toJSON());
    expect(PracticeBlock.grant(day, block.end, minutes).meaningRoom(100)).toBe(true);
  }
});

test("expired, future or invalid durations fall back to daily; corrupt usage preserves review-only time", () => {
  const saved = PracticeBlock.grant(day, 900, 5).toJSON()!;
  expect(PracticeBlock.read(saved, "2026-11-21", 950).isExtra).toBe(false);
  expect(PracticeBlock.read(saved, day, 0).isExtra).toBe(false);
  expect(PracticeBlock.read({ ...saved, minutes: 7 }, day, 950).isExtra).toBe(false);
  for (const value of [undefined, -1, 3, 0.5, "0", null]) {
    for (let repeat = 0; repeat < 2; repeat++) {
      const block = PracticeBlock.read({ ...saved, meaningsUsed: value }, day, 950);
      expect(block.end).toBe(1200);
      expect(block.meaningRoom(0)).toBe(false);
      expect(block.genderRoom(0)).toBe(false);
    }
  }
  expect(PracticeBlock.daily.meaningRoom(4)).toBe(true);
  expect(PracticeBlock.daily.meaningRoom(5)).toBe(false);
  expect(PracticeBlock.daily.genderRoom(9)).toBe(true);
  expect(PracticeBlock.daily.genderRoom(10)).toBe(false);
});
