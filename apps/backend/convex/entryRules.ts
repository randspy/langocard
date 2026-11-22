/**
 * What makes a vocabulary entry valid. Used by Convex mutations (authoritative) and
 * imported by the web app for inline form errors. Android mirrors these rules in
 * `ContentFiles.validateEntry`; `content/entry-rules-fixtures.json` keeps both in step.
 *
 * Self-contained (no imports) so Node scripts can load it directly.
 */

export const TOPICS = ["daily", "culture", "news"] as const;
export type Topic = (typeof TOPICS)[number];

/** Grammatical gender of a noun. An entry without one is not a noun. */
export const GENDERS = ["masculine", "feminine"] as const;
export type Gender = (typeof GENDERS)[number];

/** The learner-visible content of an entry. `rank: null` means unranked. */
export type EntryContent = {
  word: string;
  english: string;
  definition: string;
  /**
   * 1 to `MAX_EXAMPLES` sentences, each with exactly one `{answer}`, which may list
   * alternatives after the target: `{arriver|parvenir}`. The first is the
   * introductory example; practice rotates through the rest (see `exampleAt`).
   */
  examples: string[];
  topic: string;
  lemma: string;
  rank: number | null;
  sourceUrl: string;
  license: string;
  /** Set for nouns. When `word` starts with a gendered article, they agree. */
  gender: Gender | null;
};

export const CONTENT_FIELDS = [
  "word", "english", "definition", "examples", "topic", "lemma", "rank", "sourceUrl", "license", "gender",
] as const satisfies readonly (keyof EntryContent)[];

export type RuleCode = "id" | "fields" | "answer" | "alternatives" | "examples" | "metadata" | "sourceUrl" | "topic" | "gender";
/** `index` is set for an error in one example: its position in `examples`. */
export type RuleError = { rule: RuleCode; field: keyof EntryContent | "entryId"; message: string; index?: number };

/** A meaning has at most this many examples. */
export const MAX_EXAMPLES = 5;

const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const MAX_TEXT = 2000;
const blank = (s: string) => s.trim().length === 0;
const validText = (s: string) => !blank(s) && s.length <= MAX_TEXT;
const fieldsError = (field: keyof EntryContent): RuleError =>
  ({ rule: "fields", field, message: "Fill every field (maximum 2,000 characters each)" });
const count = (s: string, c: string) => s.split(c).length - 1;

