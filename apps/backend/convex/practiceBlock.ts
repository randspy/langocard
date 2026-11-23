import { CLEANUP_SECONDS, DAILY_SECONDS, WIND_DOWN_SECONDS } from "./studyPolicy";

export const EXTRA_MINUTES = [5, 10, 15] as const;
export type ExtraMinutes = (typeof EXTRA_MINUTES)[number];
export type StoredBlock = { day: string; start: number; minutes: ExtraMinutes; meaningsUsed: number; gendersUsed: number };
const quota = (minutes: ExtraMinutes) => minutes === 5 ? 2 : minutes === 10 ? 3 : 5;
const integer = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= -2147483648 && n <= 2147483647;

/** One local stretch of daily time, mirroring Android PracticeBlock; only factories create grants. */
export class PracticeBlock {
  private constructor(private readonly extra: StoredBlock | null) {}
  static readonly daily = new PracticeBlock(null);

  static grant(day: string, seconds: number, minutes: ExtraMinutes) {
    if (!integer(seconds) || seconds < DAILY_SECONDS || seconds > 2147483647 - minutes * 60 - CLEANUP_SECONDS) throw new Error("Invalid extra block start");
    return new PracticeBlock({ day, start: seconds, minutes, meaningsUsed: 0, gendersUsed: 0 });
  }

  /** Invalid identity/duration expires; invalid usage preserves duration with both allowances spent. */
  static read(stored: unknown, today: string, seconds: number): PracticeBlock {
    if (!stored || typeof stored !== "object" || !("day" in stored) || stored.day !== today || !("minutes" in stored) || !("start" in stored)) return this.daily;
    const minutes = stored.minutes, start = stored.start;
    if ((minutes !== 5 && minutes !== 10 && minutes !== 15) || !integer(start) || start < DAILY_SECONDS || start > seconds || start > 2147483647 - minutes * 60 - CLEANUP_SECONDS) return this.daily;
    const meanings = "meaningsUsed" in stored ? stored.meaningsUsed : undefined;
    const genders = "gendersUsed" in stored ? stored.gendersUsed : undefined;
    const valid = integer(meanings) && meanings >= 0 && meanings <= quota(minutes) && integer(genders) && genders >= 0 && genders <= quota(minutes);
    return new PracticeBlock({ day: today, start, minutes,
      meaningsUsed: valid ? meanings : quota(minutes), gendersUsed: valid ? genders : quota(minutes) });
  }

  get start() { return this.extra?.start ?? 0; }
  get end() { return this.start + (this.extra?.minutes ?? 15) * 60; }
  get isExtra() { return this.extra !== null; }
  phase(seconds: number) {
    if (seconds >= this.end + CLEANUP_SECONDS) return "done";
    if (seconds >= this.end) return "cleanup";
    return seconds >= this.end - WIND_DOWN_SECONDS ? "wind-down" : "practice";
  }
  meaningRoom(dailyIntroduced: number) { return this.extra ? this.extra.meaningsUsed < quota(this.extra.minutes) : dailyIntroduced < 5; }
  genderRoom(dailyIntroduced: number) { return this.extra ? this.extra.gendersUsed < quota(this.extra.minutes) : dailyIntroduced < 10; }
  introduced(meaning: boolean, gender: boolean): PracticeBlock {
    return this.extra ? new PracticeBlock({ ...this.extra,
      meaningsUsed: Math.min(quota(this.extra.minutes), this.extra.meaningsUsed + Number(meaning)),
      gendersUsed: Math.min(quota(this.extra.minutes), this.extra.gendersUsed + Number(gender)) }) : this;
  }
  toJSON(): StoredBlock | null { return this.extra ? { ...this.extra } : null; }
}
