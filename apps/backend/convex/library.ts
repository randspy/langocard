import { query } from "./_generated/server";
import { parseCard } from "./cardState";
import { contentOf, sameContent } from "./entryRules";
import { isDeleted } from "./merge";
import { requireOwner } from "./owner";

export const SKILLS = ["Reading", "Listening", "Production"] as const;
export type Skill = (typeof SKILLS)[number];

/** One skill's schedule as the Library shows it. `due: null` means new (never studied, or reset). */
export type SkillSummary = { due: number | null; state: string | null; pausedUntil: number; suspendedUntil: number };

/**
 * The whole library with each entry's per-skill schedule, for the web Library page.
 * The library is bounded (a few thousand entries), so it is returned in one piece and
 * filtered on the client. Time-dependent status (due, suspended) is decided there too,
 * because queries can't read the clock.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    const skills = new Map<string, Partial<Record<Skill, SkillSummary>>>();
    for (const row of await ctx.db.query("cards").collect()) {
      const [entryId, skill] = row.key.split(":") as [string, Skill];
      if (!SKILLS.includes(skill)) continue;
      const card = parseCard(row.card);
      const forEntry = skills.get(entryId) ?? {};
      forEntry[skill] = { due: card?.due ?? null, state: card?.state ?? null, pausedUntil: row.pausedUntil, suspendedUntil: row.suspendedUntil };
      skills.set(entryId, forEntry);
    }
    const installedPacks = new Set<string>();
    for (const row of await ctx.db.query("sources").collect()) {
      try {
        const packId = (JSON.parse(row.source) as { packId?: unknown }).packId;
        if (typeof packId === "string" && packId) installedPacks.add(packId);
      } catch {
        // Unreadable attribution doesn't block the library.
      }
    }
    const entries = (await ctx.db.query("entries").collect()).map((e) => ({
      entryId: e.entryId,
      word: e.word,
      english: e.english,
      lemma: e.lemma,
      topic: e.topic,
      rank: e.rank,
      origin: e.origin,
      installed: !e.origin.startsWith("pack:") || installedPacks.has(e.origin.slice("pack:".length)),
      edited: e.shipped !== null && !sameContent(contentOf(e), e.shipped),
      deleted: isDeleted(e),
      upstreamChanged: e.upstreamChanged,
      retired: e.retired,
      skills: skills.get(e.entryId) ?? {},
    }));
    return { entries };
  },
});
