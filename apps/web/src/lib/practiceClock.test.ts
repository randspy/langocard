import { describe, expect, test } from "vitest";
import { PracticeClock } from "./practiceClock";
import { localDay } from "./study";

describe("foreground practice clock", () => {
  test("counts visible time, excludes hidden time, and keeps unsaved checkpoints", () => {
    const clock = new PracticeClock();
    const at = new Date(2026, 10, 20, 12).getTime();
    clock.sample(at, 0, true);
    clock.sample(at + 10_000, 10_000, false);
    clock.sample(at + 70_000, 70_000, true);
    clock.sample(at + 75_000, 75_000, false);
    expect(clock.seconds).toBe(15);
    expect(clock.checkpoints()).toEqual([{ day: localDay(at), seconds: 15 }]);
    clock.saved(localDay(at), 10);
    expect(clock.checkpoints()).toEqual([{ day: localDay(at), seconds: 5 }]);
  });

  test("splits at local midnight and measures elapsed time independently of wall clock changes", () => {
    const clock = new PracticeClock();
    const at = new Date(2026, 10, 20, 23, 59, 55).getTime();
    clock.sample(at, 0, true);
    clock.sample(at + 10_000, 10_000, false);
    expect(clock.checkpoints()).toEqual([{ day: "2026-11-20", seconds: 5 }, { day: "2026-11-21", seconds: 5 }]);
    clock.sample(at + 3600_000, 11_000, true);
    clock.sample(at + 7200_000, 12_000, false);
    expect(clock.seconds).toBe(11);
  });
});
