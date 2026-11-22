/**
 * A small instruct model running in this browser through WebLLM (WebGPU). The model is
 * downloaded once, only when the learner asks, into the browser's cache storage; after that
 * it works offline and nothing the learner types leaves the browser. The only module that
 * knows about WebLLM, like Android's `OnDeviceModel`. See `docs/design/web-practice.md`
 * for the model choice.
 */
import type { MLCEngine } from "@mlc-ai/web-llm";

/** WebLLM's prebuilt Gemma 2 2B instruct model (q4f16, about 1.9 GB of GPU memory). */
export const MODEL_ID = "gemma-2-2b-it-q4f16_1-MLC";
export const MODEL_SIZE = "about 1.5 GB";

export type Availability =
  | { kind: "checking" }
  /** No WebGPU, or a GPU without 16-bit float shaders: AI fill stays hidden. */
  | { kind: "unavailable" }
  | { kind: "downloadable"; problem?: string }
  | { kind: "downloading"; progress: number }
  | { kind: "available" };

/** What the New entry page needs from an on-device model; tests pass a fake. */
export interface OnDeviceModel {
  availability(): Promise<Availability>;
  /** Downloads (if needed) and loads the model, reporting progress from 0 to 1. */
  download(onProgress: (progress: number) => void): Promise<void>;
  generate(prompt: string): Promise<string>;
  /** Unloads the model and deletes it from browser storage. */
  remove(): Promise<void>;
}

type GpuNavigator = Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } };

export class WebLlmModel implements OnDeviceModel {
  private engine: Promise<MLCEngine> | null = null;

  async availability(): Promise<Availability> {
    const gpu = (navigator as GpuNavigator).gpu;
    const adapter = gpu ? await gpu.requestAdapter().catch(() => null) : null;
    if (!adapter?.features.has("shader-f16")) return { kind: "unavailable" };
    const { hasModelInCache } = await import("@mlc-ai/web-llm");
    return (await hasModelInCache(MODEL_ID)) ? { kind: "available" } : { kind: "downloadable" };
  }

  download(onProgress: (progress: number) => void): Promise<void> {
    return this.load(onProgress).then(() => undefined);
  }

  async generate(prompt: string): Promise<string> {
    const engine = await this.load(() => {});
    const reply = await engine.chat.completions.create({ messages: [{ role: "user", content: prompt }], temperature: 0.3 });
    return reply.choices[0]?.message.content ?? "";
  }

  async remove(): Promise<void> {
    const engine = this.engine;
    this.engine = null;
    await engine?.then((e) => e.unload()).catch(() => {});
    const { deleteModelAllInfoInCache } = await import("@mlc-ai/web-llm");
    await deleteModelAllInfoInCache(MODEL_ID);
  }

  private load(onProgress: (progress: number) => void): Promise<MLCEngine> {
    if (!this.engine) {
      this.engine = import("@mlc-ai/web-llm").then(({ CreateMLCEngine }) =>
        CreateMLCEngine(MODEL_ID, { initProgressCallback: (report) => onProgress(report.progress) }));
      this.engine.catch(() => { this.engine = null; });
    }
    return this.engine;
  }
}
