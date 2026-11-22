import { useCallback, useEffect, useRef, useState } from "react";
import { textOf, answerOf } from "@backend/entryRules";
import { usePracticeClock } from "@/lib/usePracticeClock";
import type { Rating } from "@backend/fsrs";
import { Button } from "@/components/ui/button";
import { GENDER_TAGS } from "@/lib/library";
import { intervals, type AnswerResult, type StudyCard } from "@/lib/study";
import { errorMessage } from "@/lib/useAsyncAction";

const RATINGS: [Rating, string][] = [["AGAIN", "Again"], ["HARD", "Hard"], ["GOOD", "Good"], ["EASY", "Easy"]];

type Props = {
  /** Fetches the card to show next, or null when nothing is due. Called once per card, never subscribed. */
  fetchNext: (pending: string[]) => Promise<StudyCard | null>;
  answer: (card: StudyCard, rating: Rating) => Promise<AnswerResult>;
  clock: () => number;
  tick?: (checkpoint: { day: string; seconds: number }) => Promise<unknown>;
};

type State =
  | { kind: "loading" }
  | { kind: "card"; card: StudyCard; revealed: boolean; saving: boolean }
  | { kind: "done" }
  | { kind: "error"; message: string };

/**
 * One sitting of review: show a due card, reveal it, rate it, then fetch the next one.
 * Reading cards show the French word in its sentence; the learner recalls the meaning.
 */
const noTick = async () => {};

export function StudySession({ fetchNext, answer, clock, tick = noTick }: Props) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const pending = useRef(new Set<string>());
  const [reviews, setReviews] = useState(0);
  const [recalled, setRecalled] = useState(0);
  const { seconds, flush, error: timeError } = usePracticeClock(state.kind === "card", tick, clock);
  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      await flush();
      const card = await fetchNext([...pending.current]);
      setState(card ? { kind: "card", card, revealed: false, saving: false } : { kind: "done" });
    } catch (e) {
      setState({ kind: "error", message: errorMessage(e) });
    }
  }, [fetchNext, flush]);
  // Start once per mounted sitting; timer state changes must not replace the shown card.
  const start = useRef(load);
  useEffect(() => { void start.current(); }, []);

  if (state.kind === "loading") return <p className="text-muted">Loading…</p>;
  if (state.kind === "done") return (
    <div role="status" className="space-y-2">
      <p className="text-lg">Session complete.</p>
      <p>{Math.floor(seconds / 60)}m {seconds % 60}s practised · {reviews} assessments · {recalled} recalled</p>
      {timeError && <p role="alert">{timeError}</p>}
    </div>
  );
  if (state.kind === "error") {
    return (
      <div className="space-y-3">
        <p role="alert" className="text-danger">{state.message}</p>
        <Button variant="outline" onClick={() => void load()}>Try again</Button>
      </div>
    );
  }

  const { card, revealed, saving } = state;
  const { entry, example } = card;
  const rate = async (rating: Rating) => {
    setState({ ...state, saving: true });
    try {
      // A stale card (reviewed on the phone meanwhile) is simply skipped: fetch again.
      const result = await answer(card, rating);
      if (result.status === "ok") {
        pending.current.delete(card.key);
        if (rating === "AGAIN" || card.card === null) pending.current.add(card.key);
        setReviews((n) => n + 1);
        if (rating !== "AGAIN") setRecalled((n) => n + 1);
      }
      await load();
    } catch (e) {
      setState({ kind: "error", message: errorMessage(e) });
    }
  };
  const previews = revealed ? intervals(card.card, clock()) : null;
  const word = entry.gender ? `${entry.word} (${GENDER_TAGS[entry.gender]})` : entry.word;
  return (
    <article className="max-w-2xl space-y-6" aria-label="Study card">
      {timeError && <p role="alert">{timeError}</p>}
      <Button variant="outline" disabled={saving} onClick={() => {
        setState({ ...state, saving: true });
        void flush().then(() => setState({ kind: "done" })).catch((e) => setState({ kind: "error", message: errorMessage(e) }));
      }}>End session</Button>
      <p className="text-sm uppercase tracking-wide text-muted">Read</p>
      <div className="space-y-3">
        <p className="font-semibold text-3xl">{entry.word}</p>
        <p className="text-lg">{textOf(example)}</p>
        {!revealed && <p className="text-sm text-muted">Recall the meaning before revealing.</p>}
      </div>
      {revealed && (
        <div className="space-y-2 border-t border-line pt-4">
          <p className="font-semibold text-2xl">{word}</p>
          {answerOf(example).toLowerCase() !== entry.word.toLowerCase() && <p>In this sentence: {answerOf(example)}</p>}
          <p className="text-lg font-medium">{entry.english}</p>
          <p>{entry.definition}</p>
        </div>
      )}
      {!revealed
        ? <Button onClick={() => setState({ ...state, revealed: true })}>Reveal answer</Button>
        : (
          <div className="grid grid-cols-4 gap-2" role="group" aria-label="Rate your recall">
            {RATINGS.map(([rating, label]) => (
              <Button key={rating} variant="outline" disabled={saving} onClick={() => void rate(rating)} className="h-14 flex-col gap-0">
                <span className="font-bold">{label}</span>
                <span className="text-xs text-muted">~{previews![rating]}</span>
              </Button>
            ))}
          </div>
        )}
    </article>
  );
}
