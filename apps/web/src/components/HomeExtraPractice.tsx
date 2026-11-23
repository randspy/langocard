import { useEffect, useState } from "react";
import { api } from "@backend/_generated/api";
import { PracticeBlock } from "@backend/practiceBlock";
import { ExtraPracticeOffer } from "./ExtraPracticeOffer";
import { observeExtraBlock, readExtraBlock } from "@/lib/blockStorage";
import { useTokenQuery } from "@/lib/convex";
import { browserSpeech } from "@/lib/speech";
import { useFrenchVoice } from "@/lib/useSpeech";
import { localDay } from "@/lib/study";
import { useNow } from "@/lib/useNow";

/** Home and sitting summary use the same server offer and browser-local grant. */
export function HomeExtraPractice() {
  const [stored, setStored] = useState<unknown>(readExtraBlock);
  useEffect(() => observeExtraBlock(() => setStored(readExtraBlock())), []);
  const now = useNow(), day = localDay(now);
  const audio = useFrenchVoice(browserSpeech) !== null;
  const progress = useTokenQuery(api.study.progress, { day });
  const block = PracticeBlock.read(stored, day, progress?.seconds ?? 2147483647).toJSON();
  const offer = useTokenQuery(api.study.offer, { day, now, audio, block });
  return offer === "extraBlock" ? <div className="mb-6"><ExtraPracticeOffer audio={audio} /></div> : null;
}
