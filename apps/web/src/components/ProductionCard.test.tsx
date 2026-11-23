import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { cardToJson, newCard, Scheduler } from "@backend/fsrs";
import type { StudyCard } from "@/lib/study";
import { StudySession } from "./StudySession";

const now = Date.parse("2026-11-20T09:00:00Z");
const reviewed = new Scheduler({ enableFuzzing: false }).review(newCard(1, now - 864e5 * 10), "GOOD", now - 864e5 * 10).card;
const production: StudyCard = {
  key: "plot:Production", skill: "Production", version: 5, card: cardToJson(reviewed), entryId: "plot", hook: "",
  entry: { word: "une intrigue", english: "a plot", definition: "Ensemble des événements.", examples: ["Le roman a {une intrigue|une trame} complexe."], topic: "daily", lemma: "", rank: 1, sourceUrl: "", license: "", gender: "feminine" },
  example: "Le roman a {une intrigue|une trame} complexe.",
};

function renderCard() {
  const queue: (StudyCard | null)[] = [production, null];
  const answer = vi.fn(async () => ({ status: "ok" as const, card: "", offerHook: false }));
  render(<StudySession fetchNext={async () => queue.shift() ?? null} answer={answer} clock={() => now} />);
  return answer;
}

describe("Production cards", () => {
  test("type, reveal, adjust the suggested rating and confirm", async () => {
    const answer = renderCard();
    expect(await screen.findByText("Le roman a ________ complexe.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Your answer (optional)"), "un intrigue");
    await userEvent.click(screen.getByRole("button", { name: "Reveal answer" }));
    expect(screen.getByText("Right word, wrong article")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Hard/ })).toHaveAttribute("aria-pressed", "true");
    expect(answer).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /Good/ }));
    expect(screen.getByRole("button", { name: /Good/ })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Confirm rating" }));
    expect(answer).toHaveBeenCalledWith(expect.objectContaining({ key: "plot:Production" }), "GOOD");
  });

  test("an accepted alternative names the word the card practises", async () => {
    renderCard();
    await userEvent.type(await screen.findByLabelText("Your answer (optional)"), "une trame");
    await userEvent.click(screen.getByRole("button", { name: "Reveal answer" }));
    expect(screen.getByText("✓ Also correct")).toBeInTheDocument();
    expect(screen.getByText("This card practises: une intrigue")).toBeInTheDocument();
  });

  test("an empty answer reveals without a suggestion and rates directly", async () => {
    const answer = renderCard();
    await userEvent.click(await screen.findByRole("button", { name: "Reveal answer" }));
    expect(screen.queryByRole("button", { name: "Confirm rating" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Easy/ }));
    expect(answer).toHaveBeenCalledWith(expect.anything(), "EASY");
  });
});
