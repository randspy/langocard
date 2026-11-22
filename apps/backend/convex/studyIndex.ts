import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { cardFromJson } from "./fsrs";
import { isDeleted, SUSPENDED_INDEFINITELY } from "./merge";

/**
 * Keeps the server-only scheduling columns of `cards` current (see `derivedCardFields`).
 * Every write to a card, or to its entry's deletion or origin, must end with `refreshCard`,
 * `refreshEntryCards` or a write that includes `deriveCard`; `migrations:deriveCards`
 * rebuilds them.
 */

export const DERIVED_CARD_FIELDS = ["due", "fsrsState", "cardId", "entryId", "skill", "packId", "active"] as const;

type Derived = Pick<Doc<"cards">, (typeof DERIVED_CARD_FIELDS)[number]>;

/** What a card's derived columns need to know about its entry. */
export type EntryState = { live: boolean; packId: string | null };

export function entryStateOf(entry: Doc<"entries"> | null): EntryState {
  return {
    live: entry !== null && !isDeleted(entry),
    packId: entry?.origin.startsWith("pack:") ? entry.origin.slice("pack:".length) : null,
  };
}

export const entryIdOf = (key: string) => key.slice(0, key.lastIndexOf(":"));

/** The derived columns of a card with these fields, whose entry is in `entry`'s state. */
export function deriveCard(row: { key: string; card: string | null; suspendedUntil: number }, entry: EntryState): Derived {
  let card = null;
  try {
    card = row.card === null ? null : cardFromJson(row.card);
  } catch {
    // Unreadable JSON is treated as new; it's never offered as due.
  }
  return {
    due: card?.due ?? null,
    fsrsState: card?.state ?? null,
    cardId: card?.cardId ?? null,
    entryId: entryIdOf(row.key),
    skill: row.key.slice(row.key.lastIndexOf(":") + 1),
    packId: entry.packId,
    active: entry.live && row.suspendedUntil !== SUSPENDED_INDEFINITELY,
  };
}

export async function entryState(ctx: QueryCtx, entryId: string): Promise<EntryState> {
  return entryStateOf(await ctx.db.query("entries").withIndex("by_entry", (q) => q.eq("entryId", entryId)).unique());
}

/** Patches a card row read in this transaction when its derived columns are out of date. */
async function rederive(ctx: MutationCtx, row: Doc<"cards">, entry: EntryState): Promise<void> {
  const derived = deriveCard(row, entry);
  if (DERIVED_CARD_FIELDS.some((field) => row[field] !== derived[field])) await ctx.db.patch(row._id, derived);
}

/** Recomputes one card's derived columns after a write. */
export async function refreshCard(ctx: MutationCtx, id: Id<"cards">, entry?: EntryState): Promise<void> {
  const row = await ctx.db.get(id);
  if (row) await rederive(ctx, row, entry ?? await entryState(ctx, entryIdOf(row.key)));
}

/** Recomputes the derived columns of every card of `entryId`, after its deletion or origin may have changed. */
export async function refreshEntryCards(ctx: MutationCtx, entryId: string, entry?: EntryState): Promise<void> {
  const state = entry ?? await entryState(ctx, entryId);
  for (const row of await ctx.db.query("cards").withIndex("by_key", (q) => q.gte("key", `${entryId}:`).lt("key", `${entryId};`)).collect()) {
    await rederive(ctx, row, state);
  }
}

/** A card row as devices see it, without the derived columns. */
export function withoutDerived<T extends Record<string, unknown>>(row: T): Omit<T, (typeof DERIVED_CARD_FIELDS)[number]> {
  const copy: Record<string, unknown> = { ...row };
  for (const field of DERIVED_CARD_FIELDS) delete copy[field];
  return copy as Omit<T, (typeof DERIVED_CARD_FIELDS)[number]>;
}
