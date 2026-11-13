import type { FunctionReturnType } from "convex/server";
import type { api } from "@backend/_generated/api";
import { SKILLS, type Skill, type SkillSummary } from "@backend/library";
import { SUSPENDED_INDEFINITELY } from "@backend/merge";

export type LibraryEntry = FunctionReturnType<typeof api.library.list>["entries"][number];

/** The skills in display order, with the short names the learner sees on the phone. */
export { SKILLS };
export const SKILL_LABELS: Record<Skill, string> = { Reading: "Read", Listening: "Listen", Production: "Speak" };

// ---- Search params (the Library's filters live in the URL) ----

/**
 * Every Library filter: its label, what "no choice" means, and its values. This is the
 * single source for the select boxes, URL validation and the `LibrarySearch` type.
 */
export const FILTERS = {
  origin: { label: "Origin", unset: "Any origin", options: [["bundled", "Built-in"], ["pack", "Pack"], ["personal", "Personal"]] },
  pack: { label: "Pack", unset: "Any pack", options: [["installed", "Installed"], ["notInstalled", "Not installed"]] },
  topic: { label: "Topic", unset: "Any topic", options: [["daily", "Daily"], ["culture", "Culture"], ["news", "News"]] },
  status: {
    label: "Status",
    unset: "Active",
    options: [["all", "All, including deleted"], ["deleted", "Deleted"], ["edited", "Edited"], ["upstream", "Upstream changed"], ["suspended", "Suspended"], ["retired", "Retired"]],
  },
  rank: { label: "Rank", unset: "Any rank", options: [["1-2500", "Ranks 1–2,500"], ["2501-7000", "Ranks 2,501–7,000"], ["7001+", "Ranks 7,001+"], ["unranked", "Unranked"]] },
} as const;

export type Filter = keyof typeof FILTERS;
type FilterValue<F extends Filter> = (typeof FILTERS)[F]["options"][number][0];

/** An absent filter doesn't narrow the list; an absent status shows every entry that isn't deleted. */
export type LibrarySearch = { q?: string } & { [F in Filter]?: FilterValue<F> };

/** Keeps only recognised filter values, so a hand-edited URL can't break the page. */
export function validateSearch(raw: Record<string, unknown>): LibrarySearch {
  const search: Record<string, string> = {};
  if (typeof raw.q === "string" && raw.q.trim()) search.q = raw.q;
  for (const filter of Object.keys(FILTERS) as Filter[]) {
    const value = raw[filter];
    if (FILTERS[filter].options.some(([allowed]) => allowed === value)) search[filter] = value as string;
  }
  return search as LibrarySearch;
}

// ---- Per-skill status ----

export type SkillStatus =
  | { kind: "new" }
  /** `until: null` means suspended until the learner resumes it. */
  | { kind: "suspended"; until: number | null }
  | { kind: "paused"; until: number }
  | { kind: "due"; due: number }
  | { kind: "scheduled"; due: number };

/** Manual suspension wins over the leech pause, which wins over the schedule. */
export function skillStatus(summary: Omit<SkillSummary, "state"> | undefined, now: number): SkillStatus {
  if (summary && summary.suspendedUntil > now) {
    return { kind: "suspended", until: summary.suspendedUntil >= SUSPENDED_INDEFINITELY ? null : summary.suspendedUntil };
  }
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
  switch (status) {
    case undefined: return !e.deleted;
    case "all": return true;
    case "deleted": return e.deleted;
    case "edited": return e.edited;
    case "upstream": return e.upstreamChanged;
    case "retired": return e.retired;
    case "suspended": return SKILLS.some((skill) => skillStatus(e.skills[skill], now).kind === "suspended");
  }
}

/** Origins are stored as "bundled", "personal" or "pack:<pack id>". */
function originGroup(origin: string): FilterValue<"origin"> {
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
  if (originGroup(origin) !== "pack") return origin === "personal" ? "Personal" : "Built-in";
  const pack = origin.slice("pack:".length);
  if (pack.startsWith("fr-source-everyday")) return "Everyday pack";
  if (pack.startsWith("fr-source-extended")) return "Extended pack";
  return pack;
}

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
export function formatDate(ms: number): string {
  return dateFormat.format(ms);
}
