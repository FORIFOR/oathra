/**
 * @oathra/voice — the Voice Layer.
 *
 * A VoiceEngine turns far-end audio into agent audio (speech-to-speech) or
 * into transcripts + synthesized replies (pipeline). It never knows which
 * carrier the audio came from: every carrier hands it AudioChunks in its own
 * format and takes AudioChunks back; the adapters here convert.
 *
 *   Twilio (μ-law 8k) ─┐                       ┌─ GPT-Live
 *   LiveKit (PCM 48k) ─┼─ AudioAdapter ─ Engine ┼─ OpenAI Realtime
 *   Simulator         ─┘                       ├─ Pipeline (STT+LLM+TTS)
 *                                              └─ Local
 */
import type { Action, CallContract } from "@oathra/contract";
import type { Language } from "@oathra/evidence";
import type { MissionView, SessionEvent } from "@oathra/core";
import { mulawDecode, mulawEncode, resample } from "@oathra/audio-kit";

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

export type AudioFormat = "pcm_s16le" | "mulaw" | "alaw";

export type AudioSpec = { format: AudioFormat; sampleRate: number; channels: number };

/** A chunk of audio in a declared format. `data` is raw bytes. */
export type AudioChunk = AudioSpec & { data: Uint8Array };

export const MULAW_8K: AudioSpec = { format: "mulaw", sampleRate: 8000, channels: 1 };
export const PCM_16K: AudioSpec = { format: "pcm_s16le", sampleRate: 16000, channels: 1 };
export const PCM_24K: AudioSpec = { format: "pcm_s16le", sampleRate: 24000, channels: 1 };
export const PCM_48K: AudioSpec = { format: "pcm_s16le", sampleRate: 48000, channels: 1 };

export function chunkDurationMs(c: AudioChunk): number {
  const bytesPerSample = c.format === "pcm_s16le" ? 2 : 1;
  return (c.data.length / bytesPerSample / c.channels / c.sampleRate) * 1000;
}

// G.711 A-law (same tables as the widely used alawmulaw implementation).
const ALAW_LOG = (() => {
  const t: number[] = [1, 1, 2, 2, 3, 3, 3, 3];
  for (let i = 0; i < 8; i++) t.push(4);
  for (let i = 0; i < 16; i++) t.push(5);
  for (let i = 0; i < 32; i++) t.push(6);
  for (let i = 0; i < 64; i++) t.push(7);
  return t;
})();

function alawEncodeSample(sample: number): number {
  let s = sample === -32768 ? -32767 : sample;
  const sign = (~s >> 8) & 0x80;
  if (!sign) s = -s;
  if (s > 32635) s = 32635;
  let v: number;
  if (s >= 256) {
    const exponent = ALAW_LOG[(s >> 8) & 0x7f]!;
    const mantissa = (s >> (exponent + 3)) & 0x0f;
    v = (exponent << 4) | mantissa;
  } else v = s >> 4;
  return (v ^ (sign ^ 0x55)) & 0xff;
}

function alawDecodeSample(byte: number): number {
  let a = byte ^ 0x55;
  let sign = 0;
  if (a & 0x80) {
    a &= ~(1 << 7);
    sign = -1;
  }
  const position = ((a & 0xf0) >> 4) + 4;
  const decoded = position !== 4 ? (1 << position) | ((a & 0x0f) << (position - 4)) | (1 << (position - 5)) : (a << 1) | 1;
  return (sign === 0 ? -decoded : decoded) << 3;
}

function alawDecode(bytes: Uint8Array): Int16Array {
  const out = new Int16Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = alawDecodeSample(bytes[i]!);
  return out;
}

function alawEncode(pcm: Int16Array): Uint8Array {
  const out = new Uint8Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = alawEncodeSample(pcm[i]!);
  return out;
}