const ARTICLES: Record<string, Gender> = { un: "masculine", le: "masculine", une: "feminine", la: "feminine" };
const ARTICLE = /^(un|une|le|la)\s+(?=\S)/i;
const ELISION = /^l['’]\s*(?=\S)/i;

/**
 * The gender a leading article in `word` states: "une intrigue" → feminine. Null when
 * the word has no gendered article ("l'arbre", "pourtant").
 */
export function articleGender(word: string): Gender | null {
  const article = ARTICLE.exec(word.trim())?.[1];
  return article ? ARTICLES[article.toLowerCase()] : null;
}

/** The word without its leading article, as a Gender card shows it: "une intrigue" → "intrigue". */
export function nounOf(word: string): string {
  const trimmed = word.trim();
  return trimmed.replace(ARTICLE, "").replace(ELISION, "");
}

/** An example's answer lists at most this many alternatives after its target. */
export const MAX_ALTERNATIVES = 5;

/** The text between the answer marks, or null when the example has none. */
function marked(example: string): { start: number; end: number; inner: string } | null {
  const start = example.indexOf("{");
  const end = example.indexOf("}", start + 1);
  return start < 0 || end < 0 ? null : { start, end, inner: example.slice(start + 1, end) };
}

/**
 * The marked answer's parts: the target first, then any alternatives, written
 * `{target|alternative}`. A lone answer is kept as written; listed parts are trimmed.
 */
function answerParts(example: string): string[] {
  const inner = marked(example)?.inner ?? "";
  return inner.includes("|") ? inner.split("|").map((part) => part.trim()) : [inner];
}

/** The example with its answer marks replaced by `replacement`. */
function replaceAnswer(example: string, replacement: string): string {
  const m = marked(example);
  return m ? example.slice(0, m.start) + replacement + example.slice(m.end + 1) : example;
}

/** The target, e.g. "pourtant" in "Il pleut, {pourtant} elle sort." or "arriver" in "{arriver|parvenir}". */
export function answerOf(example: string): string {
  return answerParts(example)[0];
}

/** Other words the gap accepts in Production: "parvenir" in "Le train devrait {arriver|parvenir} à la gare." */
export function alternativesOf(example: string): string[] {
  return answerParts(example).slice(1);
}

/** The example with the answer replaced by a gap, as shown in production practice. */
export function clozeOf(example: string): string {
  return replaceAnswer(example, "________");
}

/** The example without its answer marks or alternatives, as read or spoken. */
export function textOf(example: string): string {
  return replaceAnswer(example, answerOf(example));
}

/** The example with its answer's alternatives replaced by `alternatives`. */
export function withAlternatives(example: string, alternatives: readonly string[]): string {
  return marked(example) ? replaceAnswer(example, `{${[answerOf(example), ...alternatives].join("|")}}`) : example;
}

/** The example with its alternatives dropped: the sentence an example's alternatives belong to. */
export function withoutAlternatives(example: string): string {
  return withAlternatives(example, []);
}

/**
 * The example a meaning shows after `exposures` reviews: they rotate in order, starting
 * from the introductory example. Android mirrors this in `Entry.exampleAt`.
 */
export function exampleAt(examples: readonly string[], exposures: number): string {
  return examples[exposures % examples.length];
}

/** Lower case without accents, so "Râvi" and "ravi" count as the same word. */
export const folded = (s: string) => s.normalize("NFD").replace(/\p{Mn}+/gu, "").toLowerCase().replace(/œ/g, "oe").replace(/æ/g, "ae");
const validAlternatives = (example: string) => {
  const parts = answerParts(example);
  return parts.length <= MAX_ALTERNATIVES + 1 && parts.every((part) => !blank(part)) && new Set(parts.map(folded)).size === parts.length;
};

const markedOnce = (example: string) =>
  count(example, "{") === 1 && count(example, "}") === 1 && example.indexOf("{") < example.indexOf("}") && !blank(answerOf(example));

/** Every rule the entry breaks, in Android's checking order. Empty means valid. */
export function entryErrors(entryId: string, e: EntryContent): RuleError[] {
  const errors: RuleError[] = [];
  if (!ID.test(entryId)) errors.push({ rule: "id", field: "entryId", message: "Invalid entry ID" });
  for (const field of ["word", "english", "definition"] as const) {
    if (!validText(e[field])) errors.push(fieldsError(field));
  }
  e.examples.forEach((example, index) => {
    if (!validText(example)) errors.push({ ...fieldsError("examples"), index });
    else if (!markedOnce(example)) {
      errors.push({ rule: "answer", field: "examples", index, message: "Mark exactly one answer with {braces} in the example" });
    } else if (!validAlternatives(example)) {
      errors.push({ rule: "alternatives", field: "examples", index, message: "Alternatives must be different, non-empty words (at most 5)" });
    }
  });
  // Alternatives don't make a sentence another example.
  const distinct = new Set(e.examples.map((example) => withoutAlternatives(example).trim()));
  if (e.examples.length < 1 || e.examples.length > MAX_EXAMPLES) {
    errors.push({ rule: "examples", field: "examples", message: `Give 1 to ${MAX_EXAMPLES} examples` });
  } else if (distinct.size !== e.examples.length) {
    errors.push({ rule: "examples", field: "examples", message: "Each example must be different" });
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
  const stated = articleGender(e.word);
  if (e.gender !== null && !(GENDERS as readonly string[]).includes(e.gender)) {
    errors.push({ rule: "gender", field: "gender", message: "Unknown gender" });
  } else if (e.gender !== null && stated !== null && stated !== e.gender) {
    errors.push({ rule: "gender", field: "gender", message: "The gender doesn't match the article" });
  }
  return errors;
}

/**
 * Entry content from Android's JSON format (packs, backups): `rank` absent means unranked;
 * `gender` absent (content that predates it) means the article gender.
 */
export function fromAndroidJson(o: Record<string, unknown>): { entryId: string } & EntryContent {
  const str = (key: string) => (typeof o[key] === "string" ? (o[key] as string) : "");
  return {
    entryId: str("id"),
    word: str("word"),
    english: str("english"),
    definition: str("definition"),
    examples: Array.isArray(o.examples) ? o.examples.map((x) => (typeof x === "string" ? x : "")) : [],
    topic: str("topic"),
    lemma: str("lemma"),
    rank: typeof o.rank === "number" ? o.rank : null,
    sourceUrl: str("sourceUrl"),
    license: str("license"),
    gender: "gender" in o ? (o.gender as Gender | null) : articleGender(str("word")),
  };
}

/** Content as stored: rows written before gender existed have none. */
export type StoredContent = Omit<EntryContent, "gender"> & { gender?: Gender | null };

/** Whether two contents agree on one field. Examples compare in order, so reordering them is an edit. */
export function sameField(field: keyof EntryContent, x: EntryContent, y: EntryContent): boolean {
  if (field !== "examples") return x[field] === y[field];
  return x.examples.length === y.examples.length && x.examples.every((example, i) => example === y.examples[i]);
}

export function sameContent(a: StoredContent, b: StoredContent): boolean {
  const [x, y] = [contentOf(a), contentOf(b)];
  return CONTENT_FIELDS.every((field) => sameField(field, x, y));
}

/**
 * Just the content fields of a row. Rows stored before gender existed take the article
 * gender, as `migrations:fillGender` gives them.
 */
export function contentOf(e: StoredContent): EntryContent {
  const content = Object.fromEntries(CONTENT_FIELDS.map((field) => [field, e[field]])) as EntryContent;
  if (e.gender === undefined) content.gender = articleGender(e.word);
  return content;
}
