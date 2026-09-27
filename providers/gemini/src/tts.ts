import { bytesToInt16, mulawEncode, StreamResampler } from "@oathra/audio-kit";

export type GeminiTTSOptions = {
  apiKey?: string;
  baseUrl?: string;
  /** Flash-Lite is the low-latency TTS; Flash (`gemini-3.8-flash-tts`) is slower but finer. */
  model?: string;
  voice?: string;
  /** Acting direction sent as `speech_metadata` style with every utterance. */
  style?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
};

export const DEFAULT_GEMINI_TTS_MODEL = "gemini-3.8-flash-lite-tts";
const PCM_RATE = 24000;

/**
 * Gemini text-to-speech over the Interactions API, streamed (SSE). Audio arrives as `step.delta` events
 * carrying 24 kHz l16 PCM; `step.stop` marks the last of it. The interaction itself keeps running for a few
 * seconds after that (usage accounting), so reading stops at `step.stop` rather than at the end of the stream.
 */
export class GeminiTTS {
  readonly name: string;
  readonly model: string;
  readonly voice: string;
  readonly style: string | undefined;
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: GeminiTTSOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY;
    this.baseUrl = (opts.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
    this.model = opts.model ?? DEFAULT_GEMINI_TTS_MODEL;
    this.voice = opts.voice ?? "Leda";
    this.style = opts.style;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.fetchImpl = opts.fetch ?? fetch;
    this.name = `gemini-tts:${this.model}:${this.voice}`;
  }

  /** 24 kHz PCM chunks as they arrive. Leaving the loop early aborts the request. */
  async *streamPcm24k(text: string): AsyncIterable<Int16Array> {
    if (!this.apiKey) throw new Error("GEMINI_API_KEY is not set. Get one at https://aistudio.google.com/apikey");
    const content: Record<string, unknown> = { type: "text", text };
    if (this.style) content.annotations = [{ type: "speech_metadata", style: this.style }];
    const body = {
      model: this.model,
      input: [{ type: "user_input", content: [content] }],
      response_format: { type: "audio", mime_type: "audio/l16", sample_rate: PCM_RATE },
      generation_config: { speech_config: [{ voice: this.voice }] },
      stream: true,
    };
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(new Error("Gemini TTS timed out")), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/interactions?alt=sse`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify(body),
        signal: abort.signal,
      });
      if (!res.ok) throw new Error(`Gemini TTS ${res.status}: ${(await res.text()).slice(0, 300)}`);
      if (!res.body) return;
      const decoder = new TextDecoder();
      let buf = "";
      for await (const piece of res.body as unknown as AsyncIterable<Uint8Array>) {
        buf += decoder.decode(piece, { stream: true });
        for (let end = buf.indexOf("\n\n"); end >= 0; end = buf.indexOf("\n\n")) {
          const event = parseEvent(buf.slice(0, end));
          buf = buf.slice(end + 2);
          if (!event) continue;
          if (event.event_type === "step.delta") {
            const d = event.delta as { type?: string; data?: string } | undefined;
            if (d?.type === "audio" && d.data) yield bytesToInt16(new Uint8Array(Buffer.from(d.data, "base64")));
          } else if (event.event_type === "step.stop" || event.event_type === "interaction.completed") return;
          else if (event.event_type === "error" || event.error) throw new Error(`Gemini TTS: ${JSON.stringify(event.error ?? event).slice(0, 300)}`);
        }
      }
    } finally {
      clearTimeout(timer);
      abort.abort();
    }
  }

  /** Streaming 8 kHz μ-law for the phone line (the pipeline engine's `synthesizeMulaw8kStream`). */
  async *synthesizeMulaw8kStream(text: string, _opts?: { language?: string }): AsyncIterable<Uint8Array> {
    const resampler = new StreamResampler(PCM_RATE, 8000);
    // Keep whole 24k→8k groups (3 samples) so resampling stays aligned across network chunks.
    let carry = new Int16Array(0);
    for await (const pcm of this.streamPcm24k(text)) {
      const joined = new Int16Array(carry.length + pcm.length);
      joined.set(carry, 0);
      joined.set(pcm, carry.length);
      const usable = joined.length - (joined.length % 3);
      carry = joined.slice(usable);
      if (usable > 0) yield mulawEncode(resampler.process(joined.subarray(0, usable)));
    }
  }

  async synthesizeMulaw8k(text: string, opts?: { language?: string }): Promise<Uint8Array> {
    const parts: Uint8Array[] = [];
    for await (const chunk of this.synthesizeMulaw8kStream(text, opts)) parts.push(chunk);
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
}

function parseEvent(raw: string): Record<string, unknown> | undefined {
  const data = raw.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
  if (!data || data === "[DONE]") return undefined;
  try { return JSON.parse(data) as Record<string, unknown>; } catch { return undefined; }
}
