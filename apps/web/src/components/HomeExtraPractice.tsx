import { Component, useEffect, useState, type PropsWithChildren } from "react";
import { api } from "@backend/_generated/api";
import { PracticeBlock, type StoredBlock } from "@backend/practiceBlock";
import { ExtraPracticeOffer } from "./ExtraPracticeOffer";
import { observeExtraBlock, readExtraBlockForDisplay } from "@/lib/blockStorage";
import { useTokenQuery } from "@/lib/convex";
import { browserSpeech } from "@/lib/speech";
import { useFrenchVoice } from "@/lib/useSpeech";
import { localDay } from "@/lib/study";
import { useNow } from "@/lib/useNow";

/** Eligibility failures belong to this panel, never the Library it is displayed in. */
class ExtraPracticeBoundary extends Component<PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <p role="alert">Extra practice is temporarily unavailable.</p> : this.props.children;
  }
}

/** Home and sitting summary use the same server offer and browser-local grant. */
export function HomeExtraPractice() {
  return <ExtraPracticeBoundary><HomePracticeProgress /></ExtraPracticeBoundary>;
}

function HomePracticeProgress() {
  const [stored, setStored] = useState<unknown>(readExtraBlockForDisplay);
  useEffect(() => observeExtraBlock(() => setStored(readExtraBlockForDisplay())), []);
  const now = useNow(), day = localDay(now);
  const audio = useFrenchVoice(browserSpeech) !== null;
  const progress = useTokenQuery(api.study.progress, { day });
  if (!progress || progress.seconds < 900) return null;
  const block = PracticeBlock.read(stored, day, progress.seconds).toJSON();
  return <EligibleExtraPractice day={day} now={now} audio={audio} block={block} />;
}

function EligibleExtraPractice({ day, now, audio, block }: { day: string; now: number; audio: boolean; block: StoredBlock | null }) {
  const offer = useTokenQuery(api.study.offer, { day, now, audio, block });
  return offer === "extraBlock" ? <div className="mb-6"><ExtraPracticeOffer audio={audio} /></div> : null;
}
