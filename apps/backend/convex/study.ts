import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireToken } from "./access";
import { contentOf, exampleAt, type EntryContent } from "./entryRules";
import { cardFromJson, cardToJson, instantString, logToJson, newCard, RATINGS, Scheduler, type Rating } from "./fsrs";
import { isDeleted } from "./merge";
import { refreshCard } from "./studyIndex";

/**
 * Practising on the web: the study rules as Convex functions, held to Android's `StudyRules`.
 * See `docs/design/web-practice.md`. The web fetches the next card imperatively, answers it,
 * and fetches again; the client passes its clock.
 */

/** Blocked due cards a single call may step over before giving up loudly. */
const WALK_BUDGET = 2000;
/** The home summary counts due cards up to this many. */
export const DUE_DISPLAY_CAP = 100;
/** Answers that rotate an entry's examples: every sentence-bearing skill, placement included. */
const SENTENCE_SKILLS = ["Reading", "Listening", "Production"] as const;

type Entry = Doc<"entries">;

/** Whether the learner may study this card now; returns its entry if so. */
async function studiable(ctx: QueryCtx, row: Doc<"cards">, now: number, day: string, installed = new Map<string, boolean>()): Promise<Entry | null> {
  if (!row.active || row.skill !== "Reading") return null;
  if (row.pausedUntil > now || row.suspendedUntil > now) return null;
  const buried = await ctx.db.query("buried").withIndex("by_key", (q) => q.eq("key", row.key)).unique();
  if (buried?.day === day) return null;
  const entry = await ctx.db.query("entries").withIndex("by_entry", (q) => q.eq("entryId", row.entryId!)).unique();
  if (!entry || isDeleted(entry)) return null;
  if (entry.origin.startsWith("pack:")) {
    // Android studies only installed packs; installing one on any device installs it everywhere.
    const packId = entry.origin.slice("pack:".length);
    if (!installed.has(packId)) {
      installed.set(packId, (await ctx.db.query("sources").withIndex("by_source", (q) => q.eq("sourceId", packId)).first()) !== null);
    }
    if (!installed.get(packId)) return null;
  }
  return entry;
}

/**
 * Due cards the learner may study now, soonest first. Inactive cards (deleted entries,
 * indefinite suspensions) are outside the index range; the rest of `studiable` steps over
 * the few that are blocked, under `WALK_BUDGET`.
 */
async function* dueCards(ctx: QueryCtx, now: number, day: string): AsyncGenerator<{ row: Doc<"cards">; entry: Entry }> {
  const installed = new Map<string, boolean>();
  let walked = 0;
  const range = ctx.db.query("cards").withIndex("by_active_due", (q) => q.eq("active", true).gte("due", 0).lte("due", now));
  for await (const row of range) {
    if (++walked > WALK_BUDGET) throw new ConvexError("Too many blocked due cards to choose from; try again later");
    const entry = await studiable(ctx, row, now, day, installed);
    if (entry) yield { row, entry };
  }
}

/** Sentence-bearing answers to this entry, placement included: how far its examples have rotated. */
async function exposures(ctx: QueryCtx, entryId: string): Promise<number> {
  let count = 0;
  for (const skill of SENTENCE_SKILLS) {
    count += (await ctx.db.query("reviews").withIndex("by_key", (q) => q.eq("key", `${entryId}:${skill}`)).collect()).length;
  }
  return count;
}

const clock = { day: v.string(), now: v.number() };

/** The card to study next, or null when nothing is due. */
export const next = query({
  args: { token: v.string(), ...clock },
  handler: async (ctx, { token, day, now }) => {
    requireToken(token);
    for await (const { row, entry } of dueCards(ctx, now, day)) {
      const content: EntryContent = contentOf(entry);
      return {
        key: row.key,
        skill: row.skill as "Reading",
        /** The card's review clock; `answer` refuses a card that changed since. */
        version: row.lastReview,
        card: row.card,
        entryId: entry.entryId,
        entry: content,
        example: exampleAt(content.examples, await exposures(ctx, entry.entryId)),
      };
    }
    return null;
  },
});

/** Due cards waiting now, counted up to `DUE_DISPLAY_CAP`. */
export const summary = query({
  args: { token: v.string(), ...clock },
  handler: async (ctx, { token, day, now }) => {
    requireToken(token);
    let due = 0;
    for await (const _ of dueCards(ctx, now, day)) if (++due >= DUE_DISPLAY_CAP) break;
    return { due, dueCapped: due >= DUE_DISPLAY_CAP };
  },
});

/** A JSON string as Android's `org.json` writes it, which escapes "/". */
const androidJson = (value: string) => JSON.stringify(value).replace(/\//g, "\\/");

/** The next FSRS card ID from the synced settings, advancing them. */
async function allocateCardId(ctx: MutationCtx): Promise<number> {
  const settings = await ctx.db.query("settings").first();
  const id = settings?.nextCardId ?? 0;
  if (settings) await ctx.db.patch(settings._id, { nextCardId: id + 1, updatedAt: Date.now() });
  return id;
}

/**
 * Answers the card `next` returned. Reschedules it with FSRS, saves its review fields (synced
 * to phones like a phone's review) and appends the review with Android's ID and log format.
 * Returns `stale` without writing when the card changed since (a phone review synced in
 * between) or may no longer be studied; the page then fetches the next card again.
 */
export const answer = mutation({
  args: {
    token: v.string(),
    key: v.string(),
    version: v.number(),
    rating: v.union(...RATINGS.map((r) => v.literal(r))),
    example: v.string(),
    ...clock,
  },
  handler: async (ctx, { token, key, version, rating, example, day, now }) => {
    requireToken(token);
    if (example.length > 2000) throw new ConvexError("Invalid example");
    const row = await ctx.db.query("cards").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if (!row || row.lastReview !== version) return { status: "stale" as const };
    if (!await studiable(ctx, row, now, day)) return { status: "stale" as const };
    // A review never goes back in time, even if this browser's clock is behind.
    const at = Math.max(now, row.lastReview + 1);
    const card = row.card === null ? newCard(await allocateCardId(ctx), at) : cardFromJson(row.card);
    const result = new Scheduler().review(card, rating as Rating, at);
    const cardJson = cardToJson(result.card);
    const log = `${logToJson(result.log).slice(0, -1)},"example":${androidJson(example)}}`;
    await ctx.db.patch(row._id, {
      card: cardJson, lastReview: at, failures: rating === "AGAIN" ? row.failures + 1 : 0, updatedAt: Date.now(),
    });
    await refreshCard(ctx, row._id);
    const reviewId = `${key}@${instantString(at)}`;
    if (!await ctx.db.query("reviews").withIndex("by_review", (q) => q.eq("reviewId", reviewId)).unique()) {
      await ctx.db.insert("reviews", { reviewId, key, placement: false, log, updatedAt: Date.now() });
    }
    return { status: "ok" as const, card: cardJson };
  },
});
