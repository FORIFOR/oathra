import type { AudioFrame, TTSProvider } from "@oathra/core";
import type { Language } from "@oathra/evidence";
import { bytesToInt16, pcm24kToMulaw8k } from "@oathra/audio-kit";

export type OpenAITTSOptions = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  voice?: string;
  /** Style hint passed as `instructions` (gpt-4o-mini-tts). */
  instructions?: string;
  timeoutMs?: number;
};

const PCM_RATE = 24000;

/** OpenAI text-to-speech (`/v1/audio/speech`, raw 24 kHz PCM). */
export class OpenAITTS implements TTSProvider {
  readonly name: string;
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly voice: string;
  private readonly instructions: string | undefined;
  private readonly timeoutMs: number;

  constructor(opts: OpenAITTSOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
    this.baseUrl = (opts.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.model = opts.model ?? "gpt-4o-mini-tts";
    this.voice = opts.voice ?? "alloy";
    this.instructions = opts.instructions;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.name = `openai-tts:${this.model}`;
  }

  /** Raw 24 kHz s16le mono PCM for the text. */
  async synthesizePcm24k(text: string, opts: { language?: Language; voice?: string } = {}): Promise<Int16Array> {
    if (!this.apiKey) throw new Error("OPENAI_API_KEY is not set. Get one at https://platform.openai.com/api-keys");
    const body: Record<string, unknown> = {
      model: this.model,
      voice: opts.voice ?? this.voice,
      input: text,
      response_format: "pcm",
    };
    const instructions = this.instructions ?? (opts.language === "ja" ? "自然で丁寧な日本語の電話応対。落ち着いた速さで話す。" : undefined);
    if (instructions && this.model.includes("tts") && !this.model.startsWith("tts-1")) body.instructions = instructions;
    const res = await fetch(`${this.baseUrl}/audio/speech`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`OpenAI TTS ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return bytesToInt16(new Uint8Array(await res.arrayBuffer()));
  }

  /** 8 kHz μ-law, ready for PSTN media streams. */
  async synthesizeMulaw8k(text: string, opts: { language?: Language; voice?: string } = {}): Promise<Uint8Array> {
    return pcm24kToMulaw8k(await this.synthesizePcm24k(text, opts));
  }

  /**
   * Streaming 8 kHz μ-law: yields chunks as the HTTP body arrives, sentence by
   * sentence, so playback starts after the first few hundred ms of audio
   * instead of after the whole utterance is synthesised. The next sentence is
   * requested while the current one is still being yielded.
   */
  async *synthesizeMulaw8kStream(text: string, opts: { language?: Language; voice?: string } = {}): AsyncIterable<Uint8Array> {
    const sentences = splitSentences(text);
    let next: Promise<Response> | undefined = this.request(sentences[0] ?? text, opts);
    for (let i = 0; i < sentences.length; i++) {
      const res = await next!;
      next = i + 1 < sentences.length ? this.request(sentences[i + 1]!, opts) : undefined;
      if (!res.ok) throw new Error(`OpenAI TTS ${res.status}: ${(await res.text()).slice(0, 300)}`);
      if (!res.body) continue;
      const reader = res.body.getReader();
      let carry = new Uint8Array(0);
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const buf = new Uint8Array(carry.length + value.length);
        buf.set(carry, 0);
        buf.set(value, carry.length);
        // Keep whole 24k→8k groups (3 samples = 6 bytes) so resampling stays aligned.
        const usable = buf.length - (buf.length % 6);
        carry = buf.subarray(usable);
        if (usable > 0) yield pcm24kToMulaw8k(bytesToInt16(buf.subarray(0, usable)));
      }
      if (carry.length >= 2) yield pcm24kToMulaw8k(bytesToInt16(carry.subarray(0, carry.length - (carry.length % 2))));
    }
  }

  private request(text: string, opts: { language?: Language; voice?: string }): Promise<Response> {
    if (!this.apiKey) throw new Error("OPENAI_API_KEY is not set. Get one at https://platform.openai.com/api-keys");
    const body: Record<string, unknown> = { model: this.model, voice: opts.voice ?? this.voice, input: text, response_format: "pcm" };
    const instructions = this.instructions ?? (opts.language === "ja" ? "自然で丁寧な日本語の電話応対。落ち着いた速さで話す。" : undefined);
    if (instructions && this.model.includes("tts") && !this.model.startsWith("tts-1")) body.instructions = instructions;
    return fetch(`${this.baseUrl}/audio/speech`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  /** Establish the TLS connection ahead of the first real request. */
  async warmup(): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/models`, { headers: { authorization: `Bearer ${this.apiKey}` }, signal: AbortSignal.timeout(5000) });
    } catch {
      /* best effort */
    }
  }

  async *synthesize(text: string, opts: { language: Language; voice?: string }): AsyncIterable<AudioFrame> {
    const pcm = await this.synthesizePcm24k(text, opts);
    // Yield in 100 ms frames so consumers can start playback before the end.
    const step = PCM_RATE / 10;
    for (let i = 0; i < pcm.length; i += step) {
      yield { sampleRate: PCM_RATE, samples: pcm.subarray(i, Math.min(pcm.length, i + step)), channels: 1, t: Math.round((i / PCM_RATE) * 1000) };
    }
  }
}

/** Split on Japanese / Latin sentence enders, keeping the enders. */
export function splitSentences(text: string): string[] {
  const parts = text.match(/[^。！？!?\n]+[。！？!?]?/g)?.map((x) => x.trim()).filter(Boolean) ?? [];
  return parts.length ? parts : [text];
}
