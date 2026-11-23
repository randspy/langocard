import { browserSpeech, frenchVoice, type SpeechEngine } from "@/lib/speech";
import { useFrenchVoice, usePlayback } from "@/lib/useSpeech";
import type { Fit } from "@backend/fittedSettings";
import { useCallback, useEffect, useRef, useState } from "react";
import { clozeOf, nounOf, textOf, answerOf, type Gender } from "@backend/entryRules";
import { endingMatch } from "@backend/nounEndings";
import { MATCH_LABEL, MATCH_RATING, typedAnswer, type AnswerPart, type TypedAnswer } from "@backend/typedAnswer";
import { Input, Textarea } from "@/components/ui/input";
import { usePracticeClock } from "@/lib/usePracticeClock";
import type { Rating } from "@backend/fsrs";
import { Button } from "@/components/ui/button";
import { GENDER_TAGS } from "@/lib/library";
import { intervals, type AnswerResult, type StudyCard } from "@/lib/study";
import { errorMessage } from "@/lib/useAsyncAction";

const RATINGS: [Rating, string][] = [["AGAIN", "Again"], ["HARD", "Hard"], ["GOOD", "Good"], ["EASY", "Easy"]];

type Props = {
  /** Fetches the card to show next, or null when nothing is due. Called once per card, never subscribed. */
  fetchNext: (pending: string[], audio: boolean) => Promise<StudyCard | null>;
  answer: (card: StudyCard, rating: Rating) => Promise<AnswerResult>;
  clock: () => number;
  fit?: Fit | null;
  speech?: SpeechEngine;
  onMute?: () => void;
  tick?: (checkpoint: { day: string; seconds: number }) => Promise<unknown>;
  /** Saves a memory hook for an entry, offered after a card's fourth miss in a row. */
  saveHook?: (entryId: string, text: string) => Promise<unknown>;
};

type State =
  | { kind: "loading" }
  | {
    kind: "card"; card: StudyCard; revealed: boolean; saving: boolean;
    /** Production: what the learner typed, its frozen comparison and the rating to confirm. */
    typed: string; comparison: TypedAnswer | null; selected: Rating | null;
  }
  | { kind: "ending" }
  /** A stuck card was paused: offer a memory hook for its entry before going on. */
  | { kind: "hook"; entryId: string; word: string; text: string; saved: string; saving: boolean; error: string | null }
  | { kind: "done" }
  | { kind: "error"; message: string; retry: "load" | "finish" };

/**
 * One sitting of review: show a due card, reveal it, rate it, then fetch the next one.
 * Reading cards show the French word in its sentence; the learner recalls the meaning.
 */
const noTick = async () => {};

