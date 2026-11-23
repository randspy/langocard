import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName, type FunctionReference } from "convex/server";
import { beforeEach, expect, test, vi } from "vitest";
import { PACKS } from "@/lib/packs";
import { PacksPage } from "./PacksPage";

const { prefs, setPreferences, installPack } = vi.hoisted(() => ({
  prefs: { minimumRank: 2501, interests: ["daily", "news"] },
  setPreferences: vi.fn(async () => {}), installPack: vi.fn(async () => {}),
}));
vi.mock("@tanstack/react-router", () => ({ Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
vi.mock("@/lib/convex", () => ({
  useTokenQuery: (ref: FunctionReference<"query">) => getFunctionName(ref) === "packs:learningPreferences" ? prefs : ["fr-core-everyday-2026-11-v1"],
  useTokenMutation: (ref: FunctionReference<"mutation">) => getFunctionName(ref) === "packs:setPreferences" ? setPreferences : installPack,
}));
beforeEach(() => { vi.clearAllMocks(); prefs.minimumRank = 2501; prefs.interests = ["daily", "news"]; });

test("a rank choice sends only the rank", async () => {
  render(<PacksPage />);
  await userEvent.click(screen.getByLabelText("All ranks"));
  expect(setPreferences).toHaveBeenCalledWith({ minimumRank: 1 });
});

test("a topic click sends only that topic", async () => {
  render(<PacksPage />);
  await userEvent.click(screen.getByLabelText("Culture"));
  expect(setPreferences).toHaveBeenCalledWith({ topic: { name: "culture", selected: true } });
  await userEvent.click(screen.getByLabelText("News"));
  expect(setPreferences).toHaveBeenLastCalledWith({ topic: { name: "news", selected: false } });
});

test("the last topic can't be removed", async () => {
  prefs.interests = ["daily"];
  render(<PacksPage />);
  await userEvent.click(screen.getByLabelText("Daily life"));
  expect(setPreferences).not.toHaveBeenCalled();
});

test("packs show their state; an uninstalled pack installs with its source and licence, and none uninstall", async () => {
  render(<PacksPage />);
  expect(within(screen.getByRole("listitem", { name: "Frequent French" })).getByText("Built in")).toBeInTheDocument();
  expect(within(screen.getByRole("listitem", { name: "Everyday expansion" })).getByText("Installed")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Uninstall/ })).not.toBeInTheDocument();
  await userEvent.click(within(screen.getByRole("listitem", { name: "Beyond the everyday" })).getByRole("button", { name: "Install" }));
  expect(installPack).toHaveBeenCalledWith(expect.objectContaining({
    packId: "fr-core-extended-2026-11-v1", packVersion: 2, license: expect.stringContaining("CC BY-SA 4.0"), source: expect.stringContaining("Wiktionary"),
  }));
});

test("every catalogue pack carries its attribution", () => {
  expect(PACKS).toHaveLength(3);
  for (const pack of PACKS) expect(pack.source && pack.license).toBeTruthy();
});
