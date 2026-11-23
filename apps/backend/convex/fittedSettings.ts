import { DEFAULT_PARAMETERS, DEFAULT_RETENTION, Scheduler } from "./fsrs";

/**
 * A learner's fitted FSRS-6 settings, as Android imports them (`FittedSettings.parse`) and
 * syncs them in `settings.fittedSettings`. Self-contained, so the web app can import it.
 */
export type Fit = { parameters: number[]; retention: number; reviewCount: number; fitDate: string };

/** Android's accepted range for each of the 21 weights. */
const BOUNDS: [number, number][] = [
  [0.001, 100], [0.001, 100], [0.001, 100], [0.001, 100],
  [1, 10], [0.001, 4], [0.001, 4], [0.001, 0.75],
  [0, 4.5], [0, 0.8], [0.001, 3.5], [0.001, 5],
  [0.001, 0.25], [0.001, 0.9], [0, 4], [0, 1],
  [1, 6], [0, 2], [0, 2], [0, 0.8], [0.1, 0.8],
];

/** The fit in synced JSON, or null when absent or invalid (Android ignores a fit it can't use). */
export function parseFit(json: string | null | undefined): Fit | null {
  if (!json) return null;
  // Each object's raw `version` text, where the engine exposes source text to revivers.
  const versions = new Map<unknown, string | undefined>();
  try {
    // Android reads the top-level `version` as the integer 1, so "1.0" is refused as well.
    let versionSource: string | undefined;
    const o = JSON.parse(json, function (this: unknown, key, value, context?: { source?: string }) {
      if (key === "version") versions.set(this, context?.source);
      if (key === "") versionSource = versions.get(value) ?? (Number.isInteger(value?.version) ? String(value.version) : undefined);
      return value;
    }) as Record<string, unknown>;
    const p = o.parameters;
    if (o.format !== "langocard-fsrs" || o.version !== 1 || versionSource !== "1" || !Array.isArray(p) || p.length !== 21) return null;
    if (!p.every((w, i) => typeof w === "number" && w >= BOUNDS[i][0] && w <= BOUNDS[i][1])) return null;
    const retention = o.desiredRetention;
    if (typeof retention !== "number" || retention < 0.7 || retention > 0.95) return null;
    if (!Number.isInteger(o.reviewCount) || (o.reviewCount as number) < 1000 || (o.reviewCount as number) > 2_147_483_647) return null;
    if (typeof o.fitDate !== "string" || !isOffsetDateTime(o.fitDate)) return null;
    return { parameters: p as number[], retention, reviewCount: o.reviewCount as number, fitDate: o.fitDate };
  } catch {
    return null;
  }
}

/** An ISO-8601 date-time with an offset and a real calendar date, as `OffsetDateTime.parse` accepts. */
function isOffsetDateTime(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:[Zz]|[+-](\d{2}):(\d{2})(?::(\d{2}))?)$/.exec(text);
  if (!m) return false;
  // Offsets range up to ±18:00, as java.time allows.
  const [offsetHours, offsetMinutes, offsetSeconds] = m.slice(7, 10).map((x) => Number(x ?? 0));
  if (offsetMinutes > 59 || offsetSeconds > 59 || offsetHours * 3600 + offsetMinutes * 60 + offsetSeconds > 18 * 3600) return false;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map((x) => Number(x ?? 0));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day &&
    hour <= 23 && minute <= 59 && second <= 59;
}

/** The scheduler Android builds for this fit, or its defaults (90% target recall) without one. */
export function schedulerFor(fit: Fit | null, options: { enableFuzzing?: boolean } = {}): Scheduler {
  return new Scheduler({ parameters: fit?.parameters ?? DEFAULT_PARAMETERS, desiredRetention: fit?.retention ?? DEFAULT_RETENTION, ...options });
}

/** How the active scheduling is described, as on Android's backup page. */
export function schedulingDescription(fit: Fit | null): string {
  return fit
    ? `FSRS · ${Math.trunc(fit.retention * 100)}% target recall · fitted with ${fit.reviewCount} reviews on ${fit.fitDate}`
    : "FSRS defaults · 90% target recall";
}