export function StudySession({ fetchNext, answer, clock, tick = noTick, saveHook = noTick, fit = null, speech = browserSpeech, onMute = () => {} }: Props) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const voice = useFrenchVoice(speech);
  const muted = useRef(false);
  const ended = useRef(false);
  const hadVoice = useRef(voice !== null);
  const voiceArrived = useRef(false);
  const playback = usePlayback(speech, state.kind === "card" && state.card.skill === "Listening" ? `${state.card.key}@${state.card.version}` : null,
    state.kind === "card" ? textOf(state.card.example) : "", voice);
  const pending = useRef(new Set<string>());
  const [reviews, setReviews] = useState(0);
  const [recalled, setRecalled] = useState(0);
  const { seconds, flush, stop, error: timeError } = usePracticeClock(state.kind === "card", tick, clock);
  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      await flush();
      const canListen = () => frenchVoice(speech.voices()) !== null && !muted.current;
      let audio = canListen();
      for (;;) {
        const card = await fetchNext([...pending.current], audio);
        const currentAudio = canListen();
        // Capability can change during a save or fetch. Never display an unplayable card,
        // or declare exhaustion from a request that excluded newly available Listening.
        if ((card?.skill === "Listening" && !currentAudio) || (!card && currentAudio && !audio)) {
          audio = currentAudio;
          continue;
        }
        voiceArrived.current = false;
        setState(card ? { kind: "card", card, revealed: false, saving: false, typed: "", comparison: null, selected: null } : { kind: "done" });
        break;
      }
    } catch (e) {
      setState({ kind: "error", message: errorMessage(e), retry: "load" });
    }
  }, [fetchNext, flush, speech]);
  const finish = async () => {
    ended.current = true;
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
  useEffect(() => {
    if (voice && !hadVoice.current) voiceArrived.current = true;
    hadVoice.current = voice !== null;
    // Some browsers populate voices after the initial query has already found no work.
    if (state.kind === "card") voiceArrived.current = false;
    if (state.kind === "done" && voiceArrived.current && !muted.current && !ended.current) {
      voiceArrived.current = false;
      void load();
    }
  }, [voice, state.kind, load]);

  if (state.kind === "loading") return <p className="text-muted">Loading…</p>;
  if (state.kind === "ending") return <p className="text-muted">Saving practice time…</p>;
  if (state.kind === "hook") {
    const save = async () => {
      setState({ ...state, saving: true, error: null });
      try {
        await saveHook(state.entryId, state.text.trim());
      } catch (e) {
        // Keep the draft so the learner can retry or skip.
        return setState({ ...state, saving: false, error: errorMessage(e) });
      }
      await load();
    };
    return (
      <section className="max-w-2xl space-y-3" aria-label="Memory hook offer">
        <p className="text-lg">“{state.word}” keeps slipping away, so it's paused for three days.</p>
        <p className="text-sm text-muted">A memory hook (an image, a sound-alike, a story) can help it stick. It's shown whenever you reveal this word.</p>
        <Textarea aria-label="Memory hook" readOnly={state.saving} maxLength={500} value={state.text} onChange={(e) => setState({ ...state, text: e.target.value })} />
        {state.error && <p role="alert" className="text-danger">{state.error}</p>}
        <div className="flex gap-2">
          <Button disabled={state.saving || state.text.trim() === state.saved.trim()} onClick={() => void save()}>Save hook</Button>
          <Button variant="ghost" disabled={state.saving} onClick={() => void load()}>Skip</Button>
        </div>
      </section>
    );
  }
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
  const listening = card.skill === "Listening";
  const canReveal = !listening || playback.kind === "ready";
  const mute = () => {
    muted.current = true;
    speech.cancel();
    onMute();
    void load();
  };
  // Reveal freezes the typed feedback and its suggested rating; an empty answer suggests nothing.
  const reveal = () => {
    if (!canReveal) return;
    const check = production || listening ? typedAnswer(typed, example, entry.gender !== null, production) : null;
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
        // As on the phone, the prompt starts from the entry's current hook, which can be edited or cleared.
        if (result.offerHook) return setState({ kind: "hook", entryId: card.entryId, word: entry.word, text: card.hook, saved: card.hook, saving: false, error: null });
      }
      await load();
    } catch (e) {
      setState({ kind: "error", message: errorMessage(e), retry: "load" });
    }
  };
  const previews = revealed ? intervals(card.card, clock(), fit) : null;
  const word = entry.gender ? `${entry.word} (${GENDER_TAGS[entry.gender]})` : entry.word;
  if (card.skill === "Gender") {
    return (
      <article className="max-w-2xl space-y-6" aria-label="Study card">
        {timeError && <p role="alert">{timeError}</p>}
        <Button variant="outline" disabled={saving} onClick={() => void finish()}>End session</Button>
        <GenderCard key={card.key} card={card} saving={saving} onNext={(rating) => void rate(rating)} />
      </article>
    );
  }
  return (
    <article className="max-w-2xl space-y-6" aria-label="Study card">
      {timeError && <p role="alert">{timeError}</p>}
      <Button variant="outline" disabled={saving} onClick={() => void finish()}>End session</Button>
      <p className="text-sm uppercase tracking-wide text-muted">{listening ? "Listen" : production ? "Speak" : "Read"}</p>
      {production || listening ? (
        <div className="space-y-3">
          {!listening && <p className="font-semibold text-3xl">{entry.english}</p>}
          <p className="text-xl">{clozeOf(example)}</p>
          {listening && (
            <div className="space-y-2">
              <p className="text-sm text-muted">Synthetic French speech</p>
              <div className="flex gap-2">
                <Button variant="outline" disabled={!voice || playback.kind === "speaking"} onClick={() => void playback.play()}>
                  {playback.kind === "speaking" ? "Speaking…" : "Play example"}
                </Button>
                <Button variant="ghost" disabled={saving} onClick={mute}>Mute listening</Button>
              </div>
              {playback.kind === "error" && <p role="alert">Playback failed. Try again or mute listening.</p>}
            </div>
          )}
          {!revealed && (
            <Input aria-label="Your answer (optional)" placeholder="Your answer (optional)" value={typed} autoComplete="off"
              autoCapitalize="none" spellCheck={false} maxLength={200}
              onChange={(e) => setState({ ...state, typed: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") reveal(); }} />
          )}
          {!revealed && (
            <p className="text-sm text-muted">
              {listening ? "Play the example, then type what you heard (optional)." : "Say the missing French aloud, or type it. Include the article for nouns and use the form that fits the sentence. Right word, wrong article? Rate Hard."}
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
          {card.hook && <p>Memory hook: {card.hook}</p>}
          {(production || listening) && <p>{textOf(example)}</p>}
        </div>
      )}
      {!revealed
        ? <Button disabled={!canReveal} onClick={reveal}>Reveal answer</Button>
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

/**
 * A Gender card grades itself: choose un or une, see whether it was right with the noun's
 * ending cue, then go on. Right is Good, wrong is Again.
 */
function GenderCard({ card, saving, onNext }: { card: StudyCard; saving: boolean; onNext: (rating: Rating) => void }) {
  const [chosen, setChosen] = useState<Gender | null>(null);
  const { entry, example } = card;
  const gender = entry.gender!;
  const ARTICLE: Record<Gender, string> = { masculine: "un", feminine: "une" };
  const cue = endingMatch(entry.word, gender);
  return (
    <>
      <p className="text-sm uppercase tracking-wide text-muted">Gender</p>
      <div className="space-y-2">
        <p className="font-semibold text-3xl">{nounOf(entry.word)}</p>
        <p className="text-lg">{entry.english}</p>
        {!chosen && <p className="text-sm text-muted">Un or une?</p>}
      </div>
      {!chosen ? (
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Choose the article">
          {(["masculine", "feminine"] as const).map((g) => (
            <Button key={g} variant="outline" className="h-14 text-xl" onClick={() => setChosen(g)}>{ARTICLE[g]}</Button>
          ))}
        </div>
      ) : (
        <div className="space-y-2 border-t border-line pt-4">
          <p className={chosen === gender ? "font-semibold text-lg" : "font-semibold text-lg text-danger"}>
            {chosen === gender ? "✓ Right" : `✗ Not ${ARTICLE[chosen]}`}
          </p>
          <p className="font-semibold text-2xl">{ARTICLE[gender]} {nounOf(entry.word)} ({GENDER_TAGS[gender]})</p>
          {cue && <p>{cue.feedback}</p>}
          <p className="text-lg font-medium">{entry.english}</p>
          <p>{entry.definition}</p>
          {card.hook && <p>Memory hook: {card.hook}</p>}
          <p>{textOf(example)}</p>
          <Button className="w-full" disabled={saving} onClick={() => onNext(chosen === gender ? "GOOD" : "AGAIN")}>Next</Button>
        </div>
      )}
    </>
  );
}

/** Both answers, emphasising the characters that differ, as the phone shows them. */
function Feedback({ answer }: { answer: TypedAnswer }) {
  const alternative = answer.match === "Alternative";
  const line = (label: string, parts: AnswerPart[]) => (
    // Spaces are kept as typed, so a doubled or missing space is visible.
    <p className="whitespace-pre-wrap">
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
