/**
 * FSRS-6 scheduling, ported from java-fsrs 1.0.0, the library the Android app uses, so a card
 * reviewed on the web is scheduled exactly as on the phone. `content/fsrs-fixtures.json`
 * (generated from java-fsrs by Android's `FsrsFixturesTest`) holds the cases both must pass.
 * Cards and review logs read and write the JSON Android stores and syncs.
 * Self-contained, so Convex functions and the web app can both import it.
 *
 * Ported from java-fsrs (https://github.com/open-spaced-repetition/java-fsrs),
 * Copyright (c) 2025 Open Spaced Repetition, used under the MIT License:
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software
 * and associated documentation files (the "Software"), to deal in the Software without
 * restriction, including without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or
 * substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
 * BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
 * DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

export type Rating = "AGAIN" | "HARD" | "GOOD" | "EASY";
export type FsrsState = "LEARNING" | "REVIEW" | "RELEARNING";
export const RATINGS: readonly Rating[] = ["AGAIN", "HARD", "GOOD", "EASY"];

/** An FSRS card. Times are epoch milliseconds. */
export type Card = {
  cardId: number;
  state: FsrsState;
  step: number | null;
  stability: number | null;
  difficulty: number | null;
  due: number;
  lastReview: number | null;
};

export type ReviewLog = { cardId: number; rating: Rating; reviewDatetime: number; reviewDuration: number | null };

export const DEFAULT_PARAMETERS: readonly number[] = [
  0.2172, 1.1771, 3.2602, 16.1507, 7.0114, 0.57, 2.0966, 0.0069, 1.5261, 0.112, 1.0178, 1.849,
  0.1133, 0.3127, 2.2934, 0.2191, 3.0004, 0.7536, 0.3332, 0.1437, 0.2,
];
export const DEFAULT_RETENTION = 0.9;

export type SchedulerOptions = {
  /** 21 FSRS-6 weights; defaults to java-fsrs's. */
  parameters?: readonly number[];
  desiredRetention?: number;
  /** Spreads review intervals of 3 days or more, as Android does. On by default. */
  enableFuzzing?: boolean;
  /** Uniform numbers in [0, 1) for fuzzing. Defaults to `Math.random`. */
  random?: () => number;
};

const MINUTE = 60_000;
const DAY = 86_400_000;
const LEARNING_STEPS = [1 * MINUTE, 10 * MINUTE];
const RELEARNING_STEPS = [10 * MINUTE];
const MAXIMUM_INTERVAL = 36_500;
const STABILITY_MIN = 0.001;
const FUZZ_RANGES = [
  { start: 2.5, end: 7.0, factor: 0.15 },
  { start: 7.0, end: 20.0, factor: 0.1 },
  { start: 20.0, end: Infinity, factor: 0.05 },
];

const ratingValue = (rating: Rating) => RATINGS.indexOf(rating) + 1;
/** `ChronoUnit.DAYS.between`: whole days, truncated toward zero. */
const daysBetween = (from: number, to: number) => Math.trunc((to - from) / DAY);
/** Java's `Math.round`: halves round up. */
const round = (x: number) => Math.floor(x + 0.5);

/** A card before its first answer, as `Learner.newCard` builds it. */
export function newCard(cardId: number, now: number): Card {
  return { cardId, state: "LEARNING", step: 0, stability: null, difficulty: null, due: now, lastReview: null };
}

export class Scheduler {
  private readonly w: readonly number[];
  private readonly retention: number;
  private readonly fuzzing: boolean;
  private readonly random: () => number;
  private readonly decay: number;
  private readonly factor: number;

  constructor(options: SchedulerOptions = {}) {
    this.w = options.parameters ?? DEFAULT_PARAMETERS;
    if (this.w.length !== 21) throw new Error("FSRS-6 requires 21 parameters");
    this.retention = options.desiredRetention ?? DEFAULT_RETENTION;
    this.fuzzing = options.enableFuzzing ?? true;
    this.random = options.random ?? Math.random;
    this.decay = -this.w[20];
    this.factor = Math.pow(0.9, 1.0 / this.decay) - 1;
  }

  /** How likely the card is recalled at `now`; 0 before its first review. */
  retrievability(card: Card, now: number): number {
    if (card.lastReview === null) return 0;
    const elapsedDays = Math.max(0, daysBetween(card.lastReview, now));
    return Math.pow(1 + (this.factor * elapsedDays) / card.stability!, this.decay);
  }

