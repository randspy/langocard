import { clozeOf, nounOf, textOf, type EntryContent } from "@backend/entryRules";

export type AnkiEntry = Pick<EntryContent, "word" | "english" | "definition" | "examples" | "sourceUrl" | "license" | "gender">;
export type Credit = { source: string; license: string };

const html = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/\t/g, " ").replace(/\r/g, "").replace(/\n/g, "<br>");

/** A JSON string as Android's `org.json` writes it, which also escapes "/". */
const androidJson = (value: unknown) => JSON.stringify(value).replace(/\//g, "\\/");

/**
 * The tab-separated Anki import file the Android app exports (`ContentFiles.anki`), byte for
 * byte: one Reading and one Production note per entry, plus a Gender note for nouns. Fronts use
 * the introductory example, backs list every example, and every note keeps its source credit.
 * `content/anki-fixtures.json` holds a case both implementations must reproduce.
 */
export function ankiTsv(entries: readonly AnkiEntry[], credits: readonly Credit[]): string {
  const unique = [...new Set(credits.map((c) => androidJson({ source: c.source, license: c.license })))];
  const attribution = html(`[${unique.join(",")}]`);
  let out = "#separator:Tab\n#html:true\n#columns:Front\tBack\tTags\n";
  for (const e of entries) {
    const credit = `${html(e.sourceUrl)} ${html(e.license)}<br>${attribution}`;
    const first = e.examples[0];
    const all = e.examples.map((x) => html(textOf(x))).join("<br>");
    const back = `${html(e.english)}<br>${html(e.definition)}<br>${all}<br>${credit}`;
    out += `${html(e.word)}<br>${html(textOf(first))}\t${back}\tlangocard reading\n`;
    out += `${html(e.english)}<br>${html(clozeOf(first))}\t${html(e.word)}<br>${all}<br>${credit}\tlangocard production\n`;
    if (e.gender !== null) {
      const noun = nounOf(e.word);
      const article = e.gender === "masculine" ? "un" : "une";
      out += `${html(noun)}<br>${html(e.english)}\t${html(`${article} ${noun}`)}<br>${all}<br>${credit}\tlangocard gender\n`;
    }
  }
  return out;
}

const ORIGIN_ORDER = (origin: string) => (origin === "bundled" ? 0 : origin === "personal" ? 2 : 1);

/** Library order for the export: built-in entries, then packs, then personal ones, each by frequency rank. */
export function exportOrder<E extends { entryId: string; origin: string; rank: number | null }>(entries: readonly E[]): E[] {
  return [...entries].sort((a, b) => ORIGIN_ORDER(a.origin) - ORIGIN_ORDER(b.origin) ||
    (a.rank ?? Infinity) - (b.rank ?? Infinity) || (a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0));
}

type Page<E> = { entries: E[]; isDone: boolean; continueCursor: string };

/** Reads the active library page by page and builds the export, crediting `credits` in order. */
export async function exportLibrary<E extends AnkiEntry & { entryId: string; origin: string; rank: number | null }>(
  fetchPage: (cursor: string | null) => Promise<Page<E>>, credits: readonly Credit[],
): Promise<string> {
  const entries: E[] = [];
  for (let cursor: string | null = null; ;) {
    const page: Page<E> = await fetchPage(cursor);
    entries.push(...page.entries);
    if (page.isDone) break;
    cursor = page.continueCursor;
  }
  return ankiTsv(exportOrder(entries), credits);
}
