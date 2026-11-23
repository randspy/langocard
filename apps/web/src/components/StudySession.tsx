import { useCallback, useEffect, useRef, useState } from "react";
import { clozeOf, textOf, answerOf } from "@backend/entryRules";
import { MATCH_LABEL, MATCH_RATING, typedAnswer, type AnswerPart, type TypedAnswer } from "@backend/typedAnswer";
import { Input } from "@/components/ui/input";
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
  | {
    kind: "card"; card: StudyCard; revealed: boolean; saving: boolean;
    /** Production: what the learner typed, its frozen comparison and the rating to confirm. */
    typed: string; comparison: TypedAnswer | null; selected: Rating | null;
  }
  | { kind: "ending" }
  | { kind: "done" }
  | { kind: "error"; message: string; retry: "load" | "finish" };

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
  const { seconds, flush, stop, error: timeError } = usePracticeClock(state.kind === "card", tick, clock);
  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      await flush();
      const card = await fetchNext([...pending.current]);
      setState(card ? { kind: "card", card, revealed: false, saving: false, typed: "", comparison: null, selected: null } : { kind: "done" });
    } catch (e) {
      setState({ kind: "error", message: errorMessage(e), retry: "load" });
    }
  }, [fetchNext, flush]);
  const finish = async () => {
    stop();
    setState({ kind: "ending" });
    try {
      await flush();
      setState({ kind: "done" });
    } catch (e) {
      setState({ kind: "error", message: errorMessage(e), retry: "finish" });
    }
  };
  // Start once per mounted sitting; timer state changes must not replace the shown card.
  const start = useRef(load);
  useEffect(() => { void start.current(); }, []);

  if (state.kind === "loading") return <p className="text-muted">Loading…</p>;
  if (state.kind === "ending") return <p className="text-muted">Saving practice time…</p>;
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
        <Button variant="outline" onClick={() => void (state.retry === "finish" ? finish() : load())}>Try again</Button>
      </div>
    );
  }

  const { card, revealed, saving, typed, comparison, selected } = state;
  const { entry, example } = card;
  const production = card.skill === "Production";
  // Reveal freezes the typed feedback and its suggested rating; an empty answer suggests nothing.
  const reveal = () => {
    const check = production ? typedAnswer(typed, example, entry.gender !== null, true) : null;
    setState({ ...state, revealed: true, comparison: check, selected: check ? MATCH_RATING[check.match] : null });
  };
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
      setState({ kind: "error", message: errorMessage(e), retry: "load" });
    }
  };
  const previews = revealed ? intervals(card.card, clock()) : null;
  const word = entry.gender ? `${entry.word} (${GENDER_TAGS[entry.gender]})` : entry.word;
  return (
    <article className="max-w-2xl space-y-6" aria-label="Study card">
      {timeError && <p role="alert">{timeError}</p>}
      <Button variant="outline" disabled={saving} onClick={() => void finish()}>End session</Button>
      <p className="text-sm uppercase tracking-wide text-muted">{production ? "Speak" : "Read"}</p>
      {production ? (
        <div className="space-y-3">
          <p className="font-semibold text-3xl">{entry.english}</p>
          <p className="text-xl">{clozeOf(example)}</p>
          {!revealed && (
            <Input aria-label="Your answer (optional)" placeholder="Your answer (optional)" value={typed} autoComplete="off"
              autoCapitalize="none" spellCheck={false} maxLength={200}
              onChange={(e) => setState({ ...state, typed: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") reveal(); }} />
          )}
          {!revealed && (
            <p className="text-sm text-muted">
              Say the missing French aloud, or type it. Include the article for nouns and use the form that fits the
              sentence. Right word, wrong article? Rate Hard.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="font-semibold text-3xl">{entry.word}</p>
          <p className="text-lg">{textOf(example)}</p>
          {!revealed && <p className="text-sm text-muted">Recall the meaning before revealing.</p>}
        </div>
      )}
      {revealed && comparison && <Feedback answer={comparison} />}
      {revealed && (
        <div className="space-y-2 border-t border-line pt-4">
          <p className="font-semibold text-2xl">{word}</p>
          {answerOf(example).toLowerCase() !== entry.word.toLowerCase() && <p>In this sentence: {answerOf(example)}</p>}
          <p className="text-lg font-medium">{entry.english}</p>
          <p>{entry.definition}</p>
          {production && <p>{textOf(example)}</p>}
        </div>
      )}
      {!revealed
        ? <Button onClick={reveal}>Reveal answer</Button>
        : (
          <div className="space-y-2">
            <div className="grid grid-cols-4 gap-2" role="group" aria-label="Rate your recall">
              {RATINGS.map(([rating, label]) => (
                // With typed feedback the buttons choose the rating to confirm; otherwise they rate directly.
                <Button key={rating} variant={comparison && selected === rating ? "default" : "outline"} disabled={saving}
                  aria-pressed={comparison ? selected === rating : undefined}
                  onClick={() => (comparison ? setState({ ...state, selected: rating }) : void rate(rating))} className="h-14 flex-col gap-0">
                  <span className="font-bold">{label}</span>
                  <span className="text-xs">~{previews![rating]}</span>
                </Button>
              ))}
            </div>
            {comparison && selected && (
              <Button className="w-full" disabled={saving} onClick={() => void rate(selected)}>Confirm rating</Button>
            )}
          </div>
        )}
    </article>
  );
}

/** Both answers, emphasising the characters that differ, as the phone shows them. */
function Feedback({ answer }: { answer: TypedAnswer }) {
  const alternative = answer.match === "Alternative";
  const line = (label: string, parts: AnswerPart[]) => (
    <p>
      {label}:{" "}
      {parts.map((part, i) => part.marked
        ? <mark key={i} className="rounded-sm bg-danger/15 font-bold text-ink">{part.text}</mark>
        : <span key={i}>{part.text}</span>)}
    </p>
  );
  return (
    <div className="space-y-1" aria-label="Your answer">
      <p className="font-semibold text-lg">{MATCH_LABEL[answer.match]}</p>
      {line("You typed", answer.typedParts)}
      {line(alternative ? "Accepted" : "Expected", answer.expectedParts)}
      {alternative && <p className="font-bold">This card practises: {answer.target}</p>}
    </div>
  );
}