  /** The card and log after answering `card` with `rating` at `now`. Never mutates `card`. */
  review(card: Card, rating: Rating, now: number, reviewDuration: number | null = null): { card: Card; log: ReviewLog } {
    const next = { ...card };
    const w = this.w;
    const daysSinceLastReview = card.lastReview === null ? null : daysBetween(card.lastReview, now);
    const sameDay = daysSinceLastReview !== null && daysSinceLastReview < 1;
    let interval = 0;

    const toReview = () => {
      next.state = "REVIEW";
      next.step = null;
      interval = this.nextInterval(next.stability!) * DAY;
    };
    /** Learning and relearning share their step logic; java-fsrs's Hard on relearning step 0 with several steps uses the learning steps. */
    const stepThrough = (steps: number[]) => {
      if (steps.length === 0 || (next.step! >= steps.length && rating !== "AGAIN")) return toReview();
      switch (rating) {
        case "AGAIN":
          next.step = 0;
          interval = steps[0];
          break;
        case "HARD":
          if (next.step === 0 && steps.length === 1) interval = round(steps[0] * 1.5);
          else if (next.step === 0) interval = round((LEARNING_STEPS[0] + LEARNING_STEPS[1]) / 2.0);
          else interval = steps[next.step!];
          break;
        case "GOOD":
          if (next.step! + 1 === steps.length) toReview();
          else {
            next.step = next.step! + 1;
            interval = steps[next.step];
          }
          break;
        case "EASY":
          toReview();
          break;
      }
    };

    switch (card.state) {
      case "LEARNING": {
        if (card.stability === null && card.difficulty === null) {
          next.stability = this.initialStability(rating);
          next.difficulty = this.initialDifficulty(rating);
        } else if (sameDay) {
          next.stability = this.shortTermStability(card.stability!, rating);
          next.difficulty = this.nextDifficulty(card.difficulty!, rating);
        } else {
          next.stability = this.nextStability(card.difficulty!, card.stability!, this.retrievability(card, now), rating);
          next.difficulty = this.nextDifficulty(card.difficulty!, rating);
        }
        stepThrough(LEARNING_STEPS);
        break;
      }
      case "REVIEW": {
        next.stability = sameDay
          ? this.shortTermStability(card.stability!, rating)
          : this.nextStability(card.difficulty!, card.stability!, this.retrievability(card, now), rating);
        next.difficulty = this.nextDifficulty(card.difficulty!, rating);
        if (rating === "AGAIN" && RELEARNING_STEPS.length > 0) {
          next.state = "RELEARNING";
          next.step = 0;
          interval = RELEARNING_STEPS[0];
        } else interval = this.nextInterval(next.stability) * DAY;
        break;
      }
      case "RELEARNING": {
        next.stability = sameDay
          ? this.shortTermStability(card.stability!, rating)
          : this.nextStability(card.difficulty!, card.stability!, this.retrievability(card, now), rating);
        next.difficulty = this.nextDifficulty(card.difficulty!, rating);
        stepThrough(RELEARNING_STEPS);
        break;
      }
    }

    if (this.fuzzing && next.state === "REVIEW") interval = this.fuzzed(interval);
    next.due = now + interval;
    next.lastReview = now;
    return { card: next, log: { cardId: card.cardId, rating, reviewDatetime: now, reviewDuration } };
  }

  private clampStability = (s: number) => Math.max(s, STABILITY_MIN);
  private clampDifficulty = (d: number) => Math.min(Math.max(d, 1.0), 10.0);

  private initialStability(rating: Rating) {
    return this.clampStability(this.w[ratingValue(rating) - 1]);
  }

  private initialDifficulty(rating: Rating) {
    return this.clampDifficulty(this.w[4] - Math.pow(Math.E, this.w[5] * (ratingValue(rating) - 1)) + 1);
  }

  private shortTermStability(stability: number, rating: Rating) {
    let increase = Math.exp(this.w[17] * (ratingValue(rating) - 3 + this.w[18])) * Math.pow(stability, -this.w[19]);
    if (rating === "GOOD" || rating === "EASY") increase = Math.max(increase, 1.0);
    return this.clampStability(stability * increase);
  }

  private nextDifficulty(difficulty: number, rating: Rating) {
    const delta = -(this.w[6] * (ratingValue(rating) - 3));
    const damped = difficulty + ((10.0 - difficulty) * delta) / 9.0;
    return this.clampDifficulty(this.w[7] * this.initialDifficulty("EASY") + (1 - this.w[7]) * damped);
  }

  private nextStability(difficulty: number, stability: number, retrievability: number, rating: Rating) {
    const w = this.w;
    let s: number;
    if (rating === "AGAIN") {
      const longTerm = w[11] * Math.pow(difficulty, -w[12]) * (Math.pow(stability + 1, w[13]) - 1) *
        Math.exp((1 - retrievability) * w[14]);
      const shortTerm = stability / Math.exp(w[17] * w[18]);
      s = Math.min(longTerm, shortTerm);
    } else {
      const hardPenalty = rating === "HARD" ? w[15] : 1;
      const easyBonus = rating === "EASY" ? w[16] : 1;
      s = stability * (1 + Math.exp(w[8]) * (11 - difficulty) * Math.pow(stability, -w[9]) *
        (Math.exp((1 - retrievability) * w[10]) - 1) * hardPenalty * easyBonus);
    }
    return this.clampStability(s);
  }

  /** Whole days, from 1 to the maximum interval. */
  private nextInterval(stability: number) {
    const days = round((stability / this.factor) * (Math.pow(this.retention, 1 / this.decay) - 1));
    return Math.min(Math.max(days, 1), MAXIMUM_INTERVAL);
  }

