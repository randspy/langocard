import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import {
  FILTER_OPTIONS, SKILLS, filterLibrary, formatDate, originLabel, skillStatus,
  type LibraryEntry, type LibrarySearch, type SkillStatus,
} from "@/lib/library";

const PAGE = 200;
const FILTER_LABELS: Record<keyof typeof FILTER_OPTIONS, string> = {
  origin: "Origin", pack: "Pack", topic: "Topic", status: "Status", rank: "Rank",
};

type Props = {
  entries: LibraryEntry[];
  search: LibrarySearch;
  onSearch: (next: LibrarySearch) => void;
  now: number;
  /** Renders the link to an entry's page; plain text when absent. */
  entryLink?: (entry: LibraryEntry) => React.ReactNode;
};

export function LibraryView({ entries, search, onSearch, now, entryLink }: Props) {
  const [shown, setShown] = useState(PAGE);
  const matches = filterLibrary(entries, search, now);
  const set = (patch: Partial<LibrarySearch>) => { setShown(PAGE); onSearch({ ...search, ...patch }); };
  const filtered = Object.keys(search).some((key) => key !== "q");

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <Input
            type="search"
            aria-label="Search words, lemmas and English"
            placeholder="Search words, lemmas and English…"
            value={search.q ?? ""}
            onChange={(e) => set({ q: e.target.value || undefined })}
          />
        </div>
        {(Object.keys(FILTER_OPTIONS) as (keyof typeof FILTER_OPTIONS)[]).map((key) => (
          <Select
            key={key}
            aria-label={FILTER_LABELS[key]}
            value={search[key] ?? ""}
            onChange={(e) => set({ [key]: e.target.value || undefined })}
          >
            <option value="">{key === "status" ? "Active" : `Any ${FILTER_LABELS[key].toLowerCase()}`}</option>
            {FILTER_OPTIONS[key].filter(([value]) => !(key === "status" && value === "active")).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </Select>
        ))}
        {filtered && <Button variant="ghost" size="sm" onClick={() => { setShown(PAGE); onSearch(search.q ? { q: search.q } : {}); }}>Clear filters</Button>}
      </div>

      <p className="text-sm text-muted" aria-live="polite">
        {matches.length.toLocaleString("en-GB")} of {entries.length.toLocaleString("en-GB")} entries
      </p>

      <div className="overflow-x-auto rounded-lg border border-line bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Word</th>
              <th className="px-3 py-2 font-medium">English</th>
              <th className="px-3 py-2 font-medium">Topic</th>
              <th className="px-3 py-2 text-right font-medium">Rank</th>
              <th className="px-3 py-2 font-medium">Origin</th>
              {SKILLS.map(({ label }) => <th key={label} className="px-3 py-2 font-medium">{label}</th>)}
            </tr>
          </thead>
          <tbody>
            {matches.slice(0, shown).map((entry) => (
              <tr key={entry.entryId} className="border-b border-line/60 last:border-0 hover:bg-paper/60">
                <td className="px-3 py-2">
                  <span className={entry.deleted ? "text-muted line-through" : "font-serif text-base"}>
                    {entryLink ? entryLink(entry) : entry.word}
                  </span>
                  <EntryFlags entry={entry} />
                </td>
                <td className="px-3 py-2 text-muted">{entry.english}</td>
                <td className="px-3 py-2 capitalize">{entry.topic}</td>
                <td className="px-3 py-2 text-right tabular-nums">{entry.rank?.toLocaleString("en-GB") ?? "—"}</td>
                <td className="px-3 py-2">
                  {originLabel(entry.origin)}
                  {!entry.installed && <span className="text-muted"> · not installed</span>}
                </td>
                {SKILLS.map(({ skill, label }) => (
                  <td key={skill} className="px-3 py-2"><SkillBadge label={label} status={skillStatus(entry.skills[skill], now)} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {matches.length === 0 && <p className="p-6 text-center text-muted">No entries match these filters.</p>}
      </div>
      {matches.length > shown && (
        <Button variant="outline" onClick={() => setShown(shown + PAGE)}>Show {Math.min(PAGE, matches.length - shown)} more</Button>
      )}
    </section>
  );
}

function EntryFlags({ entry }: { entry: LibraryEntry }) {
  const flags = [
    entry.deleted && ["Deleted", "danger"],
    entry.edited && ["Edited", "neutral"],
    entry.upstreamChanged && ["Upstream changed", "due"],
    entry.retired && ["Retired", "neutral"],
  ].filter(Boolean) as [string, "danger" | "neutral" | "due"][];
  return flags.map(([label, tone]) => <Badge key={label} tone={tone} className="ml-2">{label}</Badge>);
}

export function SkillBadge({ status, label }: { status: SkillStatus; label: string }) {
  switch (status.kind) {
    case "new": return <Badge tone="new" title={`${label}: new`}>New</Badge>;
    case "due": return <Badge tone="due" title={`${label}: due since ${formatDate(status.due)}`}>Due</Badge>;
    case "scheduled": return <Badge tone="scheduled" title={`${label}: due ${formatDate(status.due)}`}>{formatDate(status.due)}</Badge>;
    case "paused": return <Badge tone="paused" title={`${label}: paused after repeated misses until ${formatDate(status.until)}`}>Paused</Badge>;
    case "suspended": return <Badge tone="suspended" title={`${label}: suspended`}>Suspended</Badge>;
  }
}
