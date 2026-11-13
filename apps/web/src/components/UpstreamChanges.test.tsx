import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from "@tanstack/react-router";
import { describe, expect, test, vi } from "vitest";
import { UpstreamChanges, type UpstreamChange } from "./UpstreamChanges";

const content = {
  word: "avoir", english: "have", definition: "Posséder.", example: "{Avoir} de la force.", topic: "daily",
  lemma: "avoir", rank: 6, sourceUrl: "", license: "", gender: null,
};
const change: UpstreamChange = { entryId: "frw-1", origin: "bundled", mine: { ...content, definition: "Mine." }, theirs: { ...content, definition: "Détenir." } };

/** Links need a router; render inside a minimal one. */
function renderWithRouter(ui: React.ReactNode) {
  const router = createRouter({ routeTree: createRootRoute({ component: () => ui }), history: createMemoryHistory() });
  render(<RouterProvider router={router} />);
}

describe("UpstreamChanges", () => {
  test("shows only the fields that differ", async () => {
    renderWithRouter(<UpstreamChanges changes={[change]} onResolve={vi.fn()} />);
    const card = await screen.findByRole("article", { name: "avoir" });
    const rows = within(card).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("DefinitionMine.Détenir.");
  });

  test("resolves with the chosen version", async () => {
    const onResolve = vi.fn(async () => {});
    renderWithRouter(<UpstreamChanges changes={[change]} onResolve={onResolve} />);
    await userEvent.click(await screen.findByRole("button", { name: "Take theirs" }));
    expect(onResolve).toHaveBeenCalledWith("frw-1", "takeTheirs");
    await userEvent.click(screen.getByRole("button", { name: "Keep mine" }));
    expect(onResolve).toHaveBeenCalledWith("frw-1", "keepMine");
  });

  test("explains an empty list", async () => {
    renderWithRouter(<UpstreamChanges changes={[]} onResolve={vi.fn()} />);
    expect(await screen.findByText(/No upstream changes/)).toBeInTheDocument();
  });
});
