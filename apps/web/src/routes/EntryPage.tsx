import { Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@backend/_generated/api";
import { contentOf } from "@backend/entryRules";
import { EntryForm, messageOf } from "@/components/EntryForm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { originLabel } from "@/lib/library";

export function EntryPage() {
  const { entryId } = useParams({ from: "/entries/$entryId" });
  const entry = useQuery(api.entries.get, { entryId });
  const update = useMutation(api.entries.update);
  const remove = useMutation(api.entries.remove);
  const restore = useMutation(api.entries.restore);
  const [error, setError] = useState<string | null>(null);

  if (entry === undefined) return <p className="text-muted">Loading…</p>;
  if (entry === null) return <NotFound />;

  const toggleDeleted = async () => {
    setError(null);
    try {
      if (entry.deleted) await restore({ entryId });
      else await remove({ entryId });
    } catch (e) {
      setError(messageOf(e));
    }
  };

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className="space-y-6">
        <BackLink />
        <header className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className={entry.deleted ? "font-serif text-3xl text-muted line-through" : "font-serif text-3xl"}>{entry.word}</h1>
            {entry.deleted && <Badge tone="danger">Deleted</Badge>}
            {entry.edited && <Badge>Edited</Badge>}
            {entry.upstreamChanged && <Badge tone="due">Upstream changed</Badge>}
            {entry.retired && <Badge>Retired</Badge>}
          </div>
          <p className="text-sm text-muted">
            {originLabel(entry.origin)}
            {entry.rank !== null && <> · frequency rank {entry.rank.toLocaleString("en-GB")}</>}
            {entry.sourceUrl && <> · <a className="underline" href={entry.sourceUrl} target="_blank" rel="noreferrer">source</a></>}
            {entry.license && <> · {entry.license}</>}
          </p>
          <div className="flex items-center gap-3">
            <Button variant={entry.deleted ? "outline" : "danger"} size="sm" onClick={() => void toggleDeleted()}>
              {entry.deleted ? "Restore" : "Delete"}
            </Button>
            <span className="text-xs text-muted">
              {entry.deleted ? "Deleted entries aren't studied. Progress is kept." : "Deleting hides it from study and keeps its progress."}
            </span>
          </div>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        </header>
        {entry.deleted && <p className="rounded-md bg-line/50 p-3 text-sm">Restore this entry to edit it.</p>}
        <EntryForm
          key={`${entry.editedAt}-${entry.deletedAt}`}
          entryId={entry.entryId}
          initial={contentOf(entry)}
          submitLabel="Save changes"
          disabled={entry.deleted}
          onSubmit={async (content) => { await update({ entryId, ...content }); }}
        />
      </section>
    </div>
  );
}

function BackLink() {
  return <Link to="/" className="text-sm text-muted hover:text-ink">← Library</Link>;
}

function NotFound() {
  return (
    <div className="space-y-4">
      <BackLink />
      <h1 className="font-serif text-3xl">Entry not found</h1>
    </div>
  );
}
