/**
 * Callee-side line conditions for the local conversation test: a quieter voice, steady background noise at a
 * given signal-to-noise ratio, a faster speaker. Speech goes in and out as μ-law 8 kHz, the carrier's format, and
 * the same seed always gives the same noise. Synthetic speech is not a person: these conditions compare engines and
 * builds against each other, they never stand in for a real line.
 */
import { MULAW_8K, convert, toPcm16, type AudioSpec } from "@oathra/voice";

export type LineCondition = { id: string; gainDb: number; snrDb: number | null; fast: boolean };

/** The callee's TTS speaking rate under `fast` (1 = normal). */
export const FAST_SPEECH_RATE = 1.5;

/** `clean`, `quiet`, `fast`, `noise-<snr>db`, joined with `+` (`fast+noise-10db`). */
export function parseCondition(id: string): LineCondition {
  const condition: LineCondition = { id, gainDb: 0, snrDb: null, fast: false };
  for (const part of id.split("+")) {
    const noise = /^noise-(-?\d{1,2})db$/.exec(part);
    if (part === "clean") continue;
    else if (part === "quiet") condition.gainDb = -18;
    else if (part === "fast") condition.fast = true;
    else if (noise) condition.snrDb = Number(noise[1]);
    else throw new Error(`Unknown condition "${part}". Use clean, quiet, fast or noise-<snr>db, joined with + (e.g. fast+noise-10db)`);
  }
  return condition;
}

const PCM_8K: AudioSpec = { format: "pcm_s16le", sampleRate: 8000, channels: 1 };
const clip = (x: number) => Math.max(-32768, Math.min(32767, Math.round(x)));
const toMulaw = (pcm: Int16Array) => convert({ ...PCM_8K, data: new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength) }, MULAW_8K).data;

/** RMS over the 20 ms frames that carry speech, so pauses do not dilute the level. */
export function voicedRms(pcm: Int16Array): number {
  let sum = 0, n = 0;
  for (let i = 0; i + 160 <= pcm.length; i += 160) {
    let frame = 0;
    for (let k = i; k < i + 160; k++) frame += pcm[k]! * pcm[k]!;
    if (Math.sqrt(frame / 160) > 300) { sum += frame; n += 160; }
  }
  return n ? Math.sqrt(sum / n) : 0;
}

/** Pink noise (Paul Kellet's economy filter) at RMS 1, seeded. */
export function pinkNoise(samples: number, rng: () => number): Float32Array {
  const out = new Float32Array(samples);
  let b0 = 0, b1 = 0, b2 = 0, sq = 0;
  for (let i = 0; i < samples; i++) {
    const w = rng() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
    out[i] = b0 + b1 + b2 + w * 0.1848;
    sq += out[i]! * out[i]!;
  }
  const rms = Math.sqrt(sq / samples) || 1;
  for (let i = 0; i < samples; i++) out[i] = out[i]! / rms;
  return out;
}

/** A recorded noise bed at RMS 1: 16-bit PCM WAV, any rate, mixed to mono and resampled to 8 kHz. */
export function noiseFromWav(bytes: Uint8Array): Float32Array {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(...bytes.subarray(o, o + 4));
  if (bytes.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("noise file is not a WAV file");
  let fmt: { channels: number; rate: number; bits: number; format: number } | undefined, data: Uint8Array | undefined;
  for (let o = 12; o + 8 <= bytes.length; ) {
    const size = v.getUint32(o + 4, true);
    if (tag(o) === "fmt ") fmt = { format: v.getUint16(o + 8, true), channels: v.getUint16(o + 10, true), rate: v.getUint32(o + 12, true), bits: v.getUint16(o + 22, true) };
    else if (tag(o) === "data") data = bytes.subarray(o + 8, Math.min(bytes.length, o + 8 + size));
    o += 8 + size + (size % 2);
  }
  if (!fmt || !data || fmt.format !== 1 || fmt.bits !== 16) throw new Error("noise file must be 16-bit PCM WAV");
  const pcm = toPcm16(convert({ format: "pcm_s16le", sampleRate: fmt.rate, channels: fmt.channels, data: data.slice() }, PCM_8K));
  let sq = 0;
  for (const x of pcm) sq += x * x;
  const rms = Math.sqrt(sq / (pcm.length || 1));
  if (!pcm.length || rms < 1) throw new Error("noise file is silent");
  return Float32Array.from(pcm, (x) => x / rms);
}

/**
 * Applies one condition to the callee's side of the line. The noise level is set from the callee's first spoken
 * line (its speech RMS divided by the SNR) and then held, the way a room's noise does not follow the voice; before
 * that line it assumes a typical TTS level. Silence frames carry the noise too.
 */
export class LineConditioner {
  private noiseAt = 0;
  private noiseLevel: number;
  private calibrated = false;
  private readonly gain: number;

  constructor(readonly condition: LineCondition, private readonly noise: Float32Array | null) {
    if (condition.snrDb !== null && (!noise || noise.length < 160)) throw new Error(`condition ${condition.id} needs a noise bed`);
    this.gain = 10 ** (condition.gainDb / 20);
    this.noiseLevel = this.levelFor(4000 * this.gain);
  }

  private levelFor(speechRms: number): number {
    return this.condition.snrDb === null ? 0 : speechRms / 10 ** (this.condition.snrDb / 20);
  }

  private mix(pcm: Int16Array, speech: boolean): Int16Array {
    const out = new Int16Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) {
      const n = this.noise && this.noiseLevel ? this.noise[this.noiseAt++ % this.noise.length]! * this.noiseLevel : 0;
      out[i] = clip((speech ? pcm[i]! * this.gain : 0) + n);
    }
    return out;
  }

  /** One spoken line, as the agent's side hears it. */
  speech(mu: Uint8Array): Uint8Array {
    const pcm = toPcm16({ ...MULAW_8K, data: mu });
    if (!this.calibrated) {
      const rms = voicedRms(pcm);
      if (rms > 0) { this.noiseLevel = this.levelFor(rms * this.gain); this.calibrated = true; }
    }
    if (this.gain === 1 && !this.noiseLevel) return mu;
    return toMulaw(this.mix(pcm, true));
  }

  /** `bytes` of line silence: μ-law silence, or the noise bed alone. */
  silence(bytes: number): Uint8Array {
    if (!this.noiseLevel) return new Uint8Array(bytes).fill(0xff);
    return toMulaw(this.mix(new Int16Array(bytes), false));
  }
}
