import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName, type FunctionReference } from "convex/server";
import { beforeEach, expect, test, vi } from "vitest";
import items from "@content/placement-items.json";
import { PlacementPage } from "./PlacementPage";

const { progress, answer, retake, accept } = vi.hoisted(() => ({
  progress: { answers: [] as boolean[] }, answer: vi.fn(async () => {}), retake: vi.fn(async () => {}), accept: vi.fn(async () => {}),
}));
vi.mock("@tanstack/react-router", () => ({ Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
vi.mock("@/lib/convex", () => ({
  useTokenQuery: () => progress.answers,
  useTokenMutation: (ref: FunctionReference<"mutation">) =>
    ({ "placement:answer": answer, "placement:retake": retake, "placement:accept": accept })[getFunctionName(ref)],
}));
beforeEach(() => { vi.clearAllMocks(); });

test("resumes at the next word and saves each answer by position", async () => {
  progress.answers = [true, false];
  render(<PlacementPage />);
  expect(screen.getByText("2 / 90 · about 5 minutes total")).toBeInTheDocument();
  expect(screen.getByText(items[2].word)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "No / unsure" }));
  expect(answer).toHaveBeenCalledWith({ index: 2, known: false });
  expect(screen.getByText(/not been independently validated/)).toBeInTheDocument();
});

test("the result suggests a rank, saves the chosen one and can be retaken", async () => {
  progress.answers = items.map((item) => item.band === 0);
  render(<PlacementPage />);
  expect(screen.getByText("Suggested starting rank: 2,501")).toBeInTheDocument();
  expect(screen.getByText(/No cards are marked known/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Start at rank 7,001" }));
  expect(accept).toHaveBeenCalledWith({ rank: 7001 });
  await userEvent.click(screen.getByRole("button", { name: "Retake check" }));
  expect(retake).toHaveBeenCalled();
});
