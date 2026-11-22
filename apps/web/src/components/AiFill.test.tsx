import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import type { EntryContent } from "@backend/entryRules";
import type { Availability, OnDeviceModel } from "@/lib/onDeviceModel";
import { EntryForm } from "./EntryForm";

const blank: EntryContent = {
  word: "", english: "", definition: "", examples: [""], topic: "daily", lemma: "", rank: null, sourceUrl: "", license: "", gender: null,
};
const plot = (definition: string) => JSON.stringify({
  word: "une intrigue", gender: "feminine", definition,
  examples: ["Ce roman développe {une intrigue} complexe.", "On devine vite {l'intrigue}.", "La série suit {une intrigue} pleine de surprises."],
});

function fakeModel(availability: Availability, ...replies: string[]): OnDeviceModel & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    availability: async () => availability,
    download: vi.fn(async (onProgress: (p: number) => void) => { onProgress(0.5); }),
    generate: async (prompt) => { prompts.push(prompt); return replies.shift() ?? ""; },
    remove: vi.fn(async () => {}),
  };
}

function renderForm(model: OnDeviceModel, onSubmit = vi.fn(async () => {})) {
  render(<EntryForm entryId="personal-new" initial={blank} submitLabel="Add entry" onSubmit={onSubmit} ai={model} />);
  return onSubmit;
}

describe("AI fill", () => {
  test("is hidden when the browser can't run the model", async () => {
    renderForm(fakeModel({ kind: "unavailable" }));
    await Promise.resolve();
    expect(screen.queryByRole("button", { name: "Enable AI fill" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Fill with AI" })).not.toBeInTheDocument();
  });

  test("downloads the model once when enabled", async () => {
    const model = fakeModel({ kind: "downloadable" });
    renderForm(model);
    await userEvent.click(await screen.findByRole("button", { name: "Enable AI fill" }));
    expect(model.download).toHaveBeenCalledOnce();
    expect(await screen.findByRole("button", { name: "Fill with AI" })).toBeInTheDocument();
  });

  test("drafts the entry for review and saves nothing until Save", async () => {
    const model = fakeModel({ kind: "available" }, plot("Première."));
    const onSubmit = renderForm(model);
    await userEvent.type(screen.getByLabelText("English"), "a plot");
    await userEvent.click(await screen.findByRole("button", { name: "Fill with AI" }));
    expect(await screen.findByText("Check the draft before saving.")).toBeInTheDocument();
    expect(screen.getByLabelText("French word or phrase")).toHaveValue("une intrigue");
    expect(screen.getByLabelText("Gender")).toHaveValue("feminine");
    expect(screen.getByLabelText("Example 3")).toHaveValue("La série suit {une intrigue} pleine de surprises.");
    expect(onSubmit).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Add entry" }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ word: "une intrigue", definition: "Première.", gender: "feminine" }));
  });

  test("regenerating replaces only drafted fields the learner hasn't edited", async () => {
    const model = fakeModel({ kind: "available" }, plot("Première."), plot("Seconde."));
    renderForm(model);
    await userEvent.type(screen.getByLabelText("English"), "a plot");
    await userEvent.click(await screen.findByRole("button", { name: "Fill with AI" }));
    await screen.findByText("Check the draft before saving.");
    const word = screen.getByLabelText("French word or phrase");
    await userEvent.clear(word);
    await userEvent.type(word, "une trame");
    await userEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    await screen.findByDisplayValue("Seconde.");
    expect(word).toHaveValue("une trame");
    expect(model.prompts[1]).toContain("French word: une trame");
  });

  test("locks the form while drafting and leaves the gender to follow a later article", async () => {
    let reply!: (text: string) => void;
    const model: OnDeviceModel = {
      availability: async () => ({ kind: "available" }),
      download: async () => {},
      generate: () => new Promise((resolve) => { reply = resolve; }),
      remove: async () => {},
    };
    renderForm(model);
    await userEvent.type(screen.getByLabelText("English"), "a plot");
    await userEvent.click(await screen.findByRole("button", { name: "Fill with AI" }));
    expect(screen.getByLabelText("French word or phrase")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add entry" })).toBeDisabled();
    reply(plot("Première."));
    await screen.findByText("Check the draft before saving.");
    const word = screen.getByLabelText("French word or phrase");
    expect(word).toBeEnabled();
    await userEvent.clear(word);
    await userEvent.type(word, "l'intrigue");
    expect(screen.getByLabelText("Gender")).toHaveValue("feminine");
    await userEvent.clear(word);
    await userEvent.type(word, "un récit");
    expect(screen.getByLabelText("Gender")).toHaveValue("masculine");
    await userEvent.clear(word);
    await userEvent.type(word, "l'intrigue");
    expect(screen.getByLabelText("Gender")).toHaveValue("feminine");
  });
});
