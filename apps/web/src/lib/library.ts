import type { FunctionReturnType } from "convex/server";
import type { api } from "@backend/_generated/api";
import type { Skill, SkillSummary } from "@backend/library";

export type LibraryEntry = FunctionReturnType<typeof api.library.list>["entries"][number];
export const SKILLS: { skill: Skill; label: string }[] = [
  { skill: "Reading", label: "Read" },
  { skill: "Listening", label: "Listen" },
  { skill: "Production", label: "Speak" },
];

// ---- Search params (the Library's filters live in the URL) ----

const ORIGINS = ["bundled", "pack", "personal"] as const;
const PACK = ["installed", "notInstalled"] as const;
const TOPICS = ["daily", "culture", "news"] as const;
const STATUSES = ["active", "all", "deleted", "edited", "upstream", "suspended", "retired"] as const;
const RANKS = ["1-2500", "2501-7000", "7001+", "unranked"] as const;

export type LibrarySearch = {
  q?: string;
  origin?: (typeof ORIGINS)[number];
  pack?: (typeof PACK)[number];
  topic?: (typeof TOPICS)[number];
  /** Defaults to "active" (everything not deleted). */
  status?: (typeof STATUSES)[number];
  rank?: (typeof RANKS)[number];
};

export const FILTER_OPTIONS = {
  origin: [["bundled", "Built-in"], ["pack", "Pack"], ["personal", "Personal"]],
  pack: [["installed", "Installed"], ["notInstalled", "Not installed"]],
  topic: [["daily", "Daily"], ["culture", "Culture"], ["news", "News"]],
  status: [["active", "Active"], ["all", "All, including deleted"], ["deleted", "Deleted"], ["edited", "Edited"], ["upstream", "Upstream changed"], ["suspended", "Suspended"], ["retired", "Retired"]],
  rank: [["1-2500", "Ranks 1–2,500"], ["2501-7000", "Ranks 2,501–7,000"], ["7001+", "Ranks 7,001+"], ["unranked", "Unranked"]],
} as const satisfies Record<Exclude<keyof LibrarySearch, "q">, readonly (readonly [string, string])[]>;

function pick<T extends string>(allowed: readonly T[], value: unknown): T | undefined {
  return allowed.includes(value as T) ? (value as T) : undefined;
}

/** Keeps only recognised filter values, so a hand-edited URL can't break the page. */
export function validateSearch(raw: Record<string, unknown>): LibrarySearch {
  const search: LibrarySearch = {
    q: typeof raw.q === "string" && raw.q.trim() ? raw.q : undefined,
    origin: pick(ORIGINS, raw.origin),
    pack: pick(PACK, raw.pack),
    topic: pick(TOPICS, raw.topic),
    status: pick(STATUSES, raw.status),
    rank: pick(RANKS, raw.rank),
  };
  return Object.fromEntries(Object.entries(search).filter(([, v]) => v !== undefined)) as LibrarySearch;
}

// ---- Per-skill status ----

export type SkillStatus =
  | { kind: "new" }
  | { kind: "suspended"; until: number }
  | { kind: "paused"; until: number }
  | { kind: "due"; due: number }
  | { kind: "scheduled"; due: number };

/** Manual suspension wins over the leech pause, which wins over the schedule. */
export function skillStatus(summary: SkillSummary | undefined, now: number): SkillStatus {
  if (summary && summary.suspendedUntil > now) return { kind: "suspended", until: summary.suspendedUntil };
  if (summary && summary.pausedUntil > now) return { kind: "paused", until: summary.pausedUntil };
  if (!summary || summary.due === null) return { kind: "new" };
  return summary.due <= now ? { kind: "due", due: summary.due } : { kind: "scheduled", due: summary.due };
}

// ---- Filtering ----

/** Lower-case and strip accents so "eleve" finds "élève". */
export function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function inRank(rank: number | null, band: LibrarySearch["rank"]): boolean {
  switch (band) {
    case undefined: return true;
    case "unranked": return rank === null;
    case "1-2500": return rank !== null && rank <= 2500;
    case "2501-7000": return rank !== null && rank > 2500 && rank <= 7000;
    case "7001+": return rank !== null && rank > 7000;
  }
}

function hasStatus(e: LibraryEntry, status: LibrarySearch["status"], now: number): boolean {
  switch (status ?? "active") {
    case "all": return true;
    case "active": return !e.deleted;
    case "deleted": return e.deleted;
    case "edited": return e.edited;
    case "upstream": return e.upstreamChanged;
    case "retired": return e.retired;
    case "suspended": return SKILLS.some(({ skill }) => skillStatus(e.skills[skill], now).kind === "suspended");
  }
}

function originGroup(origin: string): "bundled" | "pack" | "personal" {
  return origin.startsWith("pack:") ? "pack" : origin === "personal" ? "personal" : "bundled";
}

/** Applies the Library filters; results are ordered by frequency rank, then word. */
export function filterLibrary(entries: LibraryEntry[], search: LibrarySearch, now: number): LibraryEntry[] {
  const q = search.q ? normalize(search.q.trim()) : "";
  return entries
    .filter((e) =>
      (!q || [e.word, e.lemma, e.english].some((field) => normalize(field).includes(q))) &&
      (!search.origin || originGroup(e.origin) === search.origin) &&
      (!search.pack || (search.pack === "installed") === e.installed) &&
      (!search.topic || e.topic === search.topic) &&
      inRank(e.rank, search.rank) &&
      hasStatus(e, search.status, now))
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.word.localeCompare(b.word, "fr"));
}

export function originLabel(origin: string): string {
  if (origin === "bundled") return "Built-in";
  if (origin === "personal") return "Personal";
  const pack = origin.slice("pack:".length);
  if (pack.startsWith("fr-source-everyday")) return "Everyday pack";
  if (pack.startsWith("fr-source-extended")) return "Extended pack";
  return pack;
}

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
export function formatDate(ms: number): string {
  return dateFormat.format(ms);
}
