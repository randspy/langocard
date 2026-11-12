/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import schema from "../convex/schema";

export const modules = import.meta.glob("../convex/**/*.*s");
export const OWNER_GITHUB_ID = "4242";

export function setup() {
  return convexTest(schema, modules);
}
export type T = ReturnType<typeof setup>;

/** Creates a GitHub-backed user and returns a client signed in as them. */
export async function signIn(t: T, githubId: string) {
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { name: `user ${githubId}` });
    await ctx.db.insert("authAccounts", { userId: id, provider: "github", providerAccountId: githubId });
    return id;
  });
  return t.withIdentity({ subject: `${userId}|session-${githubId}` });
}

export const shipped = (o: Record<string, unknown> = {}) => ({
  entryId: "frw-1", origin: "bundled", word: "avoir", english: "have", definition: "Posséder.", example: "{Avoir} de la force.",
  topic: "daily", lemma: "avoir", rank: 6 as number | null, sourceUrl: "https://fr.wiktionary.org/wiki/avoir#fr", license: "CC BY-SA 4.0", ...o,
});
