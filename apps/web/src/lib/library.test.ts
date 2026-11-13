import { describe, expect, test } from "vitest";
import { SUSPENDED_INDEFINITELY } from "@backend/merge";
import { DAY, NOW, libraryEntry } from "@/test/fixtures";
import { filterLibrary, skillStatus, validateSearch } from "./library";

const entries = [
  libraryEntry({ entryId: "a", word: "élève", english: "pupil", rank: 900, topic: "culture" }),
  libraryEntry({ entryId: "b", word: "un enjeu", english: "stake", rank: 3000, edited: true, gender: "masculine" }),
  libraryEntry({ entryId: "c", word: "fiable", english: "reliable", rank: 8000, origin: "pack:fr-source-extended-2026-11-v1", installed: false }),
  libraryEntry({ entryId: "d", word: "ma trouvaille", english: "my find", rank: null, origin: "personal", deleted: true }),
  libraryEntry({ entryId: "e", word: "pourtant", english: "however", rank: 20, skills: { Listening: { due: null, state: null, pausedUntil: 0, suspendedUntil: NOW + DAY } } }),
];
const ids = (search: Parameters<typeof filterLibrary>[1]) => filterLibrary(entries, search, NOW).map((e) => e.entryId);

describe("filterLibrary", () => {
  test("hides deleted entries by default and orders by rank", () => {
    expect(ids({})).toEqual(["e", "a", "b", "c"]);
  });

  test("searches word, lemma and English, ignoring accents and case", () => {
    expect(ids({ q: "ELEVE" })).toEqual(["a"]);
    expect(ids({ q: "relia" })).toEqual(["c"]);
  });

  test("filters by origin, pack installation, topic and rank band", () => {
    expect(ids({ origin: "pack" })).toEqual(["c"]);
    expect(ids({ pack: "notInstalled" })).toEqual(["c"]);
    expect(ids({ topic: "culture" })).toEqual(["a"]);
    expect(ids({ rank: "2501-7000" })).toEqual(["b"]);
    expect(ids({ rank: "unranked", status: "all" })).toEqual(["d"]);
  });

  test("filters by gender", () => {
    expect(ids({ gender: "noun" })).toEqual(["b"]);
    expect(ids({ gender: "masculine" })).toEqual(["b"]);
    expect(ids({ gender: "feminine" })).toEqual([]);
    expect(ids({ gender: "none" })).toEqual(["e", "a", "c"]);
  });

  test("filters by status", () => {
    expect(ids({ status: "deleted" })).toEqual(["d"]);
    expect(ids({ status: "edited" })).toEqual(["b"]);
    expect(ids({ status: "suspended" })).toEqual(["e"]);
    expect(ids({ status: "all" })).toHaveLength(5);
  });
});

describe("skillStatus", () => {
  const summary = { due: NOW - DAY, state: "REVIEW", pausedUntil: 0, suspendedUntil: 0 };
  test("distinguishes new, due and scheduled", () => {
    expect(skillStatus(undefined, NOW)).toEqual({ kind: "new" });
    expect(skillStatus({ ...summary, due: null }, NOW)).toEqual({ kind: "new" });
    expect(skillStatus(summary, NOW).kind).toBe("due");
    expect(skillStatus({ ...summary, due: NOW + DAY }, NOW).kind).toBe("scheduled");
  });

  test("a suspension outranks a leech pause, which outranks the schedule", () => {
    expect(skillStatus({ ...summary, pausedUntil: NOW + DAY, suspendedUntil: NOW + DAY }, NOW).kind).toBe("suspended");
    expect(skillStatus({ ...summary, pausedUntil: NOW + DAY }, NOW).kind).toBe("paused");
    expect(skillStatus({ ...summary, suspendedUntil: NOW - 1 }, NOW).kind).toBe("due");
  });

  test("a suspension without an end date has no until", () => {
    expect(skillStatus({ ...summary, suspendedUntil: SUSPENDED_INDEFINITELY }, NOW)).toEqual({ kind: "suspended", until: null });
    expect(skillStatus({ ...summary, suspendedUntil: NOW + DAY }, NOW)).toEqual({ kind: "suspended", until: NOW + DAY });
  });
});

describe("validateSearch", () => {
  test("keeps known values and drops the rest", () => {
    expect(validateSearch({ q: "  ", origin: "pack", topic: "sport", status: "edited", extra: 1 })).toEqual({ origin: "pack", status: "edited" });
  });

  test("treats the default status as no filter", () => {
    expect(validateSearch({ status: "active" })).toEqual({});
  });
});
