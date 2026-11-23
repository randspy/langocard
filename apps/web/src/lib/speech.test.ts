import { afterEach, expect, test, vi } from "vitest";
import { browserSpeech, frenchVoice, type SpeechVoice } from "./speech";

afterEach(() => { vi.unstubAllGlobals(); });
const voice: SpeechVoice = { id: "fr", name: "French", lang: "fr-FR", local: true };

test("French voice selection prefers installed voices then France and excludes other languages", () => {
  expect(frenchVoice([{ ...voice, lang: "en-GB" }])).toBeNull();
  expect(frenchVoice([{ ...voice, id: "remote", local: false }, { ...voice, id: "canada", lang: "fr-CA" }])?.id).toBe("canada");
  expect(frenchVoice([{ ...voice, id: "canada", lang: "fr-CA" }, voice])?.id).toBe("fr");
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
  vi.stubGlobal("speechSynthesis", {
    getVoices: () => [{ voiceURI: "fr", name: "French", lang: "fr-FR", localService: true }],
    speak: (u: Utterance) => { utterance = u; }, cancel: () => {},
  });
  const notStarted = browserSpeech.speak("Bonjour", voice);
  utterance.onend?.();
  await expect(notStarted).rejects.toThrow("did not start");
  const succeeded = browserSpeech.speak("Bonjour", voice);
  utterance.onstart?.(); utterance.onend?.();
  await expect(succeeded).resolves.toBeUndefined();
  const failed = browserSpeech.speak("Bonjour", voice);
  utterance.onerror?.();
  await expect(failed).rejects.toThrow("Playback failed");
});
