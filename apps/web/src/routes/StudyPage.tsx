import { useCallback } from "react";
import { api } from "@backend/_generated/api";
import { schedulingDescription } from "@backend/fittedSettings";
import { StudySession } from "@/components/StudySession";
import { useTokenFetch, useTokenMutation, useTokenQuery } from "@/lib/convex";
import { localDay, type StudyCard } from "@/lib/study";
import { useNow } from "@/lib/useNow";

export function StudyPage() {
  const fetch = useTokenFetch();
  const submit = useTokenMutation(api.study.answer);
  const tick = useTokenMutation(api.study.tick);
  const now = useNow(1000);
  const dueNow = useNow();
  const progress = useTokenQuery(api.study.progress, { day: localDay(now) });
  const offer = useTokenQuery(api.study.offer, { day: localDay(now), now: dueNow });
  const summary = useTokenQuery(api.study.summary, { day: localDay(now), now: dueNow });
  const fit = useTokenQuery(api.study.scheduling, {});
  // Fetched once per card rather than subscribed, so a phone sync can't swap the card mid-answer.
  const fetchNext = useCallback((pending: string[]) => {
    const at = Date.now();
    return fetch(api.study.next, { day: localDay(at), now: at, pending });
  }, [fetch]);
  const answer = useCallback((card: StudyCard, rating: "AGAIN" | "HARD" | "GOOD" | "EASY") => {
    const at = Date.now();
    return submit({ key: card.key, version: card.version, rating, example: card.example, day: localDay(at), now: at });
  }, [submit]);
  return (
    <section className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="font-semibold text-3xl">Study</h1>
        {summary && <p className="text-sm text-muted">{summary.dueCapped ? `${summary.due}+` : summary.due} due</p>}
      </div>
      {progress && <p className="text-sm text-muted">
        {Math.floor(progress.seconds / 60)} / 15 minutes today
        {progress.phase === "wind-down" && " · Winding down"}
        {progress.phase === "cleanup" && " · Finishing learning cards"}
        {progress.phase === "done" && " · Daily practice complete"}
      </p>}
      {offer === "moreVocabulary" && <p>Ready for more vocabulary? Add entries to your library.</p>}
      {offer === "nothingLeft" && <p>Nothing left for a fresh sitting right now.</p>}
      {/* The session starts once the scheduling is known, so previews match what answers use. */}
      {fit === undefined ? <p className="text-muted">Loading…</p> : (
        <>
          <p className="text-xs text-muted">{schedulingDescription(fit)}</p>
          <StudySession fetchNext={fetchNext} answer={answer} clock={Date.now} tick={tick} fit={fit} />
        </>
      )}
    </section>
  );
}
