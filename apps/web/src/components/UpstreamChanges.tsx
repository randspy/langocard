import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@backend/_generated/api";
import { CONTENT_FIELDS, type EntryContent } from "@backend/entryRules";
import { Button } from "@/components/ui/button";
import { originLabel } from "@/lib/library";

export type UpstreamChange = FunctionReturnType<typeof api.entries.upstreamChanges>[number];
export type Choice = "keepMine" | "takeTheirs";

const FIELD_LABELS: Record<keyof EntryContent, string> = {
  word: "Word", english: "English", definition: "Definition", example: "Example", topic: "Topic",
  lemma: "Lemma", rank: "Rank", sourceUrl: "Source", license: "License",
};

export function UpstreamChanges({ changes, onResolve }: { changes: UpstreamChange[]; onResolve: (entryId: string, choice: Choice) => Promise<void> }) {
  if (changes.length === 0) {
    return <p className="text-muted">No upstream changes. Edited entries whose shipped content changes after a content update appear here.</p>;
  }
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">
        These entries were edited, and the shipped content changed afterwards. Keep your wording,
        or take the new shipped version (the entry then follows future content updates again).
      </p>
      {changes.map((change) => <Change key={change.entryId} change={change} onResolve={onResolve} />)}
    </div>
  );
}

function Change({ change, onResolve }: { change: UpstreamChange; onResolve: (entryId: string, choice: Choice) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fields = CONTENT_FIELDS.filter((field) => change.mine[field] !== change.theirs[field]);
  const resolve = async (choice: Choice) => {
    setBusy(true);
    setError(null);
    try { await onResolve(change.entryId, choice); } catch { setError("Couldn't save the choice. Try again."); } finally { setBusy(false); }
  };

  return (
    <article className="rounded-lg border border-line bg-white" aria-label={change.mine.word}>
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <Link to="/entries/$entryId" params={{ entryId: change.entryId }} className="font-serif text-xl hover:underline">{change.mine.word}</Link>
        <span className="text-sm text-muted">{originLabel(change.origin)}</span>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void resolve("keepMine")}>Keep mine</Button>
          <Button size="sm" disabled={busy} onClick={() => void resolve("takeTheirs")}>Take theirs</Button>
        </div>
      </header>
      <table className="w-full table-fixed text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="w-28 px-4 py-2 font-medium">Field</th>
            <th className="px-4 py-2 font-medium">Mine</th>
            <th className="px-4 py-2 font-medium">Theirs (shipped)</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => (
            <tr key={field} className="border-t border-line/60 align-top">
              <th scope="row" className="px-4 py-2 text-left font-medium">{FIELD_LABELS[field]}</th>
              <td className="px-4 py-2 bg-amber-50/60">{String(change.mine[field] ?? "—")}</td>
              <td className="px-4 py-2 bg-emerald-50/60">{String(change.theirs[field] ?? "—")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {error && <p role="alert" className="px-4 pb-3 text-sm text-danger">{error}</p>}
    </article>
  );
}
