import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import type { SpeechEngine, SpeechVoice } from "@/lib/speech";
import type { AnswerResult, StudyCard } from "@/lib/study";
import { StudySession } from "./StudySession";

const voice: SpeechVoice = { id: "fr", name: "French", lang: "fr-FR", local: true };
const card: StudyCard = {
  key: "arriver:Listening", skill: "Listening", version: null, card: null, entryId: "arriver", hook: "a train arriving",
  entry: { word: "arriver", english: "to arrive", definition: "Venir à destination.", examples: ["Elle {arrive|vient} demain."],
    topic: "daily", lemma: "arriver", rank: 1, sourceUrl: "", license: "", gender: null }, example: "Elle {arrive|vient} demain.",
};

class FakeSpeech implements SpeechEngine {
  finish: () => void = () => {};
  fail: () => void = () => {};
  voices() { return [voice]; }
  subscribe(_listener: () => void) { return () => {}; }
  speak = vi.fn(() => new Promise<void>((resolve, reject) => { this.finish = resolve; this.fail = () => reject(new Error("Audio failed")); }));
  cancel = vi.fn(() => {});
}

test("Reveal and Enter stay locked until successful playback; Listening does not accept alternatives", async () => {
  const speech = new FakeSpeech();
  const answer = vi.fn(async () => ({ status: "ok" as const, card: "", offerHook: false }));
  render(<StudySession speech={speech} fetchNext={async () => card} answer={answer} clock={() => 0} />);
  const reveal = await screen.findByRole("button", { name: "Reveal answer" });
  expect(reveal).toBeDisabled();
  expect(screen.getByText("Synthetic French speech")).toBeInTheDocument();
  expect(screen.queryByText("arriver")).not.toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Your answer (optional)"), "vient{Enter}");
  expect(answer).not.toHaveBeenCalled();
  expect(reveal).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Play example" }));
  expect(speech.speak).toHaveBeenCalledWith("Elle arrive demain.", voice);
  expect(reveal).toBeDisabled();
  await act(async () => speech.fail());
  expect(screen.getByRole("alert")).toHaveTextContent("Playback failed");
  expect(reveal).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Play example" }));
  await act(async () => speech.finish());
  expect(reveal).toBeEnabled();
  await userEvent.click(screen.getByRole("button", { name: "Play example" }));
  expect(reveal).toBeDisabled();
  await act(async () => speech.finish());
  await userEvent.click(reveal);
  expect(screen.getByText("Expected:", { exact: false })).toBeInTheDocument();
  expect(screen.queryByText("Accepted:", { exact: false })).not.toBeInTheDocument();
  expect(screen.getByText("Memory hook: a train arriving")).toBeInTheDocument();
  expect(answer).not.toHaveBeenCalled();
});

test("muting cancels playback and fetches the next card without an assessment or further Listening", async () => {
  const speech = new FakeSpeech();
  const queue: (StudyCard | null)[] = [card, null];
  const fetchNext = vi.fn(async () => queue.shift() ?? null);
  const answer = vi.fn(async () => ({ status: "stale" as const }));
  render(<StudySession speech={speech} fetchNext={fetchNext} answer={answer} clock={() => 0} />);
  await userEvent.click(await screen.findByRole("button", { name: "Play example" }));
  await userEvent.click(screen.getByRole("button", { name: "Mute listening" }));
  expect(await screen.findByText("Session complete.")).toBeInTheDocument();
  expect(fetchNext).toHaveBeenNthCalledWith(1, [], true);
  expect(fetchNext).toHaveBeenLastCalledWith([], false);
  expect(answer).not.toHaveBeenCalled();
  expect(speech.cancel).toHaveBeenCalled();
  await act(async () => speech.finish());
  expect(screen.getByText("Session complete.")).toBeInTheDocument();
});


test("a session with no French voice fetches without Listening enabled", async () => {
  const speech = new FakeSpeech();
  speech.voices = () => [];
  const fetchNext = vi.fn(async () => null);
  render(<StudySession speech={speech} fetchNext={fetchNext} answer={async () => ({ status: "stale" })} clock={() => 0} />);
  expect(await screen.findByText("Session complete.")).toBeInTheDocument();
  expect(fetchNext).toHaveBeenCalledWith([], false);
});


