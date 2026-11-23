import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireToken } from "./access";
import { contentOf, exampleAt, TOPICS, type EntryContent } from "./entryRules";
import { cardFromJson, cardToJson, instantString, logToJson, newCard, RATINGS, Scheduler, type Rating } from "./fsrs";
import { withStudyProgress } from "./studyProgress";
import { entryIdOf } from "./studyIndex";
import { skillsOf } from "./skills";
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

/** Android's defaults for preferences a settings row lacks or holds in a form Android rejects. */
const DEFAULT_MINIMUM_RANK = 2501;
const DEFAULT_INTERESTS = "daily,culture,news";
const MINIMUM_RANKS = [1, 2501, 7001];

/** The starting rank and topic interests, read as Android reads them ("daily,culture,news"). */
function preferences(settings: Doc<"settings"> | null) {
  const minimumRank = settings && MINIMUM_RANKS.includes(settings.minimumRank) ? settings.minimumRank : DEFAULT_MINIMUM_RANK;
  const interests = (settings?.interests ?? DEFAULT_INTERESTS).split(",").filter((t) => (TOPICS as readonly string[]).includes(t));
  return { minimumRank, interests };
}

/** Fields that bring a settings row's preferences back to values Android accepts, keeping its counters. */
function repairedPreferences(settings: Doc<"settings">) {
  const repair: { minimumRank?: number; interests?: string } = {};
  if (!MINIMUM_RANKS.includes(settings.minimumRank)) repair.minimumRank = DEFAULT_MINIMUM_RANK;
  if (!settings.interests || settings.interests.split(",").some((t) => !(TOPICS as readonly string[]).includes(t))) repair.interests = DEFAULT_INTERESTS;
  return repair;
}

/** A settings row for a learner who has none yet, with Android's defaults. */
const newSettings = (day: string) => ({
  placementDone: false, placementIndex: 0, nextCardId: 0, minimumRank: DEFAULT_MINIMUM_RANK,
  interests: DEFAULT_INTERESTS, preferencesChangedAt: 0, day, seconds: 0, introduced: 0, genderIntroduced: 0,
});

/** Origins the learner studies: built-in, and every pack installed on some device (pack source IDs are pack IDs). */
async function rankedOrigins(ctx: QueryCtx): Promise<string[]> {
  const packs = (await ctx.db.query("sources").collect()).filter((s) => !s.sourceId.includes("|")).map((s) => `pack:${s.sourceId}`);
  return ["bundled", ...packs];
}

/** The lowest rank band at or after `band` holding an introducible entry of these origins, or null. */
async function nextBand(ctx: QueryCtx, origins: string[], band: number): Promise<number | null> {
  let lowest: number | null = null;
  for (const origin of origins) {
    const first = await ctx.db.query("entries")
      .withIndex("by_introducible_origin_band", (q) => q.eq("introducible", true).eq("origin", origin).gte("rankBand", band)).first();
    if (first?.rankBand !== undefined && (lowest === null || first.rankBand < lowest)) lowest = first.rankBand;
  }
  return lowest;
}

/** Whether the learner may study this card now; returns its entry if so. Cheap checks come first. */
async function studiable(ctx: QueryCtx, row: Pick<Doc<"cards">, "key" | "active" | "skill" | "pausedUntil" | "suspendedUntil" | "packId" | "entryId">, now: number, day: string, installed = new Map<string, boolean>()): Promise<Entry | null> {
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
  const entry = await ctx.db.query("entries").withIndex("by_entry", q => q.eq("entryId", entryId)).unique();
  if (entry?.progress) {
    if (await ctx.db.query("reviews").withIndex("by_exposureCounted", q => q.eq("exposureCounted", undefined)).first()) {
      throw new ConvexError("Run migrations:countExposures before studying");
    }
    return entry.progress.exposures;
  }
  let count = 0;
  for (const skill of SENTENCE_SKILLS) {
    count += (await ctx.db.query("reviews").withIndex("by_key", (q) => q.eq("key", `${entryId}:${skill}`)).collect()).length;
  }
  return count;
}

