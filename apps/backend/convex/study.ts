import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireToken } from "./access";
import { contentOf, exampleAt, TOPICS, type EntryContent } from "./entryRules";
import { cardFromJson, cardToJson, instantString, logToJson, newCard, RATINGS, type Rating } from "./fsrs";
import { parseFit, schedulerFor } from "./fittedSettings";
import { withStudyProgress } from "./studyProgress";
import { loggedExample, recordRecall, returning, returningExample } from "./stuckWords";
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
/** Skills the web can present so far, in Android's skill order (which breaks ties). */
export const WEB_SKILLS = ["Reading", "Listening", "Production", "Gender"] as const;
/** Skills a new meaning starts with; Gender comes later, as a sibling. */
const MEANING_SKILLS = ["Reading", "Listening", "Production"] as const;
/** Gender cards introduced per day in daily practice, as on Android. */
const NEW_GENDER_CARDS = 10;
export type WebSkill = (typeof WEB_SKILLS)[number];
const isWebSkill = (skill: string | undefined): skill is WebSkill => (WEB_SKILLS as readonly string[]).includes(skill ?? "");
/** Entry progress flags marking a started meaning without a card for a skill. */
const MISSING_INDEX = { Listening: "by_missingListening", Reading: "by_missingReading", Production: "by_missingProduction", Gender: "by_missingGender" } as const;

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

/** Whether a meaning belongs to the library the learner studies: not deleted, and not in a dormant pack. */
async function active(ctx: QueryCtx, entry: Entry, installed: Map<string, boolean>): Promise<boolean> {
  if (isDeleted(entry)) return false;
  if (!entry.origin.startsWith("pack:")) return true;
  const packId = entry.origin.slice("pack:".length);
  if (!installed.has(packId)) installed.set(packId, (await ctx.db.query("sources").withIndex("by_source", (q) => q.eq("sourceId", packId)).first()) !== null);
  return installed.get(packId)!;
}

/**
 * Whether this meaning studies its noun's Gender card. Of the active meanings sharing a noun
 * and gender, those that already have a Gender card keep it; otherwise the one introduced
 * first (the lowest card ID among started cards) owns it.
 */
async function genderOwner(ctx: QueryCtx, entry: Entry, installed: Map<string, boolean>): Promise<boolean> {
  if (!entry.nounKey) return false;
  const meanings: Entry[] = [];
  for (const m of await ctx.db.query("entries").withIndex("by_nounKey", (q) => q.eq("nounKey", entry.nounKey)).take(101)) {
    if (await active(ctx, m, installed)) meanings.push(m);
  }
  const studied = meanings.filter((m) => m.progress?.slots.Gender?.cardId != null);
  if (studied.length) return studied.some((m) => m.entryId === entry.entryId);
  const firstCard = (m: Entry) => Math.min(...Object.values(m.progress?.slots ?? {}).map((slot) => slot.cardId ?? Infinity));
  let owner: Entry | null = null;
  for (const m of meanings) if (firstCard(m) < Infinity && (!owner || firstCard(m) < firstCard(owner))) owner = m;
  return owner?.entryId === entry.entryId;
}

/** Whether the learner may study this card now; returns its entry if so. Cheap checks come first. */
async function studiable(ctx: QueryCtx, row: Pick<Doc<"cards">, "key" | "active" | "skill" | "pausedUntil" | "suspendedUntil" | "packId" | "entryId">, now: number, day: string, installed = new Map<string, boolean>()): Promise<Entry | null> {
  if (!row.active || !isWebSkill(row.skill)) return null;
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
  if (!entry || isDeleted(entry)) return null;
  // Only one meaning per noun studies its Gender card (Android's GenderCards.owners).
  if (row.skill === "Gender" && !await genderOwner(ctx, entry, installed)) return null;
  return entry;
}

/**
 * Due cards of one skill the learner may study now, soonest first. Inactive cards (deleted
 * entries, indefinite suspensions) and other skills are outside the index range; `studiable`
 * steps over the few that are blocked. Past `WALK_BUDGET` cards it throws, or with
 * `stopAtBudget` simply ends.
 */
async function* dueCards(ctx: QueryCtx, skill: WebSkill, now: number, day: string, stopAtBudget: boolean | (() => boolean) = false): AsyncGenerator<{ row: Doc<"cards">; entry: Entry }> {
  const installed = new Map<string, boolean>();
  let walked = 0;
  const range = ctx.db.query("cards")
    .withIndex("by_active_skill_due", (q) => q.eq("active", true).eq("skill", skill).gte("due", 0).lte("due", now));
  for await (const row of range) {
    if (++walked > WALK_BUDGET) {
      if (typeof stopAtBudget === "function" ? stopAtBudget() : stopAtBudget) return;
      throw new ConvexError("Too many blocked due cards to choose from; try again later");
    }
    const entry = await studiable(ctx, row, now, day, installed);
    if (entry) yield { row, entry };
  }
}