test("French voices arriving after an empty initial sitting make Listening available", async () => {
  const speech = new FakeSpeech();
  let voices: SpeechVoice[] = [];
  let changed = () => {};
  speech.voices = () => voices;
  speech.subscribe = (listener: () => void) => { changed = listener; return () => {}; };
  const fetchNext = vi.fn(async (_pending: string[], audio: boolean) => audio ? card : null);
  render(<StudySession speech={speech} fetchNext={fetchNext} answer={async () => ({ status: "stale" })} clock={() => 0} />);
  expect(await screen.findByText("Session complete.")).toBeInTheDocument();
  await act(async () => { voices = [voice]; changed(); });
  expect(await screen.findByRole("button", { name: "Play example" })).toBeInTheDocument();
  expect(fetchNext).toHaveBeenLastCalledWith([], true);
});


test("a voice arriving while an answer saves is used by the next fetch", async () => {
  const speech = new FakeSpeech();
  let voices: SpeechVoice[] = [];
  let changed = () => {};
  speech.voices = () => voices;
  speech.subscribe = (listener) => { changed = listener; return () => {}; };
  let complete = () => {};
  const answer = vi.fn(() => new Promise<AnswerResult>((resolve) => { complete = () => resolve({ status: "ok", card: "", offerHook: false }); }));
  let calls = 0;
  const fetchNext = vi.fn(async (_pending: string[], audio: boolean) => ++calls === 1 ? { ...card, key: "arriver:Reading", skill: "Reading" as const } : audio ? card : null);
  render(<StudySession speech={speech} fetchNext={fetchNext} answer={answer} clock={() => 0} />);
  await userEvent.click(await screen.findByRole("button", { name: "Reveal answer" }));
  await userEvent.click(screen.getByRole("button", { name: /Good/ }));
  await act(async () => { voices = [voice]; changed(); });
  await act(async () => complete());
  expect(await screen.findByRole("button", { name: "Play example" })).toBeInTheDocument();
  expect(fetchNext).toHaveBeenLastCalledWith(["arriver:Reading"], true);
});

test("an empty in-flight request is retried when French audio becomes available", async () => {
  const speech = new FakeSpeech();
  let voices: SpeechVoice[] = [];
  let changed = () => {};
  speech.voices = () => voices;
  speech.subscribe = (listener) => { changed = listener; return () => {}; };
  let complete: (value: StudyCard | null) => void = () => {};
  const fetchNext = vi.fn((_pending: string[], audio: boolean) => audio ? Promise.resolve(card) : new Promise<StudyCard | null>(resolve => { complete = resolve; }));
  render(<StudySession speech={speech} fetchNext={fetchNext} answer={async () => ({ status: "stale" })} clock={() => 0} />);
  await act(async () => {});
  await act(async () => { voices = [voice]; changed(); complete(null); });
  expect(await screen.findByRole("button", { name: "Play example" })).toBeInTheDocument();
  expect(fetchNext).toHaveBeenLastCalledWith([], true);
});

test("a Listening result is discarded if the French voice disappeared during its request", async () => {
  const speech = new FakeSpeech();
  let voices = [voice];
  let changed = () => {};
  speech.voices = () => voices;
  speech.subscribe = (listener) => { changed = listener; return () => {}; };
  let complete: (value: StudyCard | null) => void = () => {};
  const fetchNext = vi.fn((_pending: string[], audio: boolean) => !audio ? Promise.resolve(null) : new Promise<StudyCard | null>(resolve => { complete = resolve; }));
  const answer = vi.fn(async () => ({ status: "stale" as const }));
  render(<StudySession speech={speech} fetchNext={fetchNext} answer={answer} clock={() => 0} />);
  await act(async () => {});
  await act(async () => { voices = []; changed(); complete(card); });
  expect(await screen.findByText("Session complete.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Play example" })).not.toBeInTheDocument();
  expect(fetchNext).toHaveBeenLastCalledWith([], false);
  expect(answer).not.toHaveBeenCalled();
});
