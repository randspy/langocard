import { describe, expect, test } from "vitest";
import { EntryDrafter } from "./entryDrafter";

// Ported from Android's EntryDrafterTest.
const realise = ["Elle {s'est rendu compte} du problème.", "Je {me rends compte} de mon erreur.", "Ils vont {se rendre compte} du danger."];
const complete = JSON.stringify({ word: "se rendre compte", gender: "none", definition: "Comprendre soudain quelque chose.", examples: realise });
const plot = `{"word":"une intrigue","gender":"feminine","definition":"Ensemble des événements d'une fiction.","examples":["Ce roman développe {une intrigue} complexe.","On devine vite {l'intrigue}.","La série suit {une intrigue} pleine de surprises."]}`;

/** A model that answers with each reply in turn and remembers the prompts it was given. */
function fakeModel(...replies: string[]) {
  const prompts: string[] = [];
  const generate = async (prompt: string) => {
    prompts.push(prompt);
    const reply = replies.shift();
    if (reply === undefined) throw new Error("No more replies");
    return reply;
  };
  return { prompts, drafter: new EntryDrafter(generate) };
}

describe("EntryDrafter", () => {
  test("drafts every field the learner left blank", async () => {
    const model = fakeModel("Sure! Here it is:\n```json\n" + complete + "\n```");
    const draft = await model.drafter.draft("to realise", {});
    expect(draft.filled).toEqual({ word: "se rendre compte", gender: "none", definition: "Comprendre soudain quelque chose." });
    expect(draft.examples).toEqual(realise);
    expect(draft.unfilled.size).toBe(0);
    expect(model.prompts).toHaveLength(1);
    expect(model.prompts[0]).toContain("English meaning: to realise");
  });

  test("never replaces what the learner wrote and tells the model about it", async () => {
    const model = fakeModel(complete);
    const draft = await model.drafter.draft("to realise", { word: "réaliser" });
    expect(Object.keys(draft.filled).sort()).toEqual(["definition", "gender"]);
    expect(draft.examples).toHaveLength(3);
    expect(model.prompts[0]).toContain("French word: réaliser");
  });

  test("adds examples next to the learner's, up to three, never repeating them", async () => {
    const model = fakeModel(complete);
    const own = "Je {me rends compte} de mon erreur.";
    const draft = await model.drafter.draft("to realise", {}, [own]);
    expect(draft.examples).toEqual([realise[0], realise[2]]);
    expect(model.prompts[0]).toContain(`Example: ${own}`);
  });

  test("drafts no examples when the learner wrote three", async () => {
    const draft = await fakeModel(complete).drafter.draft("to realise", {}, ["{a} b.", "{c} d.", "{e} f."]);
    expect(draft.examples).toEqual([]);
    expect(draft.unfilled.has("examples")).toBe(false);
  });

  test("keeps the usable examples of a reply and retries for the rest", async () => {
    const partly = complete.replace(JSON.stringify(realise), JSON.stringify([realise[0], "Sans réponse.", realise[0]]));
    const model = fakeModel(partly, partly);
    const draft = await model.drafter.draft("to realise", {});
    expect(model.prompts).toHaveLength(2);
    expect(draft.examples).toEqual([realise[0]]);
    expect(draft.unfilled.size).toBe(0);
  });

  test("retries once when the reply is unusable", async () => {
    const model = fakeModel("Désolé, je ne peux pas.", complete);
    const draft = await model.drafter.draft("to realise", {});
    expect(Object.keys(draft.filled)).toHaveLength(3);
    expect(draft.examples).toHaveLength(3);
    expect(model.prompts).toHaveLength(2);
  });

  test("never repeats a learner's example that lists alternatives", async () => {
    const own = realise[0].replace("}", "|comprendre}");
    const draft = await fakeModel(complete).drafter.draft("to realise", {}, [own]);
    expect(draft.examples).toEqual(realise.slice(1));
  });

  test("drops drafted examples that list alternatives", async () => {
    const withAlternatives = `{"word":"se rendre compte","gender":"none","definition":"Comprendre soudain quelque chose.","examples":["Elle {se rend compte|comprend} du problème.","Il {se rend compte|} de tout."]}`;
    const draft = await fakeModel(withAlternatives, withAlternatives).drafter.draft("to realise", {});
    expect(draft.examples).toEqual([]);
  });

  test("keeps the better attempt and reports fields it could not draft", async () => {
    const noAnswer = `{"word":"se rendre compte","gender":"none","definition":"Comprendre soudain quelque chose.","examples":["Elle s'est rendu compte du problème."]}`;
    const twoAnswers = `{"word":"","definition":"","examples":["{Elle} {comprend}."]}`;
    const model = fakeModel(noAnswer, twoAnswers);
    const draft = await model.drafter.draft("to realise", {});
    expect(Object.keys(draft.filled).sort()).toEqual(["definition", "gender", "word"]);
    expect([...draft.unfilled]).toEqual(["examples"]);
    expect(model.prompts).toHaveLength(2);
  });

  test("treats non-text values as missing", async () => {
    const model = fakeModel(`{"word":false,"definition":123,"examples":["Elle {s'est rendu compte} du problème.", 7]}`, `{"word":null}`);
    const draft = await model.drafter.draft("to realise", {});
    expect(draft.filled).toEqual({});
    expect(draft.examples).toEqual(["Elle {s'est rendu compte} du problème."]);
    expect([...draft.unfilled].sort()).toEqual(["definition", "gender", "word"]);
  });

  test("drafts a noun's gender", async () => {
    expect((await fakeModel(plot).drafter.draft("a plot", {})).filled.gender).toBe("feminine");
  });

  test("a gender contradicting the article is retried, then the article decides", async () => {
    const wrong = plot.replace('"feminine"', '"masculine"');
    const model = fakeModel(wrong, wrong);
    const draft = await model.drafter.draft("a plot", {});
    expect(model.prompts).toHaveLength(2);
    expect(draft.filled.gender).toBe("feminine");
    expect(draft.unfilled.size).toBe(0);
  });

  test("the learner's word decides the gender, and their gender is kept", async () => {
    const fromWord = await fakeModel(plot.replace('"feminine"', '"none"')).drafter.draft("a plot", { word: "une intrigue" });
    expect(fromWord.filled.gender).toBe("feminine");

    const model = fakeModel(plot, plot);
    const kept = await model.drafter.draft("a tree", { gender: "masculine" });
    expect(model.prompts[0]).toContain("Gender: masculine");
    expect(kept.filled.gender).toBeUndefined();
    // "une intrigue" contradicts the learner's masculine, so the word and its example aren't used.
    expect(kept.filled.word).toBeUndefined();
    expect(kept.examples).toEqual([]);
  });

  test("does not ask the model when nothing is left to draft", async () => {
    const model = fakeModel();
    const draft = await model.drafter.draft("to realise", { word: "réaliser", gender: "none", definition: "Comprendre." },
      ["Il {réalise}.", "Elle {réalise} tout.", "On {réalise} enfin."]);
    expect(draft.filled).toEqual({});
    expect(draft.unfilled.size).toBe(0);
    expect(model.prompts).toEqual([]);
  });

  test("needs the English meaning", async () => {
    await expect(fakeModel().drafter.draft("  ", {})).rejects.toThrow(/English meaning/);
  });
});
