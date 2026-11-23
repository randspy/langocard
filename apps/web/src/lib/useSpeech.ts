import { useCallback, useEffect, useRef, useState } from "react";
import { frenchVoice, type SpeechEngine, type SpeechVoice } from "./speech";

/** Voice lists may arrive after page load; availability updates without swapping the shown card. */
export function useFrenchVoice(engine: SpeechEngine) {
  const [voice, setVoice] = useState(() => frenchVoice(engine.voices()));
  useEffect(() => {
    const update = () => setVoice(frenchVoice(engine.voices()));
    update();
    return engine.subscribe(update);
  }, [engine]);
  return voice;
}

type Playback = { key: string | null; kind: "idle" | "speaking" | "ready" | "error" };

/** Playback belongs to one shown card; cancellation and stale callbacks never unlock another. */
export function usePlayback(engine: SpeechEngine, key: string | null, text: string, voice: SpeechVoice | null) {
  const [state, setState] = useState<Playback>({ key: null, kind: "idle" });
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    engine.cancel();
    setState({ key, kind: "idle" });
    return () => { generation.current++; engine.cancel(); };
  }, [engine, key, voice?.id]);
  const play = useCallback(async () => {
    if (!key || !voice) return;
    const request = ++generation.current;
    setState({ key, kind: "speaking" });
    try {
      await engine.speak(text, voice);
      if (request === generation.current) setState({ key, kind: "ready" });
    } catch {
      if (request === generation.current) setState({ key, kind: "error" });
    }
  }, [engine, key, text, voice]);
  return { kind: state.key === key ? state.kind : "idle", play };
}
