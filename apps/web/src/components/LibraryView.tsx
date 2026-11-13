import { useState } from "react";
import { EntryFlags, SkillBadge } from "@/components/EntryBadges";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import {
  FILTERS, GENDER_TAGS, SKILLS, SKILL_LABELS, filterLibrary, originLabel, skillStatus, skillsOf,
  type Filter, type LibraryEntry, type LibrarySearch,
} from "@/lib/library";

const PAGE = 200;

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
        {(Object.keys(FILTERS) as Filter[]).map((filter) => (
          <Select
            key={filter}
            aria-label={FILTERS[filter].label}
            value={search[filter] ?? ""}
            onChange={(e) => set({ [filter]: e.target.value || undefined })}
          >
            <option value="">{FILTERS[filter].unset}</option>
            {FILTERS[filter].options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
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
              {SKILLS.map((skill) => <th key={skill} className="px-3 py-2 font-medium">{SKILL_LABELS[skill]}</th>)}
            </tr>
          </thead>
          <tbody>
            {matches.slice(0, shown).map((entry) => (
              <tr key={entry.entryId} className="border-b border-line/60 last:border-0 hover:bg-paper/60">
                <td className="px-3 py-2">
                  <span className={entry.deleted ? "text-muted line-through" : "font-serif text-base"}>
                    {entryLink ? entryLink(entry) : entry.word}
                  </span>
                  {entry.gender && <span className="ml-1.5 text-xs text-muted" title={entry.gender}>{GENDER_TAGS[entry.gender]}</span>}
                  <EntryFlags entry={entry} className="ml-2" />
                </td>
                <td className="px-3 py-2 text-muted">{entry.english}</td>
                <td className="px-3 py-2 capitalize">{entry.topic}</td>
                <td className="px-3 py-2 text-right tabular-nums">{entry.rank?.toLocaleString("en-GB") ?? "—"}</td>
                <td className="px-3 py-2">
                  {originLabel(entry.origin)}
                  {!entry.installed && <span className="text-muted"> · not installed</span>}
                </td>
                {SKILLS.map((skill) => (
                  <td key={skill} className="px-3 py-2">
                    {skillsOf(entry).includes(skill)
                      ? <SkillBadge label={SKILL_LABELS[skill]} status={skillStatus(entry.skills[skill], now)} />
                      : <span className="text-muted" title={`${SKILL_LABELS[skill]}: not a noun`}>—</span>}
                  </td>
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
