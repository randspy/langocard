import { articleGender, withoutAlternatives, type Gender } from "@backend/entryRules";

/**
 * The fields of a personal entry that can be drafted from its English meaning. Gender's
 * values are `GENDER_VALUES`: "masculine", "feminine" or "none" (not a noun). Examples are a
 * list, so they travel apart from the single-value fields (see `EntryDraft.examples`).
 */
export type DraftField = "word" | "gender" | "definition" | "examples";
export const SINGLE_FIELDS = ["word", "gender", "definition"] as const;
type SingleField = (typeof SINGLE_FIELDS)[number];
export const GENDER_VALUES = ["masculine", "feminine", "none"] as const;

/** A drafted gender value as the entry stores it; "none" (not a noun) is null. */
export const genderOf = (value: string): Gender | null => (value === "masculine" || value === "feminine" ? value : null);

/**
 * What a draft produced: `filled` holds the single-value fields and `examples` the new
 * examples, all passing the entry rules; `unfilled` lists the fields the learner still has to
 * write themselves ("examples" when no example could be drafted).
 */
export type EntryDraft = { filled: Partial<Record<SingleField, string>>; unfilled: Set<DraftField>; examples: string[] };

/** A drafted entry has this many examples, the learner's included. */
export const EXAMPLES_WANTED = 3;
const ATTEMPTS = 2;

type Reply = { fields: Partial<Record<SingleField, string>>; examples: string[] };
/** More drafted fields win (the examples count as one), then more examples. */
const score = (r: Reply) => (Object.keys(r.fields).length + (r.examples.length ? 1 : 0)) * 10 + r.examples.length;

const validText = (s: string) => s.trim() !== "" && s.length <= 2000;
const validAnswer = (s: string) => {
  const open = s.indexOf("{");
  const close = s.indexOf("}");
  return s.split("{").length === 2 && s.split("}").length === 2 && open < close && s.slice(open + 1, close).split("|")[0].trim() !== "";
};

/**
 * Drafts the missing fields of a personal entry from its English meaning with a
 * text-generating model (WebLLM in the browser). Mirrors Android's `EntryDrafter`, prompt
 * included. The learner reviews a draft before saving it; nothing here touches the library.
 *
 * A reply that breaks the entry rules is retried once, then only the fields that pass are
 * returned. A noun's article beats the model's gender. Failures of the model itself
 * propagate from `generate`.
 */
export class EntryDrafter {
  constructor(private readonly generate: (prompt: string) => Promise<string>) {}

  /**
   * Drafts every single-value field not in `kept`, and new examples until the entry has
   * `EXAMPLES_WANTED`. `kept` and `keptExamples` are what the learner wrote; they're never
   * replaced, the draft agrees with them, and drafted examples differ from them.
   */
  async draft(english: string, kept: Partial<Record<SingleField, string>>, keptExamples: readonly string[] = []): Promise<EntryDraft> {
    if (!english.trim()) throw new Error("Enter the English meaning first");
    const learner: Partial<Record<SingleField, string>> = {};
    for (const field of SINGLE_FIELDS) {
      const value = kept[field]?.trim();
      if (value) learner[field] = value;
    }
    const own = keptExamples.map((e) => e.trim()).filter(Boolean);
    const room = Math.max(EXAMPLES_WANTED - own.length, 0);
    const single = SINGLE_FIELDS.filter((f) => !(f in learner));
    const wanted = new Set<DraftField>([...single, ...(room > 0 ? ["examples" as const] : [])]);
    if (wanted.size === 0) return { filled: {}, unfilled: new Set(), examples: [] };
    const prompt = buildPrompt(english.trim(), learner, own);
    let best: Reply = { fields: {}, examples: [] };
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      // One attempt's fields belong together (the examples use that attempt's word), so attempts are never mixed.
      const reply = usable(await this.generate(prompt), learner, own);
      const kept: Reply = {
        fields: Object.fromEntries(Object.entries(reply.fields).filter(([f]) => single.includes(f as SingleField))),
        examples: reply.examples.slice(0, room),
      };
      if (score(kept) >= score(best)) best = kept;
      if (Object.keys(best.fields).length === single.length && best.examples.length === room) break;
    }
    const filled = withArticleGender(best.fields, learner, wanted);
    const unfilled = new Set([...wanted].filter((f) => !(f in filled) && !(f === "examples" && best.examples.length > 0)));
    return { filled, unfilled, examples: best.examples };
  }
}

/** A drafted gender follows the word's article whenever it has one. */
function withArticleGender(draft: Reply["fields"], learner: Reply["fields"], wanted: Set<DraftField>): Reply["fields"] {
  if (!wanted.has("gender")) return draft;
  const word = draft.word ?? learner.word;
  const stated = word === undefined ? null : articleGender(word);
  return stated ? { ...draft, gender: stated } : draft;
}