function toMono(pcm: Int16Array, channels: number): Int16Array {
  if (channels === 1) return pcm;
  const out = new Int16Array(Math.floor(pcm.length / channels));
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += pcm[i * channels + c]!;
    out[i] = Math.round(sum / channels);
  }
  return out;
}

/** Decode any chunk to mono 16-bit PCM at its own sample rate. */
export function toPcm16(c: AudioChunk): Int16Array {
  if (c.format === "mulaw") return mulawDecode(c.data);
  if (c.format === "alaw") return alawDecode(c.data);
  const pcm = new Int16Array(c.data.buffer, c.data.byteOffset, Math.floor(c.data.byteLength / 2));
  return toMono(pcm, c.channels);
}

/** Convert a chunk to the target spec (mono only on output). */
export function convert(c: AudioChunk, target: AudioSpec): AudioChunk {
  if (c.format === target.format && c.sampleRate === target.sampleRate && c.channels === target.channels) return c;
  let pcm = toPcm16(c);
  if (c.sampleRate !== target.sampleRate) pcm = resample(pcm, c.sampleRate, target.sampleRate);
  let data: Uint8Array;
  if (target.format === "mulaw") data = mulawEncode(pcm);
  else if (target.format === "alaw") data = alawEncode(pcm);
  else data = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength).slice();
  return { ...target, channels: 1, data };
}

// ---------------------------------------------------------------------------
// Voice engine protocol
// ---------------------------------------------------------------------------

export type VoiceSessionContext = {
  contract: CallContract;
  language: Language;
  calleeName?: string;
  /** The format the carrier will feed in and wants back. */
  carrierAudio: AudioSpec;
};

/** What a running voice session sends back to the carrier bridge. */
export type VoiceOutput =
  | { type: "audio"; chunk: AudioChunk }
  /** Drop queued far-end playback (barge-in). */
  | { type: "clear" }
  | { type: "event"; event: SessionEvent };

export interface VoiceSession {
  /** Far-end audio, in the carrier's format (the engine converts as needed). */
  input(chunk: AudioChunk): void;
  /** Agent audio and control, in the engine's native format. */
  readonly output: AsyncIterable<VoiceOutput>;
  /** Pipeline engines: synthesize and play a reply produced by the runtime's brain. */
  speak?(text: string): Promise<{ startMs: number; endMs: number; interrupted: boolean }>;
  /** Pipeline engines: play a pre-synthesized acknowledgement. */
  ack?(): void;
  /** Speech-to-speech engines: ground the model in the evidence state. */
  updateContext?(view: MissionView): void;
  resolveAction?(action: Action, approved: boolean): void;
  /** Stop the agent's current playback. */
  interrupt(): void;
  close(): Promise<void>;
  /** Milliseconds since the session started (the bridge sets the clock). */
  now(): number;
}

export interface VoiceEngine {
  readonly id: string;
  /** Human-readable, e.g. "GPT-Live (gpt-live-1)". */
  readonly label: string;
  /** The engine talks on its own (no BrainProvider turn). */
  readonly speaksItself: boolean;
  /** Preferred audio spec at the engine boundary. */
  readonly nativeAudio: AudioSpec;
  /** Environment variables the engine needs; used by doctor/setup. */
  readonly requires: string[];
  start(ctx: VoiceSessionContext, clock: { now(): number }): Promise<VoiceSession>;
}

/** Async queue used by engines and carriers to publish output. */
export class OutputQueue<T> implements AsyncIterable<T> {
  private readonly items: T[] = [];
  private readonly waiters: Array<(r: IteratorResult<T>) => void> = [];
  private closed = false;

  push(item: T): void {
    if (this.closed) return;
    const w = this.waiters.shift();
    if (w) w({ value: item, done: false });
    else this.items.push(item);
  }

  close(): void {
    this.closed = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined as never, done: true });
  }

  get isClosed(): boolean {
    return this.closed;
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item !== undefined) return Promise.resolve({ value: item, done: false });
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true });
        return new Promise((res) => this.waiters.push(res));
      },
    };
  }
}