/**
 * The due card due soonest across the web's skills. Equal due times follow Android's prompt
 * order: meanings in study order, then skills in skill order.
 */
async function soonestDue(ctx: QueryCtx, now: number, day: string, audio = false): Promise<{ row: Doc<"cards">; entry: Entry } | null> {
  const rank = (c: { row: Doc<"cards">; entry: Entry }) =>
    [c.row.due!, c.entry.studyOrder ?? c.entry.entryId, WEB_SKILLS.indexOf(c.row.skill as WebSkill)] as const;
  const before = (a: ReturnType<typeof rank>, b: ReturnType<typeof rank>) =>
    a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2];
  let best: { row: Doc<"cards">; entry: Entry } | null = null;
  for (const skill of WEB_SKILLS.filter(s => audio || s !== "Listening")) {
    let first: number | null = null;
    // Once this skill's first card is found, running out of budget while looking for its ties
    // just ends the search; before that, an exhausted walk still fails loudly.
    for await (const due of dueCards(ctx, skill, now, day, () => first !== null)) {
      // Every card sharing this skill's earliest due time competes on study order.
      if (first !== null && due.row.due! > first) break;
      first = due.row.due!;
      if (!best || before(rank(due), rank(best))) best = due;
    }
  }
  return best;
}

/**
 * The example to show: rotated by exposures, or for a card back from a leech pause, one it
 * wasn't recently answered in (Android's `StudyRules.shown`).
 */
async function shownExample(ctx: QueryCtx, key: string, row: Doc<"cards"> | null, entry: Entry, now: number): Promise<string> {
  const { examples } = contentOf(entry);
  const count = await exposures(ctx, entry.entryId);
  const lastReview = row?.card ? cardFromJson(row.card).lastReview : null;
  if (!row || !returning(row.pausedUntil, lastReview, now)) return exampleAt(examples, count);
  const recent = (await ctx.db.query("reviews").withIndex("by_key_reviewedAt", (q) => q.eq("key", key)).order("desc").take(4))
    .reverse().map((r) => loggedExample(r.log)).filter(Boolean);
  return returningExample(examples, count, recent);
}

