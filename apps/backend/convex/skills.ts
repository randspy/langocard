import type { Gender } from "./entryRules";

/**
 * The skills each entry is studied in. Gender (choosing un or une) applies only to
 * nouns. Kept free of server imports so the web app can import it at runtime.
 */
export const SKILLS = ["Reading", "Listening", "Production", "Gender"] as const;
export type Skill = (typeof SKILLS)[number];

/** The skills an entry has cards for: every skill for a noun, all but Gender otherwise. */
export function skillsOf(entry: { gender: Gender | null }): readonly Skill[] {
  return entry.gender === null ? SKILLS.filter((skill) => skill !== "Gender") : SKILLS;
}
