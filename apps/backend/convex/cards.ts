import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { requireToken } from "./access";
import { parseCard, parseReviewLog } from "./cardState";
import { contentOf } from "./entryRules";
import { SKILLS, skillsOf, type Skill } from "./skills";
import { SUSPENDED_INDEFINITELY, resetCard } from "./merge";

/**
 * Web app card management. Suspensions and resets advance a card's `cardEditedAt`
 * clock (a reset also its review clock), so they win over older device copies and
 * reach Android on its next sync. Review history is never changed.
 */

const skillArg = v.optional(v.union(...SKILLS.map((s) => v.literal(s))));
const HISTORY = 100;

export const forEntry = query({
  args: { token: v.string(), entryId: v.string() },
  handler: async (ctx, { token, entryId }) => {
    requireToken(token);
    const entry = await ctx.db.query("entries").withIndex("by_entry", (q) => q.eq("entryId", entryId)).unique();
    const skills = entry ? skillsOf(contentOf(entry)) : SKILLS;
    return Promise.all(skills.map(async (skill) => {
      const key = `${entryId}:${skill}`;
      const row = await ctx.db.query("cards").withIndex("by_key", (q) => q.eq("key", key)).unique();
      const reviews = (await ctx.db.query("reviews").withIndex("by_key", (q) => q.eq("key", key)).order("desc").take(HISTORY))
        .flatMap((r) => {
          const log = parseReviewLog(r.log);
          return log ? [{ ...log, placement: r.placement }] : [];
        })
        .sort((a, b) => b.at - a.at);
      return {
        skill,
        card: row ? parseCard(row.card) : null,
        failures: row?.failures ?? 0,
        pausedUntil: row?.pausedUntil ?? 0,
        suspendedUntil: row?.suspendedUntil ?? 0,
        reviews,
      };
    }));
  },
});

async function cardRows(ctx: MutationCtx, entryId: string, skill: Skill | undefined) {
  const entry = await ctx.db.query("entries").withIndex("by_entry", (q) => q.eq("entryId", entryId)).unique();
  if (!entry) throw new ConvexError("Entry not found");
  return Promise.all((skill ? [skill] : skillsOf(contentOf(entry))).map(async (s) => {
    const key = `${entryId}:${s}`;
    return { key, row: await ctx.db.query("cards").withIndex("by_key", (q) => q.eq("key", key)).unique() };
  }));
}

async function setSuspension(ctx: MutationCtx, entryId: string, skill: Skill | undefined, suspendedUntil: number) {
  const now = Date.now();
  for (const { key, row } of await cardRows(ctx, entryId, skill)) {
    if (!row) {
      if (suspendedUntil === 0) continue;
      // A never-studied card: record only the manual fields. Its review clock stays at 0,
      // so it never overrides a device's first review.
      await ctx.db.insert("cards", {
        key, card: null, lastReview: 0, failures: 0, pausedUntil: 0, suspendedUntil, cardEditedAt: now, updatedAt: now,
      });
    } else if (row.suspendedUntil !== suspendedUntil) {
      await ctx.db.patch(row._id, { suspendedUntil, cardEditedAt: Math.max(now, row.cardEditedAt + 1), updatedAt: now });
    }
  }
}

export const suspend = mutation({
  args: { token: v.string(), entryId: v.string(), skill: skillArg, until: v.union(v.number(), v.null()) },
  handler: async (ctx, { token, entryId, skill, until }) => {
    requireToken(token);
    if (until !== null && until <= Date.now()) throw new ConvexError("Choose a date in the future");
    await setSuspension(ctx, entryId, skill, until ?? SUSPENDED_INDEFINITELY);
  },
});

export const resume = mutation({
  args: { token: v.string(), entryId: v.string(), skill: skillArg },
  handler: async (ctx, { token, entryId, skill }) => {
    requireToken(token);
    await setSuspension(ctx, entryId, skill, 0);
  },
});

export const reset = mutation({
  args: { token: v.string(), entryId: v.string(), skill: skillArg },
  handler: async (ctx, { token, entryId, skill }) => {
    requireToken(token);
    for (const { row } of await cardRows(ctx, entryId, skill)) {
      if (!row || (row.card === null && row.failures === 0 && row.pausedUntil === 0)) continue; // already new
      const now = Math.max(Date.now(), row.lastReview + 1, row.cardEditedAt + 1);
      // Keep any suspension: a reset is about memory state, not about whether to study.
      await ctx.db.patch(row._id, { ...resetCard(now), suspendedUntil: row.suspendedUntil, updatedAt: Date.now() });
    }
  },
});
