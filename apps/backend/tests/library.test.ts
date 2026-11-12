import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { OWNER_GITHUB_ID, setup, shipped, signIn } from "./helpers";

beforeEach(() => { process.env.ALLOWED_GITHUB_ID = OWNER_GITHUB_ID; });
afterEach(() => { delete process.env.ALLOWED_GITHUB_ID; });

describe("owner access", () => {
  test("reports why access is refused", async () => {
    const t = setup();
    expect(await t.query(api.owner.status, {})).toEqual({ status: "signedOut" });
    expect(await (await signIn(t, "999")).query(api.owner.status, {})).toEqual({ status: "notAllowed" });
    expect(await (await signIn(t, OWNER_GITHUB_ID)).query(api.owner.status, {})).toEqual({ status: "owner" });
  });

  test("web functions refuse anyone but the owner", async () => {
    const t = setup();
    await expect(t.query(api.library.list, {})).rejects.toThrow(/Sign in first/);
    await expect((await signIn(t, "999")).query(api.library.list, {})).rejects.toThrow(/isn't allowed/);
    delete process.env.ALLOWED_GITHUB_ID;
    await expect((await signIn(t, OWNER_GITHUB_ID)).query(api.library.list, {})).rejects.toThrow(/not configured/);
  });
});

describe("library.list", () => {
  test("returns entries with per-skill schedules, install state and flags", async () => {
    const t = setup();
    await t.mutation(internal.seed.apply, {
      entries: [shipped(), shipped({ entryId: "frw-2", origin: "pack:fr-extra" }), shipped({ entryId: "frw-3", origin: "pack:fr-other" })],
    });
    await t.run(async (ctx) => {
      const due = "2026-11-15T10:00:00Z";
      await ctx.db.insert("cards", {
        key: "frw-1:Reading", card: JSON.stringify({ cardId: 1, state: "REVIEW", step: null, stability: 3.2, difficulty: 5, due, lastReview: "2026-11-12T10:00:00Z" }),
        lastReview: 1, failures: 0, pausedUntil: 0, suspendedUntil: 99, cardEditedAt: 5, updatedAt: 1,
      });
      await ctx.db.insert("cards", { key: "frw-1:Listening", card: null, lastReview: 2, failures: 0, pausedUntil: 0, suspendedUntil: 0, cardEditedAt: 2, updatedAt: 1 });
      await ctx.db.insert("sources", { sourceId: "fr-extra", source: JSON.stringify({ source: "W", license: "L", packId: "fr-extra" }), updatedAt: 1 });
      const row = (await ctx.db.query("entries").collect()).find((e) => e.entryId === "frw-1")!;
      await ctx.db.patch(row._id, { definition: "Mine.", editedAt: 10, deletedAt: 20 });
    });
    const { entries } = await (await signIn(t, OWNER_GITHUB_ID)).query(api.library.list, {});
    const byId = Object.fromEntries(entries.map((e) => [e.entryId, e]));
    expect(byId["frw-1"]).toMatchObject({
      edited: true, deleted: true, installed: true,
      skills: {
        Reading: { due: Date.parse("2026-11-15T10:00:00Z"), state: "REVIEW", suspendedUntil: 99 },
        Listening: { due: null, state: null },
      },
    });
    expect(byId["frw-2"]).toMatchObject({ installed: true, edited: false, deleted: false, skills: {} });
    expect(byId["frw-3"].installed).toBe(false);
  });
});