/** Indexed candidates for the Reading renderer; other skill UIs ship in their own issues. */
async function introduction(ctx: QueryCtx, day: string, now: number): Promise<{ entry: Entry; row: Doc<"cards"> | null } | null> {
  const settings = await ctx.db.query("settings").first();
  const phase = practicePhase(settings?.day === day ? settings.seconds : 0);
  if (phase !== "practice") return null;
  if (await ctx.db.query("entries").withIndex("by_started", q => q.eq("started", undefined)).first()) {
    throw new ConvexError("Run migrations:deriveEntryProgress before introducing cards");
  }
  let walked = 0;
  const candidate = async (entry: Entry) => {
    if (++walked > 1000) throw new ConvexError("Too many blocked introductions; try again later");
    const key = `${entry.entryId}:Reading`;
    const row = await ctx.db.query("cards").withIndex("by_key", q => q.eq("key", key)).unique();
    if (row?.card) return null;
    const eligible = await studiable(ctx, row ?? { key, active: !isDeleted(entry), skill: "Reading", pausedUntil: 0,
      suspendedUntil: 0, packId: entry.origin.startsWith("pack:") ? entry.origin.slice(5) : null, entryId: entry.entryId }, now, day);
    return eligible ? { entry, row } : null;
  };
  for await (const entry of ctx.db.query("entries").withIndex("by_missingReading", q => q.eq("missingReading", true))) {
    const choice = await candidate(entry);
    if (choice) return choice;
  }
  if (settings?.day === day && settings.introduced >= 5) return null;
  const { minimumRank: minimum, interests } = preferences(settings);
  for await (const entry of ctx.db.query("entries").withIndex("by_introducible_origin", q => q.eq("introducible", true).eq("origin", "personal"))) {
    if ((entry.studyRank ?? 0) < minimum) continue;
    const choice = await candidate(entry);
    if (choice) return choice;
  }
  // Only built-in and installed packs: entries of packs no device installed stay dormant.
  const origins = await rankedOrigins(ctx);
  let band = Math.floor(Math.min(minimum, 1_000_000) / 100);
  while (band <= 10000) {
    const found = await nextBand(ctx, origins, band);
    if (found === null) return null;
    band = found;
    const entries: Entry[] = [];
    for (const origin of origins) {
      entries.push(...await ctx.db.query("entries")
        .withIndex("by_introducible_origin_band", q => q.eq("introducible", true).eq("origin", origin).eq("rankBand", band)).take(1001));
    }
    if (entries.length > 1000) throw new ConvexError("Too many meanings in one rank band");
    entries.sort((a, b) => Number(interests.includes(b.topic)) - Number(interests.includes(a.topic)) || (a.studyOrder ?? a.entryId).localeCompare(b.studyOrder ?? b.entryId));
    for (const entry of entries) {
      if (entry.origin === "personal" || (entry.studyRank ?? 0) < minimum) continue;
      const choice = await candidate(entry);
      if (choice) return choice;
    }
    band++;
  }
  return null;
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
      await ctx.db.patch(settings._id, { ...counters, ...repairedPreferences(settings), updatedAt });
    } else {
      await ctx.db.insert("settings", { ...newSettings(day), seconds, updatedAt });
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
    if (phase === "practice") {
      const choice = await introduction(ctx, day, now);
      if (choice) {
        const { entry, row } = choice;
        const content = contentOf(entry);
        return { key: `${entry.entryId}:Reading`, skill: "Reading" as const, version: row?.lastReview ?? null,
          card: row?.card ?? null, entryId: entry.entryId, entry: content,
          example: exampleAt(content.examples, await exposures(ctx, entry.entryId)) };
      }
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
async function allocateCardId(ctx: MutationCtx, day: string): Promise<number> {
  const settings = await ctx.db.query("settings").first();
  const id = settings?.nextCardId ?? 0;
  if (settings) await ctx.db.patch(settings._id, { nextCardId: id + 1, ...repairedPreferences(settings), updatedAt: Date.now() });
  else await ctx.db.insert("settings", { ...newSettings(day), nextCardId: id + 1, updatedAt: Date.now() });
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
    version: v.union(v.number(), v.null()),
    rating: v.union(...RATINGS.map((r) => v.literal(r))),
    example: v.string(),
    ...clock,
  },
  handler: async (ctx, { token, key, version, rating, example, day, now }) => {
    requireToken(token);
    if (example.length > 2000) throw new ConvexError("Invalid example");
    const row = await ctx.db.query("cards").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if ((row?.lastReview ?? null) !== version) return { status: "stale" as const };
    const entry = await ctx.db.query("entries").withIndex("by_entry", q => q.eq("entryId", entryIdOf(key))).unique();
    if (!entry || !key.endsWith(":Reading")) return { status: "stale" as const };
    if (!await studiable(ctx, row ?? { key, active: !isDeleted(entry), skill: "Reading", pausedUntil: 0, suspendedUntil: 0,
      packId: entry.origin.startsWith("pack:") ? entry.origin.slice(5) : null, entryId: entry.entryId }, now, day)) return { status: "stale" as const };
    const wasNewMeaning = !row?.card && !entry.started;
    const settings = await ctx.db.query("settings").first();
    if (wasNewMeaning && (entry.retired || (entry.studyRank ?? entry.rank ?? 2_147_483_647) < preferences(settings).minimumRank || (settings?.day === day && settings.introduced >= 5))) return { status: "stale" as const };
    // A review never goes back in time, even if this browser's clock is behind.
    const at = Math.max(now, (row?.lastReview ?? 0) + 1);
    const card = row?.card == null ? newCard(await allocateCardId(ctx, day), at) : cardFromJson(row.card);
    const result = new Scheduler().review(card, rating as Rating, at);
    const cardJson = cardToJson(result.card);
    const log = `${logToJson(result.log).slice(0, -1)},"example":${androidJson(example)}}`;
    await withStudyProgress(ctx, async (progress) => {
      progress.remember(entry);
      const fields = { card: cardJson, lastReview: at, failures: rating === "AGAIN" ? (row?.failures ?? 0) + 1 : 0, updatedAt: Date.now() };
      const canonical = row ? { ...row, ...fields } : {
        key, ...fields, pausedUntil: 0, suspendedUntil: 0, cardEditedAt: 0,
        _id: await ctx.db.insert("cards", { key, ...fields, pausedUntil: 0, suspendedUntil: 0, cardEditedAt: 0 }), _creationTime: Date.now(),
      };
      if (row) await ctx.db.patch(row._id, fields);
      await refreshCard(ctx, canonical._id);
      await progress.card(canonical);
      const reviewId = `${key}@${instantString(at)}`;
      if (!await ctx.db.query("reviews").withIndex("by_review", q => q.eq("reviewId", reviewId)).unique()) {
        await ctx.db.insert("reviews", { reviewId, key, placement: false, log, updatedAt: Date.now(), exposureCounted: true });
        await progress.review(key);
      }
    });
    if (wasNewMeaning) {
      const current = (await ctx.db.query("settings").first())!;
      if (current.day <= day) await ctx.db.patch(current._id, { day,
        introduced: (current.day === day ? current.introduced : 0) + 1,
        seconds: current.day === day ? current.seconds : 0,
        genderIntroduced: current.day === day ? current.genderIntroduced ?? 0 : 0, updatedAt: Date.now() });
    }
    for await (const related of ctx.db.query("entries").withIndex("by_lexeme", q => q.eq("lexeme", entry.lexeme))) {
      if (isDeleted(related)) continue;
      if (related.origin.startsWith("pack:") && !await ctx.db.query("sources").withIndex("by_source", q => q.eq("sourceId", related.origin.slice(5))).first()) continue;
      for (const skill of skillsOf(contentOf(related))) {
        const sibling = `${related.entryId}:${skill}`;
        if (sibling === key) continue;
        const buried = await ctx.db.query("buried").withIndex("by_key", q => q.eq("key", sibling)).unique();
        if (!buried) await ctx.db.insert("buried", { key: sibling, day, updatedAt: Date.now() });
        else if (buried.day < day) await ctx.db.patch(buried._id, { day, updatedAt: Date.now() });
      }
    }
    return { status: "ok" as const, card: cardJson };
  },
});

