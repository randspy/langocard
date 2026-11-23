import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ExtraPracticeButtons } from "./ExtraPracticeOffer";

test("choosing an extra duration prevents a second choice while its grant is pending", async () => {
  let finish = () => {};
  const start = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  render(<ExtraPracticeButtons start={start} />);
  await userEvent.click(screen.getByRole("button", { name: "+10 minutes" }));
  expect(start).toHaveBeenCalledWith(10);
  expect(screen.getByRole("button", { name: "+5 minutes" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "+15 minutes" }));
  expect(start).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(screen.getByRole("button", { name: "+5 minutes" })).toBeEnabled();
});

test("a failed grant or storage write shows the error and permits retry", async () => {
  const start = vi.fn().mockRejectedValueOnce(new Error("Storage unavailable")).mockResolvedValue(undefined);
  render(<ExtraPracticeButtons start={start} />);
  await userEvent.click(screen.getByRole("button", { name: "+5 minutes" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Storage unavailable");
  await userEvent.click(screen.getByRole("button", { name: "+5 minutes" }));
  expect(start).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
