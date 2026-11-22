import { describe, expect, test } from "vitest";
import fixture from "@content/anki-fixtures.json";
import { fromAndroidJson } from "@backend/entryRules";
import { ankiTsv, exportLibrary, exportOrder } from "./anki";

describe("Anki export", () => {
  test("matches Android's export for the shared fixture", () => {
    expect(ankiTsv(fixture.entries.map(fromAndroidJson), fixture.credits)).toBe(fixture.expected);
  });

  test("escapes '/' in credits as Android's org.json does", () => {
    const [entry] = fixture.entries.map(fromAndroidJson);
    expect(ankiTsv([entry], [{ source: "https://x", license: "L" }])).toContain("https:\\/\\/x");
  });

  test("orders built-in entries, then packs, then personal ones, each by rank", () => {
    const e = (entryId: string, origin: string, rank: number | null) => ({ entryId, origin, rank });
    expect(exportOrder([e("p", "personal", null), e("b2", "bundled", 9), e("k", "pack:x", 3), e("b1", "bundled", 2), e("k0", "pack:y", null)])
      .map((x) => x.entryId)).toEqual(["b1", "b2", "k", "k0", "p"]);
  });
});

test("exports every page of the library in export order", async () => {
  const [a, b] = fixture.entries.map(fromAndroidJson).map((e, i) => ({ ...e, origin: i === 0 ? "personal" : "bundled" }));
  const pages = { start: { entries: [a], isDone: false, continueCursor: "next" }, next: { entries: [b], isDone: true, continueCursor: "" } };
  const tsv = await exportLibrary(async (cursor) => pages[cursor === null ? "start" : "next"], []);
  expect(tsv).toContain(`${a.word}<br>`);
  expect(tsv).toContain(`${b.word}<br>`);
  expect(tsv.indexOf(`${b.word}<br>`)).toBeLessThan(tsv.indexOf(`${a.word}<br>`));
});
