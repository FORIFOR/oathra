export type ElevenLabsTTSOptions = {
  apiKey?: string;
  /** A voice from the account's voice library (Get voices). There is no default: the voice is the deployment's choice. */
  voiceId?: string;
  /** `eleven_flash_v2_5` is the lowest-latency model that speaks Japanese. */
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
};

export const DEFAULT_ELEVENLABS_MODEL = "eleven_flash_v2_5";
// The docs say multilingual_v2 does not take `language_code`; every other model may.
const NO_LANGUAGE_CODE = new Set(["eleven_multilingual_v2"]);

/**
 * ElevenLabs text-to-speech, streamed. The phone line's own format is requested (`ulaw_8000`), so the bytes go to the
 * carrier as they arrive: μ-law is one byte per sample and needs no resampling or alignment across network chunks.
 */
export class ElevenLabsTTS {
  readonly name: string;
  readonly model: string;
  readonly voiceId: string | undefined;
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ElevenLabsTTSOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.ELEVENLABS_API_KEY;
    this.voiceId = opts.voiceId ?? process.env.ELEVENLABS_VOICE_ID;
    this.model = opts.model ?? process.env.ELEVENLABS_MODEL ?? DEFAULT_ELEVENLABS_MODEL;
    this.baseUrl = (opts.baseUrl ?? "https://api.elevenlabs.io/v1").replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.fetchImpl = opts.fetch ?? fetch;
    this.name = `elevenlabs-tts:${this.model}:${this.voiceId ?? "unset"}`;
  }

  /** Streaming 8 kHz μ-law for the phone line (the pipeline engine's `synthesizeMulaw8kStream`). Leaving the loop early aborts the request. */
  async *synthesizeMulaw8kStream(text: string, opts: { language?: string } = {}): AsyncIterable<Uint8Array> {
    if (!this.apiKey) throw new Error("ELEVENLABS_API_KEY is not set. Create one at https://elevenlabs.io/app/settings/api-keys");
    if (!this.voiceId) throw new Error("ELEVENLABS_VOICE_ID is not set. Pick a voice in https://elevenlabs.io/app/voice-library and copy its ID");
    const body: Record<string, unknown> = { text, model_id: this.model };
    if (opts.language && !NO_LANGUAGE_CODE.has(this.model)) body.language_code = opts.language;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(new Error("ElevenLabs TTS timed out")), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/text-to-speech/${encodeURIComponent(this.voiceId)}/stream?output_format=ulaw_8000`, {
        method: "POST",
        headers: { "content-type": "application/json", "xi-api-key": this.apiKey },
        body: JSON.stringify(body),
        signal: abort.signal,
      });
      if (!res.ok) throw new Error(`ElevenLabs TTS ${res.status}: ${(await res.text()).slice(0, 300)}`);
      if (!res.body) return;
      for await (const piece of res.body as unknown as AsyncIterable<Uint8Array>) if (piece.length) yield piece;
    } finally {
      clearTimeout(timer);
      abort.abort();
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
