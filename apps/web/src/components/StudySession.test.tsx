import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
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

describe("StudySession", () => {
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
