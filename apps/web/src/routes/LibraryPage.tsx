import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "@backend/_generated/api";
import { LibraryView } from "@/components/LibraryView";
import { useNow } from "@/lib/useNow";

export function LibraryPage() {
  const search = useSearch({ from: "/" });
  const navigate = useNavigate({ from: "/" });
  const library = useQuery(api.library.list);
  const now = useNow();
  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-serif text-3xl">Library</h1>
        <Link to="/entries/new" className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper hover:bg-ink/85">New entry</Link>
      </div>
      {library === undefined
        ? <p className="text-muted">Loading the library…</p>
        : <LibraryView entries={library.entries} search={search} now={now}
            onSearch={(next) => void navigate({ search: next, replace: true })}
            entryLink={(entry) => <Link to="/entries/$entryId" params={{ entryId: entry.entryId }} className="hover:underline">{entry.word}</Link>}
          />}
    </>
  );
}