/** The entry's memory hook, shown on reveal for every skill; "" without one. */
async function hookText(ctx: QueryCtx, entryId: string): Promise<string> {
  return (await ctx.db.query("hooks").withIndex("by_entry", (q) => q.eq("entryId", entryId)).unique())?.text ?? "";
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

/** The next new card: a sibling skill of a started meaning, else a new meaning, for skills the web presents. */
async function introduction(ctx: QueryCtx, day: string, now: number, audio = false): Promise<{ entry: Entry; skill: WebSkill; row: Doc<"cards"> | null } | null> {
  const settings = await ctx.db.query("settings").first();
  const phase = practicePhase(settings?.day === day ? settings.seconds : 0);
  if (phase !== "practice") return null;
  if (await ctx.db.query("entries").withIndex("by_started", q => q.eq("started", undefined)).first()) {
    throw new ConvexError("Run migrations:deriveEntryProgress before introducing cards");
  }
  const meaningSkills = MEANING_SKILLS.filter(s => audio || s !== "Listening");
  let walked = 0;
  const candidate = async (entry: Entry, skills: readonly WebSkill[]) => {
    if (++walked > 1000) throw new ConvexError("Too many blocked introductions; try again later");
    // As on Android, a meaning offers its skills in skill order: the first one free to study.
    for (const skill of skills) {
      const key = `${entry.entryId}:${skill}`;
      const row = await ctx.db.query("cards").withIndex("by_key", q => q.eq("key", key)).unique();
      if (row?.card) continue;
      const eligible = await studiable(ctx, row ?? { key, active: !isDeleted(entry), skill, pausedUntil: 0,
        suspendedUntil: 0, packId: entry.origin.startsWith("pack:") ? entry.origin.slice(5) : null, entryId: entry.entryId }, now, day);
      if (eligible) return { entry, skill, row };
    }
    return null;
  };
  // Siblings: the first started meaning in study order with a free missing skill. Any other
  // sibling skill comes before a Gender card, which also needs room in today's Gender count.
  let sibling: { entry: Entry; skill: WebSkill; row: Doc<"cards"> | null } | null = null;
  for (const skill of meaningSkills) {
    for await (const entry of ctx.db.query("entries").withIndex(MISSING_INDEX[skill], q => q.eq(`missing${skill}`, true))) {
      if (sibling && (entry.studyOrder ?? entry.entryId) >= (sibling.entry.studyOrder ?? sibling.entry.entryId)) break;
      const choice = await candidate(entry, meaningSkills);
      if (choice) { sibling = choice; break; }
    }
  }
  if (sibling) return sibling;
  const gendersToday = settings?.day === day ? settings.genderIntroduced ?? 0 : 0;
  if (gendersToday < NEW_GENDER_CARDS) {
    for await (const entry of ctx.db.query("entries").withIndex("by_missingGender", q => q.eq("missingGender", true))) {
      const choice = await candidate(entry, ["Gender"]);
      if (choice) return choice;
    }
  }
  if (settings?.day === day && settings.introduced >= 5) return null;
  const { minimumRank: minimum, interests } = preferences(settings);
  for await (const entry of ctx.db.query("entries").withIndex("by_introducible_origin", q => q.eq("introducible", true).eq("origin", "personal"))) {
    if ((entry.studyRank ?? 0) < minimum) continue;
    const choice = await candidate(entry, meaningSkills);
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
      const choice = await candidate(entry, meaningSkills);
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
  args: { token: v.string(), ...clock, audio: v.optional(v.boolean()), pending: v.optional(v.array(v.string())) },
  handler: async (ctx, { token, day, now, audio = false, pending = [] }) => {
    requireToken(token);
    if (pending.length > 1000) throw new ConvexError("Too many session cards");
    const phase = practicePhase(await dailySeconds(ctx, day));
    if (phase === "done") return null;
    const chosen = async (row: Doc<"cards">, entry: Entry) => {
      const content: EntryContent = contentOf(entry);
      return {
        key: row.key, skill: row.skill as WebSkill, version: row.lastReview as number | null, card: row.card,
        entryId: entry.entryId, entry: content,
        example: await shownExample(ctx, row.key, row, entry, now), hook: await hookText(ctx, entry.entryId),
      };
    };
    if (phase !== "cleanup") {
      const due = await soonestDue(ctx, now, day, audio);
      if (due) return chosen(due.row, due.entry);
    }
    if (phase === "practice") {
      const choice = await introduction(ctx, day, now, audio);
      if (choice) {
        const { entry, skill, row } = choice;
        const content = contentOf(entry);
        return { key: `${entry.entryId}:${skill}`, skill, version: row?.lastReview ?? null,
          card: row?.card ?? null, entryId: entry.entryId, entry: content,
          example: await shownExample(ctx, `${entry.entryId}:${skill}`, row, entry, now), hook: await hookText(ctx, entry.entryId) };
      }
    }
    // A sitting's learning debt may return before FSRS's due time, in insertion order.
    for (const key of pending) {
      const row = await ctx.db.query("cards").withIndex("by_key", (q) => q.eq("key", key)).unique();
      if (!row || !row.card || row.fsrsState === "REVIEW" || (row.skill === "Listening" && !audio)) continue;
      const entry = await studiable(ctx, row, now, day);
      if (entry) return chosen(row, entry);
    }
    return null;
  },
});

/** The fitted FSRS settings answers are scheduled with, or null for the defaults, for previews and display. */
export const scheduling = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    requireToken(token);
    return parseFit((await ctx.db.query("settings").first())?.fittedSettings);
  },
});

