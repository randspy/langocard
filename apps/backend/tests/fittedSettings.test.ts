import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fixtures from "../../../content/fsrs-fixtures.json";
import { api, internal } from "../convex/_generated/api";
import { parseFit, schedulerFor, schedulingDescription } from "../convex/fittedSettings";
import { cardFromJson, cardToJson, DEFAULT_PARAMETERS } from "../convex/fsrs";
import { TOKEN, setup, shipped, withToken } from "./helpers";

beforeEach(() => { process.env.SYNC_TOKEN = TOKEN; });
afterEach(() => { delete process.env.SYNC_TOKEN; });

const fitted = fixtures.schedulers.find((s) => s.name === "fitted")!;
const fitJson = (o: Record<string, unknown> = {}) => JSON.stringify({
  format: "langocard-fsrs", version: 1, parameters: fitted.parameters, desiredRetention: fitted.desiredRetention,
  reviewCount: 1200, fitDate: "2026-11-15T12:00:00Z", ...o,
});

describe("fitted FSRS settings", () => {
  test("an invalid fit is ignored, as Android ignores it", () => {
    expect(parseFit(null)).toBeNull();
    expect(parseFit("{}")).toBeNull();
    expect(parseFit(fitJson({ parameters: fitted.parameters.slice(0, 20) }))).toBeNull();
    expect(parseFit(fitJson({ desiredRetention: 0.99 }))).toBeNull();
    expect(parseFit(fitJson({ reviewCount: 10 }))).toBeNull();
    expect(parseFit(fitJson({ parameters: [500, ...fitted.parameters.slice(1)] }))).toBeNull();
    expect(parseFit(fitJson({ fitDate: "2026-11-15" }))).toBeNull();
    expect(parseFit(fitJson({ fitDate: "2026-02-30T12:00:00Z" }))).toBeNull();
    expect(parseFit(fitJson().replace('"version":1', '"version":1.0'))).toBeNull();
    expect(parseFit(fitJson({ reviewCount: 2147483648 }))).toBeNull();
    expect(parseFit(fitJson({ fitDate: "2026-11-15T12:00:00.5+01:00" }))).not.toBeNull();
  });

  test("describes the active scheduling as the phone does", () => {
    expect(schedulingDescription(null)).toBe("FSRS defaults · 90% target recall");
    expect(schedulingDescription(parseFit(fitJson()))).toBe("FSRS · 85% target recall · fitted with 1200 reviews on 2026-11-15T12:00:00Z");
  });

  test("web answers use the synced fit, and defaults without one", async () => {
    const day = "2026-11-20", now = Date.parse("2026-11-20T09:00:00Z");
    const answerDue = async (fittedSettings: string | null) => {
      const t = setup(), client = withToken(t);
      await t.mutation(internal.seed.apply, { entries: [shipped({ rank: 3000 })] });
      const card = cardToJson({ cardId: 1, state: "REVIEW", step: null, stability: 30, difficulty: 5, due: now - 1000, lastReview: now - 30 * 864e5 });
      await t.mutation(api.sync.push, { token: TOKEN, cards: [{ key: "frw-1:Reading", card, lastReview: now - 30 * 864e5, failures: 0,
        pausedUntil: 0, suspendedUntil: 0, cardEditedAt: 0 }], reviews: [], entries: [], sources: [], buried: [], settings: {
        placementDone: true, placementIndex: 0, nextCardId: 2, minimumRank: 2501, interests: "daily", preferencesChangedAt: 0,
        day, seconds: 0, introduced: 0, genderIntroduced: 0, fittedSettings, fittedSettingsChangedAt: 5,
      } });
      const shown = (await client.query(api.study.next, { day, now }))!;
      const result = await client.mutation(api.study.answer, { day, now, key: shown.key, version: shown.version, example: shown.example, rating: "GOOD" });
      return (cardFromJson((result as { card: string }).card).due - now) / 864e5;
    };
    // A 70% target recall schedules far later than the default 90%, beyond fuzzing.
    const lowRetention = fitJson({ parameters: [...DEFAULT_PARAMETERS], desiredRetention: 0.7 });
    expect(await answerDue(lowRetention)).toBeGreaterThan(1.5 * await answerDue(null));
    const answerFirst = async (fittedSettings: string | null) => {
      const t = setup(), client = withToken(t);
      await t.mutation(internal.seed.apply, { entries: [shipped({ rank: 3000 })] });
      await t.mutation(api.sync.push, { token: TOKEN, cards: [], reviews: [], entries: [], sources: [], buried: [], settings: {
        placementDone: true, placementIndex: 0, nextCardId: 1, minimumRank: 2501, interests: "daily", preferencesChangedAt: 0,
        day, seconds: 0, introduced: 0, genderIntroduced: 0, fittedSettings, fittedSettingsChangedAt: 5,
      } });
      expect(await client.query(api.study.scheduling, {})).toEqual(parseFit(fittedSettings));
      const shown = (await client.query(api.study.next, { day, now }))!;
      const result = await client.mutation(api.study.answer, { day, now, key: shown.key, version: shown.version, example: shown.example, rating: "GOOD" });
      return cardFromJson((result as { card: string }).card);
    };
    const withFit = await answerFirst(fitJson());
    const defaults = await answerFirst(null);
    expect(withFit.stability).toBe(fitted.parameters[2]);
    expect(defaults.stability).toBe(3.2602);
  });
});
