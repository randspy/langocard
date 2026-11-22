import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { cardFromJson } from "./fsrs";
import { isDeleted, SUSPENDED_INDEFINITELY } from "./merge";

/**
 * Keeps the server-only scheduling columns of `cards` current (see `derivedCardFields`).
 * Every write to a card, or to whether its entry is deleted, must end with `refreshCard` or
 * `refreshEntryCards`; `migrations:deriveCards` rebuilds them.
 */

export const DERIVED_CARD_FIELDS = ["due", "fsrsState", "cardId", "entryId", "skill", "active"] as const;

type Derived = Pick<Doc<"cards">, (typeof DERIVED_CARD_FIELDS)[number]>;

function derive(row: Doc<"cards">, entryLive: boolean): Derived {
  const split = row.key.lastIndexOf(":");
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
    entryId: row.key.slice(0, split),
    skill: row.key.slice(split + 1),
    active: entryLive && row.suspendedUntil !== SUSPENDED_INDEFINITELY,
  };
}

/** Whether `entryId` names an entry that isn't deleted. */
export async function entryLive(ctx: QueryCtx, entryId: string): Promise<boolean> {
  const entry = await ctx.db.query("entries").withIndex("by_entry", (q) => q.eq("entryId", entryId)).unique();
  return entry !== null && !isDeleted(entry);
}

/** Recomputes one card's derived columns after a write. */
export async function refreshCard(ctx: MutationCtx, id: Id<"cards">, live?: boolean): Promise<void> {
  const row = await ctx.db.get(id);
  if (!row) return;
  const derived = derive(row, live ?? await entryLive(ctx, row.key.slice(0, row.key.lastIndexOf(":"))));
  if (DERIVED_CARD_FIELDS.some((field) => row[field] !== derived[field])) await ctx.db.patch(id, derived);
}

/** Recomputes the derived columns of every card of `entryId`, after its deletion state may have changed. */
export async function refreshEntryCards(ctx: MutationCtx, entryId: string): Promise<void> {
  const live = await entryLive(ctx, entryId);
  for (const row of await ctx.db.query("cards").withIndex("by_key", (q) => q.gte("key", `${entryId}:`).lt("key", `${entryId};`)).collect()) {
    await refreshCard(ctx, row._id, live);
  }
}

/** A card row as devices see it, without the derived columns. */
export function withoutDerived<T extends Record<string, unknown>>(row: T): Omit<T, (typeof DERIVED_CARD_FIELDS)[number]> {
  const copy: Record<string, unknown> = { ...row };
  for (const field of DERIVED_CARD_FIELDS) delete copy[field];
  return copy as Omit<T, (typeof DERIVED_CARD_FIELDS)[number]>;
}
