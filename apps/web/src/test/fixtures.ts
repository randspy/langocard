import type { LibraryEntry } from "@/lib/library";

export const NOW = Date.parse("2026-11-12T12:00:00Z");
export const DAY = 86_400_000;

export function libraryEntry(o: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    entryId: "frw-1", word: "avoir", english: "have", gender: null, lemma: "avoir", topic: "daily", rank: 6, origin: "bundled",
    installed: true, edited: false, deleted: false, upstreamChanged: false, retired: false, skills: {}, ...o,
  };
}
