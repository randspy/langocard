import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { cardToJson, newCard, Scheduler } from "@backend/fsrs";
import type { StudyCard } from "@/lib/study";
import { StudySession } from "./StudySession";

const now = Date.parse("2026-11-20T09:00:00Z");
const reviewed = new Scheduler({ enableFuzzing: false }).review(newCard(1, now - 864e5 * 10), "GOOD", now - 864e5 * 10).card;
const card = (hook: string): StudyCard => ({
  key: "plot:Reading", skill: "Reading", version: 5, card: cardToJson(reviewed), entryId: "plot", hook,
  entry: { word: "une intrigue", english: "a plot", definition: "Ensemble des événements.", examples: ["Le roman a {une intrigue} complexe."], topic: "daily", lemma: "", rank: 1, sourceUrl: "", license: "", gender: "feminine" },
  example: "Le roman a {une intrigue} complexe.",
});

describe("stuck cards", () => {
  test("a fourth miss offers a memory hook that can be saved", async () => {
    const queue: (StudyCard | null)[] = [card(""), null];
    const saveHook = vi.fn(async () => {});
    render(<StudySession fetchNext={async () => queue.shift() ?? null} clock={() => now} saveHook={saveHook}
      answer={async () => ({ status: "ok" as const, card: "", offerHook: true })} />);
    await userEvent.click(await screen.findByRole("button", { name: "Reveal answer" }));
    await userEvent.click(screen.getByRole("button", { name: /Again/ }));
    await userEvent.type(await screen.findByLabelText("Memory hook"), "intrigue → in-tree-g");
    await userEvent.click(screen.getByRole("button", { name: "Save hook" }));
    expect(saveHook).toHaveBeenCalledWith("plot", "intrigue → in-tree-g");
    expect(await screen.findByText("Session complete.")).toBeInTheDocument();
  });

  test("the hook offer can be skipped", async () => {
    const queue: (StudyCard | null)[] = [card(""), null];
    const saveHook = vi.fn(async () => {});
    render(<StudySession fetchNext={async () => queue.shift() ?? null} clock={() => now} saveHook={saveHook}
      answer={async () => ({ status: "ok" as const, card: "", offerHook: true })} />);
    await userEvent.click(await screen.findByRole("button", { name: "Reveal answer" }));
    await userEvent.click(screen.getByRole("button", { name: /Again/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Skip" }));
    expect(await screen.findByText("Session complete.")).toBeInTheDocument();
    expect(saveHook).not.toHaveBeenCalled();
  });

  test("the entry's memory hook appears on reveal", async () => {
    render(<StudySession fetchNext={async () => card("a tangled plot")} clock={() => now}
      answer={async () => ({ status: "ok" as const, card: "", offerHook: false })} />);
    await userEvent.click(await screen.findByRole("button", { name: "Reveal answer" }));
    expect(screen.getByText("Memory hook: a tangled plot")).toBeInTheDocument();
  });
});

test("a repeat pause starts from the saved hook, which can be cleared, and a failed save keeps the draft", async () => {
  const queue: (StudyCard | null)[] = [card("old image"), null];
  const saveHook = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(undefined);
  render(<StudySession fetchNext={async () => queue.shift() ?? null} clock={() => now} saveHook={saveHook}
    answer={async () => ({ status: "ok" as const, card: "", offerHook: true })} />);
  await userEvent.click(await screen.findByRole("button", { name: "Reveal answer" }));
  await userEvent.click(screen.getByRole("button", { name: /Again/ }));
  const editor = await screen.findByLabelText("Memory hook");
  expect(editor).toHaveValue("old image");
  await userEvent.clear(editor);
  await userEvent.click(screen.getByRole("button", { name: "Save hook" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Offline");
  expect(screen.getByLabelText("Memory hook")).toHaveValue("");
  await userEvent.click(screen.getByRole("button", { name: "Save hook" }));
  expect(saveHook).toHaveBeenLastCalledWith("plot", "");
  expect(await screen.findByText("Session complete.")).toBeInTheDocument();
});


test("the hook draft cannot change during a pending save and survives a delayed failure", async () => {
  let rejectSave: (error: Error) => void = () => {};
  const saveHook = vi.fn(() => new Promise<void>((_, reject) => { rejectSave = reject; }));
  render(<StudySession fetchNext={async () => card("old image")} clock={() => now} saveHook={saveHook}
    answer={async () => ({ status: "ok" as const, card: "", offerHook: true })} />);
  await userEvent.click(await screen.findByRole("button", { name: "Reveal answer" }));
  await userEvent.click(screen.getByRole("button", { name: /Again/ }));
  const editor = await screen.findByLabelText("Memory hook");
  await userEvent.clear(editor);
  await userEvent.type(editor, "new image");
  await userEvent.click(screen.getByRole("button", { name: "Save hook" }));
  expect(editor).toHaveAttribute("readonly");
  await userEvent.type(editor, " while saving");
  expect(editor).toHaveValue("new image");
  await act(async () => rejectSave(new Error("Offline")));
  expect(screen.getByRole("alert")).toHaveTextContent("Offline");
  expect(editor).toHaveValue("new image");
  expect(editor).not.toHaveAttribute("readonly");
});
