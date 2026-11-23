import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fixtures from "../../../content/fsrs-fixtures.json";
import { api, internal } from "../convex/_generated/api";
import { parseFit, schedulerFor, schedulingDescription } from "../convex/fittedSettings";
import { cardFromJson, type Rating } from "../convex/fsrs";
import { TOKEN, setup, shipped, withToken } from "./helpers";

beforeEach(() => { process.env.SYNC_TOKEN = TOKEN; });
afterEach(() => { delete process.env.SYNC_TOKEN; });

const fitted = fixtures.schedulers.find((s) => s.name === "fitted")!;
const fitJson = (o: Record<string, unknown> = {}) => JSON.stringify({
  format: "langocard-fsrs", version: 1, parameters: fitted.parameters, desiredRetention: fitted.desiredRetention,
  reviewCount: 1200, fitDate: "2026-11-15T12:00:00Z", ...o,
});

describe("fitted FSRS settings", () => {
  test("a synced fit schedules exactly like java-fsrs with those parameters (shared fixtures)", () => {
    const fit = parseFit(fitJson())!;
    for (const c of fixtures.cases.filter((c) => c.scheduler === "fitted")) {
      const scheduler = schedulerFor(fit, { enableFuzzing: false });
      for (const step of c.steps) {
        const result = scheduler.review(cardFromJson(JSON.stringify(step.card)), step.rating as Rating, Date.parse(step.reviewDatetime));
        const expected = step.expectedCard;
        expect({ state: result.card.state, step: result.card.step, due: new Date(result.card.due).toISOString() })
          .toEqual({ state: expected.state, step: expected.step, due: new Date(Date.parse(expected.due)).toISOString() });
        expect(result.card.stability).toBeCloseTo(expected.stability!, 10);
      }
    }
  });

  test("an invalid fit is ignored, as Android ignores it", () => {
    expect(parseFit(null)).toBeNull();
    expect(parseFit("{}")).toBeNull();
    expect(parseFit(fitJson({ parameters: fitted.parameters.slice(0, 20) }))).toBeNull();
    expect(parseFit(fitJson({ desiredRetention: 0.99 }))).toBeNull();
    expect(parseFit(fitJson({ reviewCount: 10 }))).toBeNull();
    expect(parseFit(fitJson({ parameters: [500, ...fitted.parameters.slice(1)] }))).toBeNull();
  });

  test("describes the active scheduling as the phone does", () => {
    expect(schedulingDescription(null)).toBe("FSRS defaults · 90% target recall");
    expect(schedulingDescription(parseFit(fitJson()))).toBe("FSRS · 85% target recall · fitted with 1200 reviews on 2026-11-15T12:00:00Z");
  });

  test("web answers use the synced fit, and defaults without one", async () => {
    const day = "2026-11-20", now = Date.parse("2026-11-20T09:00:00Z");
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