  private fuzzed(interval: number) {
    const days = Math.trunc(interval / DAY);
    if (days < 2.5) return interval;
    let delta = 1.0;
    for (const range of FUZZ_RANGES) delta += range.factor * Math.max(Math.min(days, range.end - range.start), 0.0);
    let min = round(days - delta);
    let max = round(days + delta);
    min = Math.max(2, min);
    max = Math.min(max, MAXIMUM_INTERVAL);
    min = Math.min(min, max);
    return Math.min(round(this.random() * (max - min + 1) + min), MAXIMUM_INTERVAL) * DAY;
  }
}

/**
 * `java.util.Random`'s `nextDouble`, for reproducing java-fsrs's seeded fuzzing in tests.
 * Android seeds every scheduler with 42.
 */
export function javaRandom(seed: number): () => number {
  const multiplier = 0x5deece66dn;
  const mask = (1n << 48n) - 1n;
  let state = (BigInt(seed) ^ multiplier) & mask;
  const next = (bits: bigint) => {
    state = (state * multiplier + 0xbn) & mask;
    return state >> (48n - bits);
  };
  return () => Number((next(26n) << 27n) + next(27n)) * 2 ** -53;
}

// ---- Android's JSON ----------------------------------------------------------

/** `Instant.toString`: ISO-8601 in UTC, with milliseconds only when present. */
export function instantString(ms: number): string {
  const iso = new Date(ms).toISOString();
  return ms % 1000 === 0 ? iso.replace(".000Z", "Z") : iso;
}

/** Java's `Double.toString`, which Jackson uses: "1.0", "0.25", "1.0E-4". */
function javaDouble(x: number): string {
  if (!Number.isFinite(x)) throw new Error("FSRS values must be finite");
  const abs = Math.abs(x);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e7)) {
    const [mantissa, exponent] = x.toExponential().split("e");
    return `${mantissa.includes(".") ? mantissa : `${mantissa}.0`}E${Number(exponent)}`;
  }
  const plain = String(x);
  return plain.includes(".") ? plain : `${plain}.0`;
}

const javaNullableDouble = (x: number | null) => (x === null ? "null" : javaDouble(x));
const nullableInstant = (ms: number | null) => (ms === null ? "null" : JSON.stringify(instantString(ms)));

/** The card as `Card.toJson` writes it, byte for byte. */
export function cardToJson(card: Card): string {
  return `{"cardId":${card.cardId},"state":"${card.state}","step":${card.step ?? "null"},` +
    `"stability":${javaNullableDouble(card.stability)},"difficulty":${javaNullableDouble(card.difficulty)},` +
    `"due":${nullableInstant(card.due)},"lastReview":${nullableInstant(card.lastReview)}}`;
}

/** The log as `ReviewLog.toJson` writes it, byte for byte. */
export function logToJson(log: ReviewLog): string {
  return `{"cardId":${log.cardId},"rating":"${log.rating}","review_datetime":${JSON.stringify(instantString(log.reviewDatetime))},` +
    `"reviewDuration":${log.reviewDuration ?? "null"}}`;
}

function instant(value: unknown): number {
  const ms = typeof value === "string" ? Date.parse(value) : NaN;
  if (Number.isNaN(ms)) throw new Error(`Invalid FSRS time: ${String(value)}`);
  return ms;
}

/** Reads a card in Android's JSON. Like `Card.fromJson`, a learning card without a step starts at step 0. */
export function cardFromJson(json: string): Card {
  const o = JSON.parse(json);
  const state: FsrsState = o.state ?? "LEARNING";
  if (!["LEARNING", "REVIEW", "RELEARNING"].includes(state)) throw new Error(`Unknown FSRS state: ${state}`);
  if (!Number.isInteger(o.cardId)) throw new Error("FSRS card without an ID");
  return {
    cardId: o.cardId,
    state,
    step: o.step ?? (state === "LEARNING" ? 0 : null),
    stability: o.stability ?? null,
    difficulty: o.difficulty ?? null,
    due: instant(o.due),
    lastReview: o.lastReview == null ? null : instant(o.lastReview),
  };
}

export function logFromJson(json: string): ReviewLog {
  const o = JSON.parse(json);
  if (!RATINGS.includes(o.rating)) throw new Error(`Unknown rating: ${o.rating}`);
  return { cardId: o.cardId, rating: o.rating, reviewDatetime: instant(o.review_datetime), reviewDuration: o.reviewDuration ?? null };
}

/** How long until `due`, as a rating button shows it: "10m", "3h", "4d". Mirrors `StudyPolicy.interval`. */
export function intervalLabel(now: number, due: number): string {
  // `Duration.getSeconds` floors toward negative infinity.
  const seconds = Math.floor((due - now) / 1000);
  const minutes = Math.max(Math.trunc((seconds + 59) / 60), 1);
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.trunc(minutes / 60)}h`;
  return `${Math.trunc(minutes / 1440)}d`;
}
