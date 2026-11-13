import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, test } from "vitest";
import type { LibrarySearch } from "@/lib/library";
import { DAY, NOW, libraryEntry } from "@/test/fixtures";
import { LibraryView } from "./LibraryView";

const entries = [
  libraryEntry({ entryId: "a", word: "pourtant", english: "however", rank: 20,
    skills: { Reading: { due: NOW - DAY, state: "REVIEW", pausedUntil: 0, suspendedUntil: 0 } } }),
  libraryEntry({ entryId: "c", word: "une intrigue", english: "a plot", rank: 3000, gender: "feminine" }),
  libraryEntry({ entryId: "b", word: "fiable", english: "reliable", rank: 8000, origin: "pack:fr-source-extended-2026-11-v1", installed: false }),
];

function Harness({ initial = {} }: { initial?: LibrarySearch }) {
  const [search, setSearch] = useState<LibrarySearch>(initial);
  return (
    <>
      <output data-testid="search">{JSON.stringify(search)}</output>
      <LibraryView entries={entries} search={search} onSearch={setSearch} now={NOW} />
    </>
  );
}

describe("LibraryView", () => {
  test("lists entries with origin and per-skill status", () => {
    render(<Harness />);
    const row = screen.getByText("pourtant").closest("tr")!;
    expect(within(row).getByText("Due")).toBeInTheDocument();
    expect(within(row).getAllByText("New")).toHaveLength(2);
    expect(within(row).getByTitle("Gender: not a noun")).toHaveTextContent("—");
    expect(screen.getByText(/not installed/)).toBeInTheDocument();
    expect(screen.getByText("3 of 3 entries")).toBeInTheDocument();
  });

  test("tags nouns with their gender and gives them a Gender card", () => {
    render(<Harness />);
    const row = screen.getByText("une intrigue").closest("tr")!;
    expect(within(row).getByText("f.")).toBeInTheDocument();
    expect(within(row).getAllByText("New")).toHaveLength(4);
  });

  test("searching narrows the list and updates the search params", async () => {
    render(<Harness />);
    await userEvent.type(screen.getByRole("searchbox", { name: /search/i }), "reli");
    expect(screen.queryByText("pourtant")).not.toBeInTheDocument();
    expect(screen.getByText("1 of 3 entries")).toBeInTheDocument();
    expect(screen.getByTestId("search")).toHaveTextContent('{"q":"reli"}');
  });

  test("filters can be chosen and cleared", async () => {
    render(<Harness />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Pack" }), "notInstalled");
    expect(screen.queryByText("pourtant")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("pourtant")).toBeInTheDocument();
  });

  test("explains when nothing matches", () => {
    render(<Harness initial={{ q: "zzz" }} />);
    expect(screen.getByText("No entries match these filters.")).toBeInTheDocument();
  });
});
