import { useCallback } from "react";
import { api } from "@backend/_generated/api";
import { StudySession } from "@/components/StudySession";
import { useTokenFetch, useTokenMutation, useTokenQuery } from "@/lib/convex";
import { localDay, type StudyCard } from "@/lib/study";
import { useNow } from "@/lib/useNow";

export function StudyPage() {
  const fetch = useTokenFetch();
  const submit = useTokenMutation(api.study.answer);
  const now = useNow();
  const summary = useTokenQuery(api.study.summary, { day: localDay(now), now });
  // Fetched once per card rather than subscribed, so a phone sync can't swap the card mid-answer.
  const fetchNext = useCallback(() => {
    const at = Date.now();
    return fetch(api.study.next, { day: localDay(at), now: at });
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
      <StudySession fetchNext={fetchNext} answer={answer} clock={Date.now} />
    </section>
  );
}
