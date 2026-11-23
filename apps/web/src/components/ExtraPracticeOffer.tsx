import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { api } from "@backend/_generated/api";
import { EXTRA_MINUTES, PracticeBlock, type ExtraMinutes, type StoredBlock } from "@backend/practiceBlock";
import { Button } from "@/components/ui/button";
import { useTokenFetch } from "@/lib/convex";
import { createExtraBlock, readExtraBlock } from "@/lib/blockStorage";
import { localDay } from "@/lib/study";
import { errorMessage } from "@/lib/useAsyncAction";

/** Offers a fresh local grant only after the server confirms daily practice is complete and work remains. */
export function ExtraPracticeOffer({ audio, onStart }: { audio: boolean; onStart?: (block: StoredBlock) => void }) {
  const fetch = useTokenFetch();
  const navigate = useNavigate();
  const start = async (minutes: ExtraMinutes) => {
    const now = Date.now(), day = localDay(now);
    const grant = await createExtraBlock(async () => {
      const { seconds } = await fetch(api.study.progress, { day });
      const block = PracticeBlock.read(readExtraBlock(), day, seconds).toJSON();
      if (await fetch(api.study.offer, { day, now, audio, block }) !== "extraBlock") return null;
      const current = await fetch(api.study.progress, { day });
      return PracticeBlock.grant(day, current.seconds, minutes).toJSON();
    });
    if (!grant) return;
    if (onStart) onStart(grant); else await navigate({ to: "/study" });
  };
  return <ExtraPracticeButtons start={start} />;
}

/** One selection at a time, including while the server checks the offer and storage is written. */
export function ExtraPracticeButtons({ start }: { start: (minutes: ExtraMinutes) => Promise<void> }) {
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choose = async (minutes: ExtraMinutes) => {
    if (busy.current) return;
    busy.current = true; setSaving(true); setError(null);
    try { await start(minutes); }
    catch (e) { setError(errorMessage(e)); }
    finally { busy.current = false; setSaving(false); }
  };
  return (
    <div className="space-y-2" aria-label="Extra practice">
      <p>Keep practising?</p>
      <div className="flex gap-2">
        {EXTRA_MINUTES.map(minutes => <Button key={minutes} variant="outline" disabled={saving} onClick={() => void choose(minutes)}>+{minutes} minutes</Button>)}
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
