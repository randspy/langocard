import { alternativesOf, answerOf, nounOf } from "./entryRules";
import type { Rating } from "./fsrs";

/**
 * Checks a typed gap-fill answer (Production, Listening) against the answer its sentence
 * expects, and suggests a rating the learner can change. Mirrors Android's `TypedAnswer`;
 * `content/typed-answer-fixtures.json` holds cases both must pass. Self-contained, so the web
 * app can import it.
 */

export type AnswerMatch = "Exact" | "Accents" | "Article" | "Alternative" | "Different";

export const MATCH_RATING: Record<AnswerMatch, Rating> = {
  /** The same answer, ignoring case, surrounding whitespace and the apostrophe style. */
  Exact: "GOOD",
  /** The same letters with missing, wrong or extra accents, or "oe" for "œ". */
  Accents: "HARD",
  /** The right noun with another article or none: the Gender card schedules the article. */
  Article: "HARD",
  /** Another word the sentence accepts: valid French, but not recall of this card's word. */
  Alternative: "HARD",
  Different: "AGAIN",
};

export const MATCH_LABEL: Record<AnswerMatch, string> = {
  Exact: "✓ Right",
  Accents: "Check the accents",
  Article: "Right word, wrong article",
  Alternative: "✓ Also correct",
  Different: "✗ Not this time",
};

/** A run of one answer's characters, `marked` when the other answer lacks them. */
export type AnswerPart = { text: string; marked: boolean };

export type TypedAnswer = {
  typed: string;
  /** The word this card trains. */
  target: string;
  match: AnswerMatch;
  /** The answer `typed` is compared with: the alternative it matched, otherwise the target. */
  expected: string;
  typedParts: AnswerPart[];
  expectedParts: AnswerPart[];
};

const spaced = (s: string) => s.trim().normalize("NFC");
/** One character per character, so indices still line up with the shown text. */
const keyed = (s: string) => Array.from({ length: s.length }, (_, i) => {
  const c = s[i];
  return c === "’" ? "'" : c.toLowerCase()[0];
}).join("");
const folded = (s: string) => keyed(s).normalize("NFD").replace(/\p{Mn}+/gu, "").replace(/œ/g, "oe").replace(/æ/g, "ae");
const articleOf = (s: string) => {
  const noun = nounOf(s);
  return keyed((s.endsWith(noun) ? s.slice(0, s.length - noun.length) : s).trim());
};

/**
 * The check of `typed` against `example`'s answer, also accepting its alternatives when
 * `alternatives` is set (Production), or null when nothing was typed.
 */
export function typedAnswer(typedText: string, example: string, noun: boolean, alternatives: boolean): TypedAnswer | null {
  if (!typedText.trim()) return null;
  const typed = spaced(typedText);
  const target = spaced(answerOf(example));
  const alternative = (alternatives ? alternativesOf(example) : []).map(spaced).find((a) => folded(a) === folded(typed));
  const match: AnswerMatch =
    keyed(typed) === keyed(target) ? "Exact"
      : folded(typed) === folded(target) ? "Accents"
        : noun && articleOf(typed) !== articleOf(target) && folded(nounOf(typed)) === folded(nounOf(target)) ? "Article"
          : alternative !== undefined ? "Alternative"
            : "Different";
  const expected = match === "Alternative" ? alternative! : target;
  const [typedParts, expectedParts] = difference(typed, expected);
  return { typed, target, match, expected, typedParts, expectedParts };
}

/** Both answers split into runs, marking the characters the other lacks (longest common subsequence). */
function difference(typed: string, expected: string): [AnswerPart[], AnswerPart[]] {
  const a = keyed(typed);
  const b = keyed(expected);
  const common = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      common[i][j] = a[i] === b[j] ? common[i + 1][j + 1] + 1 : Math.max(common[i + 1][j], common[i][j + 1]);
    }
  }
  const typedMarks = new Array<boolean>(a.length).fill(true);
  const expectedMarks = new Array<boolean>(b.length).fill(true);
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      typedMarks[i] = false;
      expectedMarks[j] = false;
      i++;
      j++;
    } else if (common[i + 1][j] >= common[i][j + 1]) i++;
    else j++;
  }
  return [runs(typed, typedMarks), runs(expected, expectedMarks)];
}

function runs(text: string, marks: boolean[]): AnswerPart[] {
  const parts: AnswerPart[] = [];
  for (let k = 0; k < text.length; k++) {
    const last = parts[parts.length - 1];
    if (last && last.marked === marks[k]) last.text += text[k];
    else parts.push({ text: text[k], marked: marks[k] });
  }
  return parts;
}
