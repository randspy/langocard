/** Browser-independent speech boundary; a completed promise means playback started and ended. */
export type SpeechVoice = { id: string; name: string; lang: string; local: boolean };
export interface SpeechEngine {
  voices(): SpeechVoice[];
  subscribe(listener: () => void): () => void;
  speak(text: string, voice: SpeechVoice): Promise<void>;
  cancel(): void;
}

/** French voices only, preferring installed voices, then France, then a stable name. */
export function frenchVoice(voices: readonly SpeechVoice[]): SpeechVoice | null {
  return [...voices].filter(v => /^fr(?:-|$)/i.test(v.lang)).sort((a, b) =>
    Number(b.local) - Number(a.local) || Number(/^fr-FR$/i.test(b.lang)) - Number(/^fr-FR$/i.test(a.lang)) || a.name.localeCompare(b.name))[0] ?? null;
}

class BrowserSpeech implements SpeechEngine {
  private pending: (() => void) | null = null;
  voices() {
    return typeof speechSynthesis === "undefined" ? [] : speechSynthesis.getVoices().map(v => ({ id: v.voiceURI, name: v.name, lang: v.lang, local: v.localService }));
  }
  subscribe(listener: () => void) {
    if (typeof speechSynthesis === "undefined") return () => {};
    speechSynthesis.addEventListener("voiceschanged", listener);
    return () => speechSynthesis.removeEventListener("voiceschanged", listener);
  }
  speak(text: string, voice: SpeechVoice): Promise<void> {
    this.cancel();
    return new Promise((resolve, reject) => {
      if (typeof speechSynthesis === "undefined") return reject(new Error("Speech is unavailable"));
      const installed = speechSynthesis.getVoices().find(v => v.voiceURI === voice.id);
      if (!installed) return reject(new Error("The French voice is unavailable"));
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = installed;
      utterance.lang = installed.lang;
      let started = false;
      let settled = false;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        utterance.onstart = null; utterance.onend = null; utterance.onerror = null;
        this.pending = null;
        if (error) reject(error); else resolve();
      };
      utterance.onstart = () => { started = true; };
      utterance.onend = () => finish(started ? undefined : new Error("Playback did not start"));
      utterance.onerror = () => finish(new Error("Playback failed. Try again or mute listening."));
      this.pending = () => finish(new Error("Playback cancelled"));
      // Some engines emit no events (for example in a muted Chromium tab). Bound the wait,
      // allowing longer examples enough time at normal speaking speed.
      deadline = setTimeout(() => {
        finish(new Error("Playback timed out. Try again or mute listening."));
        speechSynthesis.cancel();
      }, Math.max(15_000, text.length * 150));
      try { speechSynthesis.speak(utterance); } catch { finish(new Error("Playback failed")); }
    });
  }
  cancel() {
    if (!this.pending) return;
    this.pending();
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  }
}

export const browserSpeech: SpeechEngine = new BrowserSpeech();
