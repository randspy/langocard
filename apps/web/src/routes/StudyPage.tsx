import { PracticeBlock, type StoredBlock } from "@backend/practiceBlock";
import { answerWithExtraBlock, observeExtraBlock, readExtraBlock, readExtraBlockForDisplay } from "@/lib/blockStorage";
import { ExtraPracticeOffer } from "@/components/ExtraPracticeOffer";
import { schedulingDescription } from "@backend/fittedSettings";
import { browserSpeech } from "@/lib/speech";
import { useFrenchVoice } from "@/lib/useSpeech";
import { useCallback, useEffect, useState } from "react";
import { api } from "@backend/_generated/api";
import { StudySession } from "@/components/StudySession";
import { useTokenFetch, useTokenMutation, useTokenQuery } from "@/lib/convex";
import { localDay, type StudyCard } from "@/lib/study";
import { useNow } from "@/lib/useNow";

export function StudyPage() {
  const [stored, setStored] = useState<unknown>(readExtraBlockForDisplay);
  useEffect(() => observeExtraBlock(() => setStored(readExtraBlockForDisplay())), []);
  const [sessionKey, setSessionKey] = useState(0);
  const [complete, setComplete] = useState(false);
  const completed = useCallback((summary: boolean) => setComplete(summary), []);
  const start = useCallback((block: StoredBlock) => {
    setStored(block); setComplete(false); setMuted(false); setSessionKey(n => n + 1);
  }, []);
  const voice = useFrenchVoice(browserSpeech);
  const [muted, setMuted] = useState(false);
  const audio = voice !== null && !muted;
  const fetch = useTokenFetch();
  const submit = useTokenMutation(api.study.answer);
  const fit = useTokenQuery(api.study.scheduling, {});
  const tick = useTokenMutation(api.study.tick);
  const saveMemoryHook = useTokenMutation(api.sync.saveMemoryHook);
  const saveHook = useCallback((entryId: string, text: string) => saveMemoryHook({ entryId, text }), [saveMemoryHook]);
  const now = useNow(1000);
  const dueNow = useNow();
  const progress = useTokenQuery(api.study.progress, { day: localDay(now) });
  const block = PracticeBlock.read(stored, localDay(now), progress?.seconds ?? 2147483647);
  const phase = block.phase(progress?.seconds ?? 0);
  const offer = useTokenQuery(api.study.offer, { day: localDay(now), now: dueNow, audio, block: block.toJSON() });
  const summary = useTokenQuery(api.study.summary, { day: localDay(now), now: dueNow, audio });
  // Fetched once per card rather than subscribed, so a phone sync can't swap the card mid-answer.
  const fetchNext = useCallback(async (pending: string[], audio: boolean) => {
    const at = Date.now(), day = localDay(at);
    const { seconds } = await fetch(api.study.progress, { day });
    const block = PracticeBlock.read(readExtraBlock(), day, seconds).toJSON();
    return fetch(api.study.next, { day, now: at, pending, audio, block });
  }, [fetch]);
  const answer = useCallback(async (card: StudyCard, rating: "AGAIN" | "HARD" | "GOOD" | "EASY") => {
    const at = Date.now(), day = localDay(at);
    const result = await answerWithExtraBlock({
      day, newMeaning: "newMeaning" in card && card.newMeaning, newGender: "newGender" in card && card.newGender,
      loadSeconds: async () => (await fetch(api.study.progress, { day })).seconds,
      submit: block => submit({ key: card.key, version: card.version, rating, example: card.example, day, now: at, block }),
    });
    setStored(readExtraBlockForDisplay());
    return result;
  }, [submit, fetch]);
  return (
    <section className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="font-semibold text-3xl">Study</h1>
        {summary && <p className="text-sm text-muted">{summary.dueCapped ? `${summary.due}+` : summary.due} due</p>}
      </div>
      {progress && <p className="text-sm text-muted">
        {block.isExtra ? `${Math.floor(Math.max(0, progress.seconds - block.start) / 60)} / ${block.toJSON()!.minutes} extra minutes` : `${Math.floor(progress.seconds / 60)} / 15 minutes today`}
        {phase === "wind-down" && " · Winding down"}
        {phase === "cleanup" && " · Finishing learning cards"}
        {phase === "done" && (block.isExtra ? " · Extra block complete" : " · Daily practice complete")}
      </p>}
      {offer === "moreVocabulary" && <p>Ready for more vocabulary? Add entries to your library.</p>}
      {offer === "nothingLeft" && <p>Nothing left for a fresh sitting right now.</p>}
      {complete && offer === "extraBlock" && <ExtraPracticeOffer audio={audio} onStart={start} />}
      {fit === undefined || progress === undefined ? <p className="text-muted">Loading…</p> : (
        <>
          <p className="text-xs text-muted">{schedulingDescription(fit)}</p>
          <StudySession key={sessionKey} onSummaryChange={completed} fetchNext={fetchNext} answer={answer} clock={Date.now} tick={tick} saveHook={saveHook} fit={fit} onMute={() => setMuted(true)} />
        </>
      )}
    </section>
  );
}
