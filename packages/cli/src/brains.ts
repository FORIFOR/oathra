import type { BrainProvider } from "@oathra/core";
import { GeminiBrain } from "@oathra/gemini";
import { OllamaBrain } from "@oathra/ollama";
import { OpenAIBrain } from "@oathra/openai";
import { ScriptedAgent } from "@oathra/simulator";

/**
 * Brain registry.
 *
 *   scripted            offline baseline, no API key (used by `demo`)
 *   openai[:model]      OPENAI_API_KEY
 *   gemini[:model]      GEMINI_API_KEY
 *   ollama[:model]      local, no key
 *
 * `name:model` splits on the first colon only, so `ollama:qwen2.5:7b` works.
 */
type Entry = {
  create: (model?: string) => BrainProvider;
  envKey?: string;
  keyUrl?: string;
};

const registry: Record<string, Entry> = {
  scripted: { create: () => new ScriptedAgent() },
  openai: { create: (model) => new OpenAIBrain(model ? { model } : {}), envKey: "OPENAI_API_KEY", keyUrl: "https://platform.openai.com/api-keys" },
  gemini: { create: (model) => new GeminiBrain(model ? { model } : {}), envKey: "GEMINI_API_KEY", keyUrl: "https://aistudio.google.com/apikey" },
  ollama: { create: (model) => new OllamaBrain(model ? { model } : {}) },
};

/** Backwards-compatible factory map (name -> default-model factory). */
export const brains: Record<string, () => BrainProvider> = Object.fromEntries(
  Object.entries(registry).map(([name, e]) => [name, () => e.create()]),
);

export function parseBrainSpec(spec: string): { name: string; model?: string } {
  const i = spec.indexOf(":");
  if (i < 0) return { name: spec };
  const model = spec.slice(i + 1);
  return model ? { name: spec.slice(0, i), model } : { name: spec.slice(0, i) };
}

export function resolveBrain(spec: string): BrainProvider {
  const { name, model } = parseBrainSpec(spec);
  const entry = registry[name];
  if (!entry) {
    throw new Error(`Unknown brain "${name}". Available: ${Object.keys(registry).join(", ")}`);
  }
  if (entry.envKey && !process.env[entry.envKey]) {
    throw new Error(`${entry.envKey} is not set. Get one at ${entry.keyUrl}`);
  }
  return entry.create(model);
}

/** Speech-to-speech specs: "realtime", "realtime:<model>", or a bare gpt-realtime* model id. */
export const DEFAULT_REALTIME_MODEL = "gpt-realtime-2.1";

/** GPT-Live specs: "live", "live:<model>", or a bare gpt-live* model id. */
export const DEFAULT_LIVE_MODEL = "gpt-live-1";

export function liveModelOf(spec: string): string | undefined {
  const { name, model } = parseBrainSpec(spec);
  if (name === "live") return model ?? DEFAULT_LIVE_MODEL;
  if (/^gpt-live/.test(spec)) return spec;
  return undefined;
}

export function realtimeModelOf(spec: string): string | undefined {
  const { name, model } = parseBrainSpec(spec);
  if (name === "realtime") return model ?? DEFAULT_REALTIME_MODEL;
  if (/^gpt-realtime/.test(spec)) return spec;
  return undefined;
}

export type BrainStatus = { name: string; ready: boolean; reason?: string };

/** Readiness of each registered brain (for `doctor`). Does not touch the network. */
export function listBrains(): BrainStatus[] {
  const realtime: BrainStatus = process.env.OPENAI_API_KEY
    ? { name: "realtime", ready: true, reason: `speech-to-speech, default ${DEFAULT_REALTIME_MODEL} (real calls only)` }
    : { name: "realtime", ready: false, reason: "OPENAI_API_KEY not set (https://platform.openai.com/api-keys)" };
  return [...Object.entries(registry).map(([name, e]) => {
    if (e.envKey && !process.env[e.envKey]) return { name, ready: false, reason: `${e.envKey} not set (${e.keyUrl})` };
    if (name === "ollama") return { name, ready: true, reason: `no key needed; requires a running Ollama at ${process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434"} (not checked)` };
    return { name, ready: true };
  }), realtime];
}
