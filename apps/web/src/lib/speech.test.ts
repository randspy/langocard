import { afterEach, expect, test, vi } from "vitest";
import { browserSpeech, frenchVoice, type SpeechVoice } from "./speech";

afterEach(() => { browserSpeech.cancel(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const voice: SpeechVoice = { id: "fr", name: "French", lang: "fr-FR", local: true };

test("French voice selection prefers installed voices then France and excludes other languages", () => {
  expect(frenchVoice([{ ...voice, lang: "en-GB" }])).toBeNull();
  expect(frenchVoice([{ ...voice, id: "remote", local: false }, { ...voice, id: "canada", lang: "fr-CA" }])?.id).toBe("canada");
  expect(frenchVoice([{ ...voice, id: "canada", lang: "fr-CA" }, voice])?.id).toBe("fr");
});

test("French voice selection prefers a standard macOS voice over alternate voices for the same locale", () => {
  const thomas = { ...voice, id: "com.apple.voice.compact.fr-FR.Thomas", name: "Thomas" };
  const eddy = { ...voice, id: "com.apple.eloquence.fr-FR.Eddy", name: "Eddy" };
  expect(frenchVoice([eddy, thomas])).toBe(thomas);
  expect(frenchVoice([eddy])).toBe(eddy);
  const firefoxEddy = { ...eddy, id: `urn:moz-tts:osx:${eddy.id}` };
  const firefoxThomas = { ...thomas, id: `urn:moz-tts:osx:${thomas.id}` };
  expect(frenchVoice([firefoxEddy, firefoxThomas])).toBe(firefoxThomas);
});

test("the browser adapter requires both start and end and rejects missing or failed playback", async () => {
  class Utterance {
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    voice: unknown = null;
    lang = "";
  }
  let utterance = new Utterance();
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  const french = { voiceURI: voice.id, name: voice.name, lang: voice.lang, localService: voice.local };
  const english = { ...french, name: "English", lang: "en-US" };
  let available = [english, french];
  vi.stubGlobal("speechSynthesis", {
    getVoices: () => available,
    speak: (u: Utterance) => { utterance = u; }, cancel: () => {},
  });
  const notStarted = browserSpeech.speak("Bonjour", voice);
  utterance.onend?.();
  await expect(notStarted).rejects.toThrow("did not start");
  const succeeded = browserSpeech.speak("Bonjour", voice);
  utterance.onstart?.(); utterance.onend?.();
  await expect(succeeded).resolves.toBeUndefined();
  expect(utterance.voice).toBe(french);
  expect(utterance.lang).toBe("fr-FR");
  const failed = browserSpeech.speak("Bonjour", voice);
  utterance.onerror?.();
  await expect(failed).rejects.toThrow("Playback failed");
  available = [english];
  await expect(browserSpeech.speak("Bonjour", voice)).rejects.toThrow("The French voice is unavailable");
});


test("idle cancellation leaves other speech alone; silent requests time out and can be retried", async () => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  vi.stubGlobal("SpeechSynthesisUtterance", class {});
  vi.stubGlobal("speechSynthesis", {
    getVoices: () => [{ voiceURI: "fr", name: "French", lang: "fr-FR", localService: true }],
    speak: vi.fn(), cancel,
  });
  browserSpeech.cancel();
  expect(cancel).not.toHaveBeenCalled();
  const pending = browserSpeech.speak("Bonjour", voice);
  expect(cancel).not.toHaveBeenCalled();
  const failure = expect(pending).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(15_000);
  await failure;
  expect(cancel).toHaveBeenCalledTimes(1);
  browserSpeech.cancel();
  expect(cancel).toHaveBeenCalledTimes(1);
  const retry = browserSpeech.speak("Bonjour", voice);
  const cancelled = expect(retry).rejects.toThrow("cancelled");
  browserSpeech.cancel();
  await cancelled;
  expect(cancel).toHaveBeenCalledTimes(2);
});
