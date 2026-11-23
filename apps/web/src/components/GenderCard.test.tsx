import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import type { StudyCard } from "@/lib/study";
import { StudySession } from "./StudySession";

const gender = (word: string, g: "masculine" | "feminine"): StudyCard => ({
  key: "n:Gender", skill: "Gender", version: null, card: null, entryId: "n", hook: "",
  entry: { word, english: "a nation", definition: "Un peuple.", examples: [`Voici {${word}}.`], topic: "daily", lemma: "", rank: 1, sourceUrl: "", license: "", gender: g },
  example: `Voici {${word}}.`,
});

function renderCard(card: StudyCard) {
  const queue: (StudyCard | null)[] = [card, null];
  const answer = vi.fn(async () => ({ status: "ok" as const, card: "", offerHook: false }));
  render(<StudySession fetchNext={async () => queue.shift() ?? null} answer={answer} clock={() => 0} />);
  return answer;
}

describe("Gender cards", () => {
  test("the right article grades Good and shows the ending rule", async () => {
    const answer = renderCard(gender("une nation", "feminine"));
    expect(await screen.findByText("nation")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "une" }));
    expect(screen.getByText("✓ Right")).toBeInTheDocument();
    expect(screen.getByText("-ation: usually feminine. This noun follows the rule.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(answer).toHaveBeenCalledWith(expect.objectContaining({ key: "n:Gender" }), "GOOD");
  });

  test("the wrong article grades Again and shows the correct one", async () => {
    const answer = renderCard(gender("une image", "feminine"));
    await userEvent.click(await screen.findByRole("button", { name: "un" }));
    expect(screen.getByText("✗ Not un")).toBeInTheDocument();
    expect(screen.getByText("une image (f.)")).toBeInTheDocument();
    expect(screen.getByText("-age: usually masculine. This noun is an exception.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(answer).toHaveBeenCalledWith(expect.anything(), "AGAIN");
  });
});
