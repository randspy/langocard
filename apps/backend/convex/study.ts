import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireToken } from "./access";
import { contentOf, exampleAt, type EntryContent } from "./entryRules";
import { cardFromJson, cardToJson, instantString, logToJson, newCard, RATINGS, Scheduler, type Rating } from "./fsrs";
import { isDeleted } from "./merge";
import { practicePhase } from "./studyPolicy";
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

/** Whether the learner may study this card now; returns its entry if so. Cheap checks come first. */
async function studiable(ctx: QueryCtx, row: Doc<"cards">, now: number, day: string, installed = new Map<string, boolean>()): Promise<Entry | null> {
  if (!row.active || row.skill !== "Reading") return null;
  if (row.pausedUntil > now || row.suspendedUntil > now) return null;
  if (row.packId) {
    // Android studies only installed packs; installing one on any device installs it everywhere.
    if (!installed.has(row.packId)) {
      installed.set(row.packId, (await ctx.db.query("sources").withIndex("by_source", (q) => q.eq("sourceId", row.packId!)).first()) !== null);
    }
    if (!installed.get(row.packId)) return null;
  }
  const buried = await ctx.db.query("buried").withIndex("by_key", (q) => q.eq("key", row.key)).unique();
  if (buried?.day === day) return null;
  const entry = await ctx.db.query("entries").withIndex("by_entry", (q) => q.eq("entryId", row.entryId!)).unique();
  return entry && !isDeleted(entry) ? entry : null;
}

/**
 * Due Reading cards the learner may study now, soonest first. Inactive cards (deleted entries,
 * indefinite suspensions) and other skills are outside the index range; `studiable` steps
 * over the few that are blocked. Past `WALK_BUDGET` cards it throws, or with `stopAtBudget`
 * simply ends.
 */
async function* dueCards(ctx: QueryCtx, now: number, day: string, stopAtBudget = false): AsyncGenerator<{ row: Doc<"cards">; entry: Entry }> {
  const installed = new Map<string, boolean>();
  let walked = 0;
  const range = ctx.db.query("cards")
    .withIndex("by_active_skill_due", (q) => q.eq("active", true).eq("skill", "Reading").gte("due", 0).lte("due", now));
  for await (const row of range) {
    if (++walked > WALK_BUDGET) {
      if (stopAtBudget) return;
      throw new ConvexError("Too many blocked due cards to choose from; try again later");
    }
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

/** Daily counters use the browser's local day, exactly as phone sync does. */
async function dailySeconds(ctx: QueryCtx, day: string) {
  const settings = await ctx.db.query("settings").first();
  return settings?.day === day ? settings.seconds : 0;
}

/** Checkpoints foreground seconds into the settings row that Android already syncs. */
export const tick = mutation({
  args: { token: v.string(), day: v.string(), seconds: v.number() },
  handler: async (ctx, { token, day, seconds }) => {
    requireToken(token);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isSafeInteger(seconds) || seconds < 0 || seconds > 86400) {
      throw new ConvexError("Invalid practice time");
    }
    const settings = await ctx.db.query("settings").first();
    if (settings && settings.day > day) return;
    const updatedAt = Date.now();
    if (settings) {
      const counters = settings.day === day
        ? { seconds: settings.seconds + seconds }
        : { day, seconds, introduced: 0, genderIntroduced: 0 };
      await ctx.db.patch(settings._id, { ...counters, updatedAt });
    } else {
      await ctx.db.insert("settings", {
        placementDone: false, placementIndex: 0, nextCardId: 0, minimumRank: 0,
        interests: "[]", preferencesChangedAt: 0, day, seconds, introduced: 0,
        genderIntroduced: 0, updatedAt,
      });
    }
  },
});

/** Today's synced time and the practice phase displayed by the browser. */
export const progress = query({
  args: { token: v.string(), day: v.string() },
  handler: async (ctx, { token, day }) => {
    requireToken(token);
    const seconds = await dailySeconds(ctx, day);
    return { seconds, phase: practicePhase(seconds) };
  },
});

/** The card to study next, or null when nothing is due. */
export const next = query({
  args: { token: v.string(), ...clock, pending: v.optional(v.array(v.string())) },
  handler: async (ctx, { token, day, now, pending = [] }) => {
    requireToken(token);
    if (pending.length > 1000) throw new ConvexError("Too many session cards");
    const phase = practicePhase(await dailySeconds(ctx, day));
    if (phase === "done") return null;
    const chosen = async (row: Doc<"cards">, entry: Entry) => {
      const content: EntryContent = contentOf(entry);
      return {
        key: row.key, skill: "Reading" as const, version: row.lastReview, card: row.card,
        entryId: entry.entryId, entry: content,
        example: exampleAt(content.examples, await exposures(ctx, entry.entryId)),
      };
    };
    if (phase !== "cleanup") for await (const { row, entry } of dueCards(ctx, now, day)) {
      return chosen(row, entry);
    }
    // A sitting's learning debt may return before FSRS's due time, in insertion order.
    for (const key of pending) {
      const row = await ctx.db.query("cards").withIndex("by_key", (q) => q.eq("key", key)).unique();
      if (!row || !row.card || row.fsrsState === "REVIEW") continue;
      const entry = await studiable(ctx, row, now, day);
      if (entry) return chosen(row, entry);
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
    // The count is for display; past the walk budget it reports what it found.
    for await (const _ of dueCards(ctx, now, day, true)) if (++due >= DUE_DISPLAY_CAP) break;
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
