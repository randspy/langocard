import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName, type FunctionReference } from "convex/server";
import { expect, test, vi } from "vitest";
import { PacksPage } from "./PacksPage";

const { setPreferences, installPack } = vi.hoisted(() => ({ setPreferences: vi.fn(async () => {}), installPack: vi.fn(async () => {}) }));
vi.mock("@/lib/convex", () => ({
  useTokenQuery: (ref: FunctionReference<"query">) => getFunctionName(ref) === "packs:learningPreferences"
    ? { minimumRank: 2501, interests: ["daily", "news"] } : ["fr-core-everyday-2026-11-v1"],
  useTokenMutation: (ref: FunctionReference<"mutation">) => getFunctionName(ref) === "packs:setPreferences" ? setPreferences : installPack,
}));

test("preferences write the synced settings and keep one topic", async () => {
  render(<PacksPage />);
  await userEvent.click(screen.getByLabelText("All ranks"));
  expect(setPreferences).toHaveBeenLastCalledWith({ minimumRank: 1, interests: ["daily", "news"] });
  await userEvent.click(screen.getByLabelText("Culture"));
  expect(setPreferences).toHaveBeenLastCalledWith({ minimumRank: 2501, interests: ["daily", "news", "culture"] });
  await userEvent.click(screen.getByLabelText("News"));
  expect(setPreferences).toHaveBeenLastCalledWith({ minimumRank: 2501, interests: ["daily"] });
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
