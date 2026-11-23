import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName, type FunctionReference } from "convex/server";
import { afterEach, expect, test, vi } from "vitest";
import { PracticeBlock, type StoredBlock } from "@backend/practiceBlock";
import type { StudyCard } from "@/lib/study";
import { saveExtraBlock } from "@/lib/blockStorage";
import { StudyPage } from "./StudyPage";

const { query, fetchQuery, answer, tick } = vi.hoisted(() => ({ query: vi.fn(), fetchQuery: vi.fn(), answer: vi.fn(), tick: vi.fn(async () => {}) }));
vi.mock("@/lib/convex", () => ({
  useTokenQuery: query,
  useTokenFetch: () => fetchQuery,
  useTokenMutation: (ref: FunctionReference<"mutation">) => getFunctionName(ref) === "study:answer" ? answer : tick,
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
let originalLocks: PropertyDescriptor | undefined;
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  if (originalLocks) Object.defineProperty(navigator, "locks", originalLocks); else Reflect.deleteProperty(navigator, "locks");
});

test("a failed last-slot answer refreshes the summary's allowance before retry reaches it", async () => {
  vi.spyOn(Date, "now").mockReturnValue(new Date(2026, 10, 20, 12).getTime());
  originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: (_key: string, action: () => Promise<unknown>) => action() } });
  saveExtraBlock(PracticeBlock.grant("2026-11-20", 900, 5).introduced(true, false).toJSON());
  const card: StudyCard = {
    key: "word:Reading", skill: "Reading", version: null, card: null, entryId: "word", hook: "", newMeaning: true, newGender: false,
    entry: { word: "avoir", english: "have", definition: "Posséder.", examples: ["{Avoir} de la force."], topic: "daily", lemma: "avoir", rank: 3000, sourceUrl: "", license: "", gender: null },
    example: "{Avoir} de la force.",
  };
  query.mockImplementation((ref: FunctionReference<"query">, args: { block?: StoredBlock | null }) => {
    switch (getFunctionName(ref)) {
      case "study:progress": return { seconds: 900, phase: "cleanup" };
      case "study:scheduling": return null;
      case "study:summary": return { due: 0, dueCapped: false };
      case "study:offer": return args.block?.meaningsUsed === 2 ? "extraBlock" : "practice";
      default: throw new Error("Unexpected subscription");
    }
  });
  fetchQuery.mockImplementation(async (ref: FunctionReference<"query">, args: { block?: StoredBlock | null }) => {
    if (getFunctionName(ref) === "study:progress") return { seconds: 900, phase: "cleanup" };
    if (getFunctionName(ref) === "study:next") return args.block?.meaningsUsed === 2 ? null : card;
    throw new Error("Unexpected fetch");
  });
  answer.mockRejectedValue(new Error("Offline"));
  render(<StudyPage />);
  await userEvent.click(await screen.findByRole("button", { name: "Reveal answer" }));
  await userEvent.click(screen.getByRole("button", { name: /Good/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Offline");
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Session complete.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "+5 minutes" })).toBeInTheDocument();
});
