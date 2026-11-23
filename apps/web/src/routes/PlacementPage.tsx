import { Link } from "@tanstack/react-router";
import items from "@content/placement-items.json";
import { api } from "@backend/_generated/api";
import { adjustedHits, startingRank, STARTING_RANKS } from "@backend/vocabularyPlacement";
import { Button } from "@/components/ui/button";
import { useTokenMutation, useTokenQuery } from "@/lib/convex";
import { useAsyncAction } from "@/lib/useAsyncAction";

/**
 * The optional vocabulary starting check, as on the phone: 90 words, yes or no, one at a time.
 * Every answer is saved, so it resumes after a reload. Accepting a rank only changes which new
 * words come first; no card is marked known.
 */
export function PlacementPage() {
  const answers = useTokenQuery(api.placement.progress, {});
  const answer = useTokenMutation(api.placement.answer);
  const retake = useTokenMutation(api.placement.retake);
  const accept = useTokenMutation(api.placement.accept);
  const { run, pending, error } = useAsyncAction();
  if (answers === undefined) return <p className="text-muted">Loading…</p>;
  const done = answers.length >= items.length;
  return (
    <section className="max-w-2xl space-y-5">
      <h1 className="font-semibold text-3xl">Vocabulary starting check</h1>
      {!done ? (
        <>
          <p className="text-sm text-muted">{answers.length} / {items.length} · about 5 minutes total</p>
          <p>Do you know a meaning of this French word? Some words are invented. Choose No if unsure.</p>
          <p className="font-semibold text-4xl" aria-live="polite">{items[answers.length].word}</p>
          <div className="flex gap-2">
            <Button disabled={pending} onClick={() => void run(() => answer({ index: answers.length, known: true }))}>Yes, I know it</Button>
            <Button variant="outline" disabled={pending} onClick={() => void run(() => answer({ index: answers.length, known: false }))}>No / unsure</Button>
          </div>
          <p className="text-sm text-muted">Your answers are saved as you go; come back any time to continue.</p>
        </>
      ) : (
        <Result answers={answers} pending={pending}
          onAccept={(rank) => void run(() => accept({ rank }))} onRetake={() => void run(() => retake({}))} />
      )}
      {error && <p role="alert" className="text-danger">{error}</p>}
      <p className="text-xs text-muted">
        The items are 60 lemmas from the Lexique 3.83 frequency reference and 30 invented control words, under CC BY-SA 4.0.
        They are not LexTALE-FR and have not been independently validated. See <Link to="/sources" className="underline">Content sources</Link>.
      </p>
    </section>
  );
}

function Result({ answers, pending, onAccept, onRetake }: {
  answers: boolean[]; pending: boolean; onAccept: (rank: number) => void; onRetake: () => void;
}) {
  const suggested = startingRank(items, answers);
  const hits = adjustedHits(items, answers);
  return (
    <div className="space-y-3">
      <p className="text-xl">Suggested starting rank: {suggested.toLocaleString("en")}</p>
      <p className="text-sm">Adjusted recognition by band: {hits.map((h) => `${h.toFixed(1)} / 20`).join(", ")}</p>
      <p className="text-sm text-muted">
        This unvalidated estimate changes only which new words appear first. No cards are marked known. Choose a rank to
        save; you can change it in Packs.
      </p>
      <div className="flex flex-wrap gap-2">
        {STARTING_RANKS.map((rank) => (
          <Button key={rank} variant={rank === suggested ? "default" : "outline"} disabled={pending} onClick={() => onAccept(rank)}>
            Start at rank {rank.toLocaleString("en")}
          </Button>
        ))}
        <Button variant="ghost" disabled={pending} onClick={onRetake}>Retake check</Button>
      </div>
    </div>
  );
}
