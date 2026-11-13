import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { TOKEN, setup, shipped, withToken } from "./helpers";

beforeEach(() => { process.env.SYNC_TOKEN = TOKEN; });
afterEach(() => { delete process.env.SYNC_TOKEN; });

describe("access", () => {
  test("reports whether a token is accepted", async () => {
    const t = setup();
    expect(await t.query(api.access.check, { token: TOKEN })).toEqual({ status: "ok" });
    expect(await t.query(api.access.check, { token: "wrong-token" })).toEqual({ status: "invalid" });
    delete process.env.SYNC_TOKEN;
    expect(await t.query(api.access.check, { token: TOKEN })).toEqual({ status: "notConfigured" });
  });

  test("web functions refuse a wrong or missing token", async () => {
    const t = setup();
    await expect(withToken(t, "wrong-token").query(api.library.list, {})).rejects.toThrow(/Invalid sync token/);
    await expect(withToken(t, "").query(api.library.list, {})).rejects.toThrow(/Invalid sync token/);
    delete process.env.SYNC_TOKEN;
    await expect(withToken(t).query(api.library.list, {})).rejects.toThrow(/not configured/);
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
    const { entries } = await withToken(t).query(api.library.list, {});
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