/**
 * The reply's content that passes the entry rules, given what the learner wrote: examples
 * each with one answer, different from each other and from the learner's. Anything
 * unparseable yields none.
 */
function usable(reply: string, learner: Reply["fields"], own: readonly string[]): Reply {
  const none: Reply = { fields: {}, examples: [] };
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) return none;
  let json: unknown;
  try {
    json = JSON.parse(reply.slice(start, end + 1));
  } catch {
    return none;
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) return none;
  const o = json as Record<string, unknown>;
  const fields: Reply["fields"] = {};
  for (const field of SINGLE_FIELDS) {
    const value = typeof o[field] === "string" ? (o[field] as string).trim() : "";
    const ok = field === "gender" ? (GENDER_VALUES as readonly string[]).includes(value) : validText(value);
    if (ok) fields[field] = value;
  }
  // Examples are the same sentence whatever alternatives they list.
  const seen = new Set(own.map(withoutAlternatives));
  const examples = (Array.isArray(o.examples) ? o.examples : [])
    .filter((e): e is string => typeof e === "string").map((e) => e.trim())
    // The learner writes alternatives; a drafted example has none.
    .filter((e) => {
      if (!validText(e) || !validAnswer(e) || e.slice(e.indexOf("{"), e.indexOf("}")).includes("|")) return false;
      const sentence = withoutAlternatives(e);
      if (seen.has(sentence)) return false;
      seen.add(sentence);
      return true;
    });
  const word = fields.word ?? learner.word;
  const stated = word === undefined ? null : articleGender(word);
  const given = learner.gender ?? fields.gender;
  const gender = given === undefined ? null : genderOf(given);
  if (!stated || !gender || gender === stated) return { fields, examples };
  // The article and the gender disagree: drop whichever side the model wrote.
  if (learner.gender !== undefined) {
    const { word: _, ...rest } = fields;
    return { fields: rest, examples: [] };
  }
  const { gender: _, ...rest } = fields;
  return { fields: rest, examples };
}

function buildPrompt(english: string, learner: Reply["fields"], own: readonly string[]): string {
  let prompt = INSTRUCTIONS;
  for (const [input, reply] of EXAMPLES) prompt += `\n${input}\n${reply}\n`;
  prompt += `\nEnglish meaning: ${english}\n`;
  if (learner.word !== undefined) prompt += `French word: ${learner.word}\n`;
  if (learner.gender !== undefined) prompt += `Gender: ${learner.gender}\n`;
  if (learner.definition !== undefined) prompt += `Definition: ${learner.definition}\n`;
  for (const example of own) prompt += `Example: ${example}\n`;
  return prompt;
}

const INSTRUCTIONS = `You write French vocabulary cards for an English-speaking learner at B2 level.
Reply with only one JSON object with the keys "word", "gender", "definition" and "examples".
- word: the French word or expression for the English meaning. Nouns take their article (une intrigue), verbs are infinitive, pronominal verbs keep "se" (se méfier).
- gender: "masculine" or "feminine" for a noun, matching its article; "none" for anything else.
- definition: one short line of simple French. Never use the word itself.
- examples: a list of 3 natural French sentences of 6 to 15 words, each using the word in a different situation. Vary the form when it is natural (conjugation, plural, elided article). In each sentence put the word, exactly as it appears there, inside one pair of {braces}. Use no other braces.
When a French word, gender, definition or examples are given, keep them unchanged and make the other fields agree with them. Write examples that differ from the given ones.
`;

/** Entries from the built-in library, so drafts match its style. */
const EXAMPLES: [string, string][] = [
  ["English meaning: however",
    `{"word":"pourtant","gender":"none","definition":"Malgré ce qui vient d'être dit.","examples":["Il pleut, {pourtant} elle sort.","Le film était long, {pourtant} personne ne s'est ennuyé.","Il avait tout préparé, et {pourtant} rien n'a marché."]}`],
  ["English meaning: a plot",
    `{"word":"une intrigue","gender":"feminine","definition":"Ensemble des événements d'une fiction.","examples":["Ce roman développe {une intrigue} complexe.","Les spectateurs ont deviné {l'intrigue} dès le début.","La série suit {une intrigue} pleine de rebondissements."]}`],
  ["English meaning: to be wary\nFrench word: se méfier",
    `{"word":"se méfier","gender":"none","definition":"Ne pas accorder facilement sa confiance.","examples":["Il faut {se méfier} des offres trop belles.","Elle {se méfie} toujours des inconnus.","Ils {se sont méfiés} de cette rumeur."]}`],
];
