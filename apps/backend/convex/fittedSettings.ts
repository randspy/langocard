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
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    const p = o.parameters;
    if (o.format !== "langocard-fsrs" || o.version !== 1 || !Array.isArray(p) || p.length !== 21) return null;
    if (!p.every((w, i) => typeof w === "number" && w >= BOUNDS[i][0] && w <= BOUNDS[i][1])) return null;
    const retention = o.desiredRetention;
    if (typeof retention !== "number" || retention < 0.7 || retention > 0.95) return null;
    if (!Number.isInteger(o.reviewCount) || (o.reviewCount as number) < 1000) return null;
    if (typeof o.fitDate !== "string" || Number.isNaN(Date.parse(o.fitDate))) return null;
    return { parameters: p as number[], retention, reviewCount: o.reviewCount as number, fitDate: o.fitDate };
  } catch {
    return null;
  }
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
