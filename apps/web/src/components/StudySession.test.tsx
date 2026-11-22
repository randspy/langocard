import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cardToJson, newCard, Scheduler } from "@backend/fsrs";
import type { StudyCard } from "@/lib/study";
import { StudySession } from "./StudySession";

const now = Date.parse("2026-11-20T09:00:00Z");
const reviewed = new Scheduler({ enableFuzzing: false }).review(newCard(1, now - 864e5 * 10), "GOOD", now - 864e5 * 10).card;
const card = (key: string, word: string): StudyCard => ({
  key, skill: "Reading", version: 5, card: cardToJson(reviewed), entryId: key.split(":")[0],
  entry: { word, english: "a plot", definition: "Ensemble des événements.", examples: ["Le roman a {une intrigue} complexe."], topic: "daily", lemma: "", rank: 1, sourceUrl: "", license: "", gender: "feminine" },
  example: "Le roman a {une intrigue} complexe.",
});

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("StudySession", () => {
  test("ending stops the clock before a slow checkpoint and shows only practice time", async () => {
    vi.useFakeTimers({ toFake: ["Date", "performance", "setInterval", "clearInterval"] });
    vi.setSystemTime(now);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const user = userEvent.setup();
    let complete = () => {};
    const tick = vi.fn(() => new Promise<void>((resolve) => { complete = resolve; }));
    const fetchNext = vi.fn(async () => card("a:Reading", "une intrigue"));
    render(<StudySession fetchNext={fetchNext} answer={async () => ({ status: "stale" })} tick={tick} clock={Date.now} />);
    await act(async () => {});
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    await user.click(screen.getByRole("button", { name: "End session" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    await act(async () => { complete(); });
    expect(screen.getByRole("status")).toHaveTextContent("0m 3s practised");
    expect(tick.mock.calls).toEqual([[{ day: "2026-11-20", seconds: 3 }]]);
    expect(fetchNext).toHaveBeenCalledTimes(1);
  });

  test("retrying a failed final checkpoint finishes the sitting without fetching another card", async () => {
    vi.useFakeTimers({ toFake: ["Date", "performance", "setInterval", "clearInterval"] });
    vi.setSystemTime(now);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const user = userEvent.setup();
    const tick = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(undefined);
    const fetchNext = vi.fn(async () => card("a:Reading", "une intrigue"));
    render(<StudySession fetchNext={fetchNext} answer={async () => ({ status: "stale" })} tick={tick} clock={Date.now} />);
    await act(async () => {});
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    await user.click(screen.getByRole("button", { name: "End session" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Offline");
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByRole("status")).toHaveTextContent("0m 3s practised");
    expect(fetchNext).toHaveBeenCalledTimes(1);
  });
  test("shows a due card, reveals it with interval previews, rates it and moves on", async () => {
    const queue: (StudyCard | null)[] = [card("a:Reading", "une intrigue"), card("b:Reading", "une trame"), null];
    const fetchNext = vi.fn(async () => queue.shift() ?? null);
    const answer = vi.fn(async () => ({ status: "ok" as const, card: "" }));
    render(<StudySession fetchNext={fetchNext} answer={answer} clock={() => now} />);
    expect(await screen.findByText("Le roman a une intrigue complexe.")).toBeInTheDocument();
    expect(screen.queryByText("a plot")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Good/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reveal answer" }));
    expect(screen.getByText("a plot")).toBeInTheDocument();
    expect(screen.getByText("une intrigue (f.)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Good/ })).toHaveTextContent(/~\d+d/);
    await userEvent.click(screen.getByRole("button", { name: /Good/ }));
    expect(answer).toHaveBeenCalledWith(expect.objectContaining({ key: "a:Reading" }), "GOOD");
    expect(await screen.findByText("une trame")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reveal answer" }));
    await userEvent.click(screen.getByRole("button", { name: /Again/ }));
    expect(await screen.findByText("Session complete.")).toBeInTheDocument();
    expect(fetchNext).toHaveBeenCalledTimes(3);
    expect(fetchNext).toHaveBeenLastCalledWith(["b:Reading"]);
    expect(screen.getByRole("status")).toHaveTextContent("2 assessments · 1 recalled");
  });

  test("a card reviewed on the phone meanwhile is skipped by fetching again", async () => {
    const queue: (StudyCard | null)[] = [card("a:Reading", "une intrigue"), null];
    const answer = vi.fn(async () => ({ status: "stale" as const }));
    render(<StudySession fetchNext={async () => queue.shift() ?? null} answer={answer} clock={() => now} />);
    await userEvent.click(await screen.findByRole("button", { name: "Reveal answer" }));
    await userEvent.click(screen.getByRole("button", { name: /Hard/ }));
    expect(await screen.findByText("Session complete.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("0 assessments · 0 recalled");
  });
});
