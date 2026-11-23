import { studyOrder } from "./studyOrder";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { contentOf, nounOf } from "./entryRules";
import { cardFromJson } from "./fsrs";
import { isDeleted } from "./merge";
import { SKILLS, skillsOf, type Skill } from "./skills";

/** Four bounded memory slots; resets remove memory without removing exposure history. */
export const progressFields = {
  slots: v.record(v.string(), v.object({ id: v.id("cards"), cardId: v.union(v.number(), v.null()), suspendedUntil: v.number() })),
  exposures: v.number(),
};
export const entryStudyFields = {
  studyOrder: v.optional(v.string()),
  progress: v.optional(v.object(progressFields)),
  lexeme: v.optional(v.string()), nounKey: v.optional(v.union(v.string(), v.null())),
  started: v.optional(v.boolean()), introducible: v.optional(v.boolean()),
  missingReading: v.optional(v.boolean()), missingListening: v.optional(v.boolean()),
  missingProduction: v.optional(v.boolean()), missingGender: v.optional(v.boolean()),
  studyRank: v.optional(v.number()), rankBand: v.optional(v.number()),
};

type Progress = NonNullable<Doc<"entries">["progress"]>;
const empty = (): Progress => ({ slots: {}, exposures: 0 });
const skillOf = (key: string): Skill | undefined => SKILLS.find((s) => key.endsWith(`:${s}`));
const ownerOf = (key: string) => key.slice(0, key.lastIndexOf(":"));

/** Entry identities mirror Kotlin Entry.lexeme and Gender.noun, which are different concepts. */
export function projectEntry(entry: Doc<"entries">, progress: Progress) {
  const content = contentOf(entry);
  const started = Object.values(progress.slots).some((slot) => slot.cardId !== null);
  // Retired meanings still gain their remaining skills, as on Android (StudyRulesTest).
  const missing = (skill: Skill) => started && skillsOf(content).includes(skill) && progress.slots[skill]?.cardId == null;
  const studyRank = entry.rank ?? 2_147_483_647;
  return {
    studyOrder: studyOrder(entry.entryId), progress, started, introducible: !started && !isDeleted(entry) && !entry.retired,
    lexeme: entry.lemma.trim() ? entry.lemma : entry.word.replace(/^un /, "").replace(/^une /, ""),
    nounKey: content.gender === null ? null : JSON.stringify([nounOf(entry.word).toLowerCase(), content.gender]),
    missingReading: missing("Reading"), missingListening: missing("Listening"),
    missingProduction: missing("Production"), missingGender: missing("Gender"),
    studyRank, rankBand: Math.floor(Math.min(studyRank, 1_000_000) / 100),
  };
}

/** One mutation's projection owner. Canonical rows remain authoritative; callers pass merge winners. */
class StudyProgress {
  private entries = new Map<string, Doc<"entries"> | null>();
  private progress = new Map<string, Progress>();
  private orphans = new Map<string, Doc<"orphanProgress"> | null>();
  private adopting = new Set<string>();
  private dirty = new Set<string>();
  constructor(private ctx: MutationCtx) {}

  /** Reuses a row the caller already read or wrote, preserving deltas queued earlier. */
  remember(entry: Doc<"entries">) {
    this.entries.set(entry.entryId, entry);
  }

  async entry(entryId: string) {
    if (!this.entries.has(entryId)) this.entries.set(entryId, await this.ctx.db.query("entries").withIndex("by_entry", q => q.eq("entryId", entryId)).unique());
    return this.entries.get(entryId)!;
  }

  private async load(entryId: string): Promise<Progress> {
    const cached = this.progress.get(entryId);
    if (cached) return cached;
    const entry = await this.entry(entryId);
    let progress = entry?.progress;
    if (!progress) {
      const orphan = !entry || this.adopting.has(entryId)
        ? await this.ctx.db.query("orphanProgress").withIndex("by_entry", q => q.eq("entryId", entryId)).unique() : null;
      this.orphans.set(entryId, orphan);
      progress = orphan ? { slots: { ...orphan.slots }, exposures: orphan.exposures } : empty();
      // Compatibility until the initial backfill: at most four canonical skills, no history scan.
      const rows = await this.ctx.db.query("cards").withIndex("by_key", q => q.gte("key", `${entryId}:`).lt("key", `${entryId};`)).take(5);
      for (const row of rows) this.assign(progress, row);
    } else progress = { slots: { ...progress.slots }, exposures: progress.exposures };
    this.progress.set(entryId, progress);
    return progress;
  }

  private assign(progress: Progress, row: Doc<"cards">) {
    const skill = skillOf(row.key);
    if (!skill) return;
    let cardId = null;
    try { cardId = row.card === null ? null : cardFromJson(row.card).cardId; } catch { /* An unreadable card has no memory state. */ }
    progress.slots[skill] = { id: row._id, cardId, suspendedUntil: row.suspendedUntil };
  }

  async card(row: Doc<"cards">) {
    const entryId = ownerOf(row.key);
    this.assign(await this.load(entryId), row);
    this.dirty.add(entryId);
  }

  async entryChanged(entry: Doc<"entries">, inserted = false) {
    if (inserted) this.adopting.add(entry.entryId);
    this.remember(entry);
    await this.load(entry.entryId);
    this.dirty.add(entry.entryId);
  }

  /** Called once per newly inserted sentence-skill review, including placement. */
  async review(key: string) {
    const skill = skillOf(key);
    if (!skill || skill === "Gender") return;
    const entryId = ownerOf(key);
    (await this.load(entryId)).exposures++;
    this.dirty.add(entryId);
  }

  async flush() {
    for (const entryId of this.dirty) {
      const entry = await this.entry(entryId);
      const progress = this.progress.get(entryId)!;
      if (entry) {
        await this.ctx.db.patch(entry._id, projectEntry(entry, progress));
        const orphan = this.orphans.get(entryId);
        if (orphan) await this.ctx.db.delete(orphan._id);
      } else {
        const orphan = this.orphans.get(entryId);
        if (orphan) await this.ctx.db.patch(orphan._id, progress);
        else await this.ctx.db.insert("orphanProgress", { entryId, ...progress });
      }
    }
  }
}

/** Flushes every projection before the enclosing transaction commits, including orphan adoption. */
export async function withStudyProgress<T>(ctx: MutationCtx, change: (writer: StudyProgress) => Promise<T>): Promise<T> {
  const writer = new StudyProgress(ctx);
  const result = await change(writer);
  await writer.flush();
  return result;
}
