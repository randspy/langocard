/**
 * What makes a vocabulary entry valid. Used by Convex mutations (authoritative) and
 * imported by the web app for inline form errors. Android mirrors these rules in
 * `ContentFiles.validateEntry`; `content/entry-rules-fixtures.json` keeps both in step.
 *
 * Self-contained (no imports) so Node scripts can load it directly.
 */

export const TOPICS = ["daily", "culture", "news"] as const;
export type Topic = (typeof TOPICS)[number];

/** The learner-visible content of an entry. `rank: null` means unranked. */
export type EntryContent = {
  word: string;
  english: string;
  definition: string;
  /** Example sentence with exactly one `{answer}`. */
  example: string;
  topic: string;
  lemma: string;
  rank: number | null;
  sourceUrl: string;
  license: string;
};

export const CONTENT_FIELDS = [
  "word", "english", "definition", "example", "topic", "lemma", "rank", "sourceUrl", "license",
] as const satisfies readonly (keyof EntryContent)[];

export type RuleCode = "id" | "fields" | "answer" | "metadata" | "sourceUrl" | "topic";
export type RuleError = { rule: RuleCode; field: keyof EntryContent | "entryId"; message: string };

const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const MAX_TEXT = 2000;
const blank = (s: string) => s.trim().length === 0;
const count = (s: string, c: string) => s.split(c).length - 1;

/** The marked answer, e.g. "pourtant" in "Il pleut, {pourtant} elle sort." */
export function answerOf(example: string): string {
  const start = example.indexOf("{");
  const end = example.indexOf("}", start + 1);
  return start < 0 || end < 0 ? "" : example.slice(start + 1, end);
}

/** The example with the answer replaced by a gap, as shown in production practice. */
export function clozeOf(example: string): string {
  return example.replace(`{${answerOf(example)}}`, "________");
}

/** Every rule the entry breaks, in Android's checking order. Empty means valid. */
export function entryErrors(entryId: string, e: EntryContent): RuleError[] {
  const errors: RuleError[] = [];
  if (!ID.test(entryId)) errors.push({ rule: "id", field: "entryId", message: "Invalid entry ID" });
  for (const field of ["word", "english", "definition", "example"] as const) {
    if (blank(e[field]) || e[field].length > MAX_TEXT) {
      errors.push({ rule: "fields", field, message: "Fill every field (maximum 2,000 characters each)" });
    }
  }
  const open = e.example.indexOf("{");
  if (count(e.example, "{") !== 1 || count(e.example, "}") !== 1 || open > e.example.indexOf("}") || blank(answerOf(e.example))) {
    errors.push({ rule: "answer", field: "example", message: "Mark exactly one answer with {braces} in the example" });
  }
  if (e.rank !== null && !(Number.isInteger(e.rank) && e.rank > 0)) {
    errors.push({ rule: "metadata", field: "rank", message: "Invalid vocabulary metadata" });
  }
  if (e.lemma.length > 200) errors.push({ rule: "metadata", field: "lemma", message: "Invalid vocabulary metadata" });
  if (e.license.length > 500) errors.push({ rule: "metadata", field: "license", message: "Invalid vocabulary metadata" });
  if (e.sourceUrl !== "" && !(e.sourceUrl.startsWith("https://") && e.sourceUrl.length <= MAX_TEXT)) {
    errors.push({ rule: "sourceUrl", field: "sourceUrl", message: "Invalid source URL" });
  }
  if (!(TOPICS as readonly string[]).includes(e.topic)) errors.push({ rule: "topic", field: "topic", message: "Unknown topic" });
  return errors;
}

/** Entry content from Android's JSON format (packs, backups): `rank` absent means unranked. */
export function fromAndroidJson(o: Record<string, unknown>): { entryId: string } & EntryContent {
  const str = (key: string) => (typeof o[key] === "string" ? (o[key] as string) : "");
  return {
    entryId: str("id"),
    word: str("word"),
    english: str("english"),
    definition: str("definition"),
    example: str("example"),
    topic: str("topic"),
    lemma: str("lemma"),
    rank: typeof o.rank === "number" ? o.rank : null,
    sourceUrl: str("sourceUrl"),
    license: str("license"),
  };
}

export function sameContent(a: EntryContent, b: EntryContent): boolean {
  return CONTENT_FIELDS.every((field) => a[field] === b[field]);
}

export function contentOf(e: EntryContent): EntryContent {
  return Object.fromEntries(CONTENT_FIELDS.map((field) => [field, e[field]])) as EntryContent;
}