/** Due cards waiting now, counted up to `DUE_DISPLAY_CAP`. */
export const summary = query({
  args: { token: v.string(), ...clock, audio: v.optional(v.boolean()) },
  handler: async (ctx, { token, day, now, audio = false }) => {
    requireToken(token);
    let due = 0;
    // The count is for display; past the walk budget it reports what it found.
    for (const skill of WEB_SKILLS.filter(s => audio || s !== "Listening")) {
      for await (const _ of dueCards(ctx, skill, now, day, true)) if (++due >= DUE_DISPLAY_CAP) break;
    }
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
    const skill = key.slice(key.lastIndexOf(":") + 1);
    if (!entry || !isWebSkill(skill)) return { status: "stale" as const };
    if (!await studiable(ctx, row ?? { key, active: !isDeleted(entry), skill, pausedUntil: 0, suspendedUntil: 0,
      packId: entry.origin.startsWith("pack:") ? entry.origin.slice(5) : null, entryId: entry.entryId }, now, day)) return { status: "stale" as const };
    const wasNewMeaning = !row?.card && !entry.started;
    const wasNewGender = !row?.card && skill === "Gender";
    const settings = await ctx.db.query("settings").first();
    if (wasNewMeaning && (entry.retired || (entry.studyRank ?? entry.rank ?? 2_147_483_647) < preferences(settings).minimumRank || (settings?.day === day && settings.introduced >= 5))) return { status: "stale" as const };
    if (wasNewGender && settings?.day === day && (settings.genderIntroduced ?? 0) >= NEW_GENDER_CARDS) return { status: "stale" as const };
    // A review never goes back in time, even if this browser's clock is behind.
    const at = Math.max(now, (row?.lastReview ?? 0) + 1);
    const card = row?.card == null ? newCard(await allocateCardId(ctx, day), at) : cardFromJson(row.card);
    // The learner's fit synced from the phone, as Android schedules with it; defaults otherwise.
    const result = schedulerFor(parseFit(settings?.fittedSettings)).review(card, rating as Rating, at);
    const cardJson = cardToJson(result.card);
    const log = `${logToJson(result.log).slice(0, -1)},"example":${androidJson(example)}}`;
    let offerHook = false;
    await withStudyProgress(ctx, async (progress) => {
      progress.remember(entry);
      // Four misses in a row pause the card for three days (synced like a phone's pause).
      const recall = recordRecall(row?.failures ?? 0, row?.pausedUntil ?? 0, rating === "AGAIN", at);
      offerHook = recall.offerHook;
      const fields = { card: cardJson, lastReview: at, failures: recall.failures, pausedUntil: recall.pausedUntil, updatedAt: Date.now() };
      const canonical = row ? { ...row, ...fields } : {
        key, ...fields, suspendedUntil: 0, cardEditedAt: 0,
        _id: await ctx.db.insert("cards", { key, ...fields, suspendedUntil: 0, cardEditedAt: 0 }), _creationTime: Date.now(),
      };
      if (row) await ctx.db.patch(row._id, fields);
      await refreshCard(ctx, canonical._id);
      await progress.card(canonical);
      const reviewId = `${key}@${instantString(at)}`;
      if (!await ctx.db.query("reviews").withIndex("by_review", q => q.eq("reviewId", reviewId)).unique()) {
        await ctx.db.insert("reviews", { reviewId, key, placement: false, log, reviewedAt: instantString(at), updatedAt: Date.now(), exposureCounted: true });
        await progress.review(key);
      }
    });
    // Today's introduction counters, synced with the phone (a newer local day starts them at zero).
    if (wasNewMeaning || wasNewGender) {
      const current = (await ctx.db.query("settings").first())!;
      const sameDay = current.day === day;
      if (current.day <= day) await ctx.db.patch(current._id, { day,
        introduced: (sameDay ? current.introduced : 0) + (wasNewMeaning ? 1 : 0),
        seconds: sameDay ? current.seconds : 0,
        genderIntroduced: (sameDay ? current.genderIntroduced ?? 0 : 0) + (wasNewGender ? 1 : 0), updatedAt: Date.now() });
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
    return { status: "ok" as const, card: cardJson, offerHook };
  },
});

/** The next action for a fresh daily sitting, restricted to skills the web can present. */
export const offer = query({
  args: { token: v.string(), ...clock, audio: v.optional(v.boolean()) },
  handler: async (ctx, { token, day, now, audio = false }) => {
    requireToken(token);
    if (await dailySeconds(ctx, day) >= 900) return "nothingLeft" as const;
    if (await soonestDue(ctx, now, day, audio)) return "practice" as const;
    if (await introduction(ctx, day, now, audio)) return "practice" as const;
    // Unstarted meanings the learner could study later (as on Android, dormant packs don't count).
    const { minimumRank } = preferences(await ctx.db.query("settings").first());
    for (const origin of ["personal", ...await rankedOrigins(ctx)]) {
      if (await ctx.db.query("entries").withIndex("by_introducible_origin_rank", q => q.eq("introducible", true).eq("origin", origin)
        .gte("studyRank", minimumRank)).first()) return "nothingLeft" as const;
    }
    for (const skill of WEB_SKILLS.filter(s => audio || s !== "Listening")) {
      if (skill === "Gender") {
        const installed = new Map<string, boolean>();
        for await (const entry of ctx.db.query("entries").withIndex(MISSING_INDEX[skill], q => q.eq(`missing${skill}`, true))) {
          if (await active(ctx, entry, installed) && await genderOwner(ctx, entry, installed)) return "nothingLeft" as const;
        }
      } else if (await ctx.db.query("entries").withIndex(MISSING_INDEX[skill], q => q.eq(`missing${skill}`, true)).first()) return "nothingLeft" as const;
      if (await ctx.db.query("cards").withIndex("by_active_skill_due", q => q.eq("active", true).eq("skill", skill).gte("due", 0).lte("due", now)).first()) return "nothingLeft" as const;
    }
    return "moreVocabulary" as const;
  },
});
