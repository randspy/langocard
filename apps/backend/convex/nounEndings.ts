import { nounOf, type Gender } from "./entryRules";

/**
 * Noun-ending cues shown after a Gender card, mirroring Android's `NounEndings`. They teach a
 * tendency and never override a noun's recorded gender. `content/noun-ending-fixtures.json`
 * holds cases both must pass. Self-contained, so the web app can import it.
 */
export type EndingRule = { ending: string; gender: Gender };

export const ENDING_RULES: readonly EndingRule[] = [
  { ending: "ation", gender: "feminine" }, { ending: "tion", gender: "feminine" },
  { ending: "sion", gender: "feminine" }, { ending: "ence", gender: "feminine" },
  { ending: "ance", gender: "feminine" }, { ending: "ette", gender: "feminine" },
  { ending: "ité", gender: "feminine" }, { ending: "age", gender: "masculine" },
  { ending: "ment", gender: "masculine" }, { ending: "isme", gender: "masculine" },
  { ending: "eau", gender: "masculine" },
];

export type EndingMatch = { rule: EndingRule; follows: boolean; feedback: string };

/** The most specific cue for a single noun, or null without a gender or a reliable ending. */
export function endingMatch(word: string, gender: Gender | null): EndingMatch | null {
  if (gender === null) return null;
  const noun = nounOf(word).normalize("NFC").toLowerCase();
  if (/[\s-]/.test(noun)) return null;
  const rule = ENDING_RULES.filter((r) => noun.endsWith(r.ending)).sort((a, b) => b.ending.length - a.ending.length)[0];
  if (!rule) return null;
  const follows = gender === rule.gender;
  return {
    rule, follows,
    feedback: `-${rule.ending}: usually ${rule.gender}. ${follows ? "This noun follows the rule." : "This noun is an exception."}`,
  };
}
