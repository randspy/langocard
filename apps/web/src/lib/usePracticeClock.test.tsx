import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { usePracticeClock } from "./usePracticeClock";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

test("checkpoints ten visible seconds, pauses when hidden, and flushes the final interval", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 20, 12));
  const visibility = vi.spyOn(document, "visibilityState", "get");
  visibility.mockReturnValue("visible");
  const tick = vi.fn(async () => {});
  const { result } = renderHook(() => usePracticeClock(true, tick, Date.now));
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(tick).toHaveBeenCalledWith({ day: "2026-11-20", seconds: 10 });
  visibility.mockReturnValue("hidden");
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(result.current.seconds).toBe(10);
  visibility.mockReturnValue("visible");
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); await result.current.flush(); });
  expect(result.current.seconds).toBe(13);
  expect(tick).toHaveBeenLastCalledWith({ day: "2026-11-20", seconds: 3 });
});
