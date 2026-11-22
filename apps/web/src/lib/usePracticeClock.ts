import { useCallback, useEffect, useRef, useState } from "react";
import { PracticeClock } from "./practiceClock";

type Tick = (checkpoint: { day: string; seconds: number }) => Promise<unknown>;

/** Counts only a visible card, checkpoints every ten seconds, and drains before selecting another. */
export function usePracticeClock(active: boolean, tick: Tick, wall: () => number) {
  const timer = useRef(new PracticeClock());
  const writes = useRef(Promise.resolve());
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const sample = useCallback(() => {
    timer.current.sample(wall(), performance.now(), active && document.visibilityState === "visible");
    setSeconds(timer.current.seconds);
  }, [active, wall]);
  const checkpoint = useCallback(() => {
    const next = writes.current.catch(() => {}).then(async () => {
      for (const checkpoint of timer.current.checkpoints()) {
        await tick(checkpoint);
        timer.current.saved(checkpoint.day, checkpoint.seconds);
      }
      setError(null);
    });
    writes.current = next;
    return next;
  }, [tick]);
  const flush = useCallback(() => {
    sample();
    return checkpoint();
  }, [sample, checkpoint]);
  useEffect(() => {
    sample();
    const save = () => { void flush().catch(() => setError("Practice time could not be saved. Reconnect to retry.")); };
    const visibility = () => { sample(); save(); };
    document.addEventListener("visibilitychange", visibility);
    const id = setInterval(() => {
      sample();
      if (timer.current.checkpoints().reduce((n, x) => n + x.seconds, 0) >= 10) save();
    }, 1000);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", visibility);
      // End the previous active interval before the next effect starts, or the page unmounts.
      timer.current.sample(wall(), performance.now(), false);
      void checkpoint().catch(() => {});
    };
  }, [sample, flush, wall, checkpoint]);
  return { seconds, flush, error };
}
