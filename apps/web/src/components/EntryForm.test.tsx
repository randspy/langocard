import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import type { EntryContent } from "@backend/entryRules";
import { EntryForm } from "./EntryForm";

const initial: EntryContent = {
  word: "pourtant", english: "however", definition: "Malgré cela.", examples: ["Il pleut, {pourtant} elle sort."],
  topic: "daily", lemma: "pourtant", rank: 20, sourceUrl: "", license: "", gender: null,
};
const blank: EntryContent = { ...initial, word: "", english: "", definition: "", examples: [""], lemma: "", rank: null };

function renderForm(onSubmit = vi.fn(async () => {})) {
  render(<EntryForm entryId="frw-1" initial={initial} submitLabel="Save changes" onSubmit={onSubmit} />);
  return onSubmit;
}

describe("EntryForm", () => {
  test("saves only changed content", async () => {
    const onSubmit = renderForm();
    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();
    const english = screen.getByLabelText("English");
    await userEvent.clear(english);
    await userEvent.type(english, "nevertheless");
    await userEvent.click(save);
    expect(onSubmit).toHaveBeenCalledWith({ ...initial, english: "nevertheless" });
    expect(await screen.findByRole("status")).toHaveTextContent("Saved");
  });

  test("shows the entry rule next to the field and doesn't submit", async () => {
    const onSubmit = renderForm();
    const example = screen.getByLabelText("Example 1");
    await userEvent.clear(example);
    await userEvent.type(example, "Il pleut, pourtant elle sort.");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByText("Mark exactly one answer with {braces} in the example")).toBeInTheDocument();
    expect(example).toHaveAttribute("aria-invalid", "true");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("previews the speaking prompt", async () => {
    renderForm();
    expect(screen.getByLabelText("Speaking practice preview")).toHaveTextContent("Il pleut, ________ elle sort.");
    expect(screen.getByLabelText("Speaking practice preview")).toHaveTextContent("Answer: pourtant");
  });

  test("adds, reorders and removes examples", async () => {
    const onSubmit = renderForm();
    await userEvent.click(screen.getByRole("button", { name: "Add example" }));
    await userEvent.type(screen.getByLabelText("Example 2"), "Il est las, {{pourtant} il reste.");
    await userEvent.click(screen.getByRole("button", { name: "Move example 2 up" }));
    expect(screen.getByLabelText("Speaking practice preview")).toHaveTextContent(/Il est las, ________ il reste\..*Il pleut, ________ elle sort\./);
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSubmit).toHaveBeenCalledWith({ ...initial, examples: ["Il est las, {pourtant} il reste.", "Il pleut, {pourtant} elle sort."] });
    await userEvent.click(screen.getByRole("button", { name: "Remove example 1" }));
    expect(screen.queryByLabelText("Example 2")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove example 1" })).toBeDisabled();
  });

  test("shows an error under the example it belongs to, and list errors under the list", async () => {
    const onSubmit = renderForm();
    await userEvent.click(screen.getByRole("button", { name: "Add example" }));
    await userEvent.type(screen.getByLabelText("Example 2"), "Il pleut, {{pourtant} elle sort.");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByText("Each example must be different")).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Example 2"));
    await userEvent.type(screen.getByLabelText("Example 2"), "sans réponse");
    expect(screen.getByLabelText("Example 2")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Example 1")).not.toHaveAttribute("aria-invalid");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("allows at most five examples", async () => {
    renderForm();
    const add = screen.getByRole("button", { name: "Add example" });
    for (let i = 0; i < 4; i++) await userEvent.click(add);
    expect(screen.getByLabelText("Example 5")).toBeInTheDocument();
    expect(add).toBeDisabled();
  });

  test("a new entry's gender follows the typed article until the learner picks one", async () => {
    const onSubmit = vi.fn(async () => {});
    render(<EntryForm entryId="personal-new" initial={blank} submitLabel="Add entry" onSubmit={onSubmit} />);
    const gender = screen.getByLabelText("Gender");
    expect(gender).toHaveValue("");
    await userEvent.type(screen.getByLabelText("French word or phrase"), "une rencontre");
    expect(gender).toHaveValue("feminine");
    await userEvent.selectOptions(gender, "");
    await userEvent.type(screen.getByLabelText("French word or phrase"), "s");
    expect(gender).toHaveValue("");
  });

  test("refuses a gender that contradicts the article", async () => {
    const onSubmit = vi.fn(async () => {});
    render(<EntryForm entryId="frw-1" initial={{ ...initial, word: "une intrigue", examples: ["Voici {une intrigue}."], gender: "feminine" }}
      submitLabel="Save changes" onSubmit={onSubmit} />);
    await userEvent.selectOptions(screen.getByLabelText("Gender"), "masculine");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByText("The gender doesn't match the article")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("shows a server error", async () => {
    renderForm(vi.fn(async () => { throw Object.assign(new Error("Server Error"), { data: "Restore the entry before editing it" }); }));
    await userEvent.type(screen.getByLabelText("English"), "!");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Restore the entry before editing it");
  });
});