/** The next action for a fresh daily sitting, restricted to skills the web can present. */
export const offer = query({
  args: { token: v.string(), ...clock },
  handler: async (ctx, { token, day, now }) => {
    requireToken(token);
    if (await dailySeconds(ctx, day) >= 900) return "nothingLeft" as const;
    for await (const _ of dueCards(ctx, now, day)) return "practice" as const;
    if (await introduction(ctx, day, now)) return "practice" as const;
    // Unstarted meanings the learner could study later (as on Android, dormant packs don't count).
    const { minimumRank } = preferences(await ctx.db.query("settings").first());
    for (const origin of ["personal", ...await rankedOrigins(ctx)]) {
      const later = await ctx.db.query("entries").withIndex("by_introducible_origin_band", q => q.eq("introducible", true).eq("origin", origin)
        .gte("rankBand", Math.floor(Math.min(minimumRank, 1_000_000) / 100))).take(200);
      if (later.some((e) => (e.studyRank ?? 0) >= minimumRank)) return "nothingLeft" as const;
    }
    if (await ctx.db.query("entries").withIndex("by_missingReading", q => q.eq("missingReading", true)).first()) return "nothingLeft" as const;
    if (await ctx.db.query("cards").withIndex("by_active_skill_due", q => q.eq("active", true).eq("skill", "Reading").gte("due", 0).lte("due", now)).first()) return "nothingLeft" as const;
    return "moreVocabulary" as const;
  },
});
