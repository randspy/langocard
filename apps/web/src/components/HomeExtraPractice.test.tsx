import { render, screen } from "@testing-library/react";
import { getFunctionName, type FunctionReference } from "convex/server";
import { afterEach, expect, test, vi } from "vitest";
import { HomeExtraPractice } from "./HomeExtraPractice";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/convex", () => ({ useTokenQuery: query, useTokenFetch: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); query.mockReset(); });

test("browsing before the daily target never runs practice eligibility", () => {
  query.mockImplementation((ref: FunctionReference<"query">) => {
    if (getFunctionName(ref) === "study:progress") return { seconds: 899 };
    throw new Error("Run migrations first");
  });
  render(<><h1>Library</h1><HomeExtraPractice /></>);
  expect(screen.getByRole("heading", { name: "Library" })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(query).toHaveBeenCalledTimes(1);
});

test("a failed eligibility query is contained in the extra-practice panel", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  query.mockImplementation((ref: FunctionReference<"query">) => {
    if (getFunctionName(ref) === "study:progress") return { seconds: 900 };
    throw new Error("Too many blocked due cards");
  });
  render(<><h1>Library</h1><HomeExtraPractice /></>);
  expect(screen.getByRole("heading", { name: "Library" })).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("Extra practice is temporarily unavailable");
});
