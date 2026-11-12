import { useNavigate, useSearch } from "@tanstack/react-router";
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
      <h1 className="mb-6 font-serif text-3xl">Library</h1>
      {library === undefined
        ? <p className="text-muted">Loading the library…</p>
        : <LibraryView entries={library.entries} search={search} now={now} onSearch={(next) => void navigate({ search: next, replace: true })} />}
    </>
  );
}
