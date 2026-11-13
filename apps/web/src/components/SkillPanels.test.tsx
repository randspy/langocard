import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { SUSPENDED_INDEFINITELY } from "@backend/merge";
import { DAY, NOW } from "@/test/fixtures";
import { SkillPanels, type CardActions, type SkillCard } from "./SkillPanels";

const reviewed: SkillCard = {
  skill: "Reading",
  card: { state: "REVIEW", step: null, stability: 4.25, difficulty: 5.5, due: NOW + 3 * DAY, lastReview: NOW - DAY },
  failures: 0, pausedUntil: 0, suspendedUntil: 0,
  reviews: [{ rating: "GOOD", at: NOW - DAY, durationMs: null, placement: false }, { rating: "AGAIN", at: NOW - 5 * DAY, durationMs: null, placement: true }],
};
const cards: SkillCard[] = [
  reviewed,
  { skill: "Listening", card: null, failures: 0, pausedUntil: 0, suspendedUntil: SUSPENDED_INDEFINITELY, reviews: [] },
  { skill: "Production", card: null, failures: 0, pausedUntil: 0, suspendedUntil: 0, reviews: [] },
];

function setup() {
  const actions: CardActions = { suspend: vi.fn(async () => {}), resume: vi.fn(async () => {}), reset: vi.fn(async () => {}) };
  render(<SkillPanels cards={cards} now={NOW} actions={actions} />);
  return actions;
}
const panel = (name: string) => screen.getByRole("article", { name: `${name} card` });

describe("SkillPanels", () => {
  test("shows FSRS state, suspension and review history", async () => {
    setup();
    expect(within(panel("Read")).getByText("Review")).toBeInTheDocument();
    expect(within(panel("Read")).getByText("4.3 days")).toBeInTheDocument();
    expect(within(panel("Listen")).getByText("until you resume it")).toBeInTheDocument();
    expect(within(panel("Speak")).getByText("Not studied yet.")).toBeInTheDocument();
    await userEvent.click(within(panel("Read")).getByText("2 reviews"));
    expect(within(panel("Read")).getByText("Placement")).toBeInTheDocument();
  });

  test("suspends indefinitely or until a date, and resumes", async () => {
    const actions = setup();
    await userEvent.click(within(panel("Read")).getByRole("button", { name: "Suspend" }));
    expect(actions.suspend).toHaveBeenCalledWith("Reading", null);
    await userEvent.type(within(panel("Speak")).getByLabelText("or until"), "2026-12-01");
    await userEvent.click(within(panel("Speak")).getByRole("button", { name: "Suspend until date" }));
    expect(actions.suspend).toHaveBeenCalledWith("Production", new Date("2026-12-01T00:00:00").getTime());
    await userEvent.click(within(panel("Listen")).getByRole("button", { name: "Resume" }));
    expect(actions.resume).toHaveBeenCalledWith("Listening");
  });

  test("reset asks for confirmation and is unavailable for new cards", async () => {
    const actions = setup();
    expect(within(panel("Speak")).getByRole("button", { name: "Reset…" })).toBeDisabled();
    await userEvent.click(within(panel("Read")).getByRole("button", { name: "Reset…" }));
    expect(actions.reset).not.toHaveBeenCalled();
    await userEvent.click(within(panel("Read")).getByRole("button", { name: "Reset read card" }));
    expect(actions.reset).toHaveBeenCalledWith("Reading");
  });

  test("whole-entry suspend becomes resume when any skill is suspended", async () => {
    const actions = setup();
    await userEvent.click(screen.getByRole("button", { name: "Resume all" }));
    expect(actions.resume).toHaveBeenCalledWith(undefined);
  });
});
