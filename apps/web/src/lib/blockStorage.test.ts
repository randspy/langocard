import { afterEach, expect, test, vi } from "vitest";
import { PracticeBlock } from "@backend/practiceBlock";
import { answerWithExtraBlock, createExtraBlock, readExtraBlock, saveExtraBlock } from "./blockStorage";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

test("stored usage survives a fresh read, resets for a new grant, and expires at midnight", () => {
  const day = "2026-11-20";
  const block = PracticeBlock.grant(day, 1020, 10).introduced(true, false);
  saveExtraBlock(block.toJSON());
  expect(PracticeBlock.read(readExtraBlock(), day, 1100).toJSON()).toEqual(block.toJSON());
  expect(PracticeBlock.read(readExtraBlock(), "2026-11-21", 0).isExtra).toBe(false);
  saveExtraBlock(PracticeBlock.grant(day, 1620, 5).toJSON());
  expect(PracticeBlock.read(readExtraBlock(), day, 1620).meaningRoom(100)).toBe(true);
});

test("malformed stored usage is review-only on every reload", () => {
  localStorage.setItem("langocard.extraBlock", JSON.stringify({ day: "2026-11-20", start: 900, minutes: 5, meaningsUsed: "0" }));
  for (let read = 0; read < 2; read++) {
    const block = PracticeBlock.read(readExtraBlock(), "2026-11-20", 950);
    expect(block.end).toBe(1200);
    expect(block.meaningRoom(0)).toBe(false);
    expect(block.genderRoom(0)).toBe(false);
  }
});


test.each(["ok", "stale"] as const)("a pending %s answer cannot overwrite another tab's newer grant", async status => {
  let tail = Promise.resolve();
  vi.stubGlobal("navigator", { locks: { request: (_key: string, action: () => Promise<unknown>) => {
    const next = tail.then(action);
    tail = next.then(() => {}, () => {});
    return next;
  } } });
  const day = "2026-11-20";
  const old = PracticeBlock.grant(day, 900, 5).introduced(true, false);
  saveExtraBlock(old.toJSON());
  let entered = () => {}, complete = () => {};
  const submitted = new Promise<void>(resolve => { entered = resolve; });
  const answering = answerWithExtraBlock({ day, newMeaning: true, newGender: false, loadSeconds: async () => 950,
    submit: async () => {
      entered();
      await new Promise<void>(resolve => { complete = resolve; });
      return status === "ok" ? { status, block: old.introduced(true, false).toJSON() } : { status };
    } });
  await submitted;
  expect(PracticeBlock.read(readExtraBlock(), day, 950).meaningRoom(0)).toBe(false);
  const replacement = PracticeBlock.grant(day, 950, 10).toJSON();
  const create = vi.fn(async () => replacement);
  const replacing = createExtraBlock(create);
  await Promise.resolve();
  expect(create).not.toHaveBeenCalled();
  complete();
  await Promise.all([answering, replacing]);
  expect(readExtraBlock()).toEqual(replacement);
});

test("a storage read failure blocks submission instead of falling back to daily allowance", async () => {
  saveExtraBlock(PracticeBlock.grant("2026-11-20", 900, 5).toJSON());
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Storage blocked"); });
  const submit = vi.fn(async () => ({ status: "ok" as const }));
  await expect(answerWithExtraBlock({ day: "2026-11-20", newMeaning: true, newGender: false, loadSeconds: async () => 950, submit })).rejects.toThrow("Storage blocked");
  expect(submit).not.toHaveBeenCalled();
});
