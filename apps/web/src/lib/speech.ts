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
      const finish = (error?: Error) => {
        utterance.onstart = null; utterance.onend = null; utterance.onerror = null;
        this.pending = null;
        if (error) reject(error); else resolve();
      };
      utterance.onstart = () => { started = true; };
      utterance.onend = () => finish(started ? undefined : new Error("Playback did not start"));
      utterance.onerror = () => finish(new Error("Playback failed. Try again or mute listening."));
      this.pending = () => finish(new Error("Playback cancelled"));
      try { speechSynthesis.speak(utterance); } catch { finish(new Error("Playback failed")); }
    });
  }
  cancel() {
    this.pending?.();
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  }
}

export const browserSpeech: SpeechEngine = new BrowserSpeech();
