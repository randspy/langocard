/**
 * The skills each entry is studied in. Kept free of server imports so the web app can
 * import it at runtime.
 */
export const SKILLS = ["Reading", "Listening", "Production"] as const;
export type Skill = (typeof SKILLS)[number];
