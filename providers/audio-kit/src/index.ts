/**
 * @oathra/audio-kit — small, dependency-free audio helpers for telephony.
 * PSTN transports speak 8 kHz G.711 μ-law in 20 ms frames (160 bytes).
 */
import type { AudioFrame } from "@oathra/core";

export const MULAW_SAMPLE_RATE = 8000;
/** 20 ms of 8 kHz μ-law. */
export const MULAW_FRAME_BYTES = 160;
export const FRAME_MS = 20;

const BIAS = 0x84;
const CLIP = 32635;

/** Encode one 16-bit PCM sample to G.711 μ-law. */
export function mulawEncodeSample(sample: number): number {
  let s = Math.max(-32768, Math.min(32767, Math.round(sample)));
  const sign = s < 0 ? 0x80 : 0;
  if (s < 0) s = -s;
  if (s > CLIP) s = CLIP;
  s += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; exponent--, mask >>= 1) {
    /* find segment */
  }
  const mantissa = (s >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

/** Decode one G.711 μ-law byte to a 16-bit PCM sample. */
export function mulawDecodeSample(byte: number): number {
  const u = ~byte & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  let s = ((mantissa << 3) + BIAS) << exponent;
  s -= BIAS;
  return sign ? -s : s;
}

export function mulawEncode(pcm: Int16Array): Uint8Array {
  const out = new Uint8Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = mulawEncodeSample(pcm[i]!);
  return out;
}

export function mulawDecode(bytes: Uint8Array): Int16Array {
  const out = new Int16Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = mulawDecodeSample(bytes[i]!);
  return out;
}

/**
 * Resample 16-bit mono PCM. Downsampling averages the covered source
 * samples (a cheap low-pass); upsampling interpolates linearly.
 */
export function resample(pcm: Int16Array, fromRate: number, toRate: number): Int16Array {
  if (fromRate === toRate) return pcm;
  const ratio = fromRate / toRate;
  const outLen = Math.max(0, Math.floor(pcm.length / ratio));
  const out = new Int16Array(outLen);
  if (ratio > 1) {
    for (let i = 0; i < outLen; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.min(pcm.length, Math.floor((i + 1) * ratio));
      let sum = 0;
      let n = 0;
      for (let j = start; j < end; j++) {
        sum += pcm[j]!;
        n++;
      }
      out[i] = n ? Math.round(sum / n) : 0;
    }
  } else {
    for (let i = 0; i < outLen; i++) {
      const pos = i * ratio;
      const i0 = Math.floor(pos);
      const i1 = Math.min(pcm.length - 1, i0 + 1);
      const frac = pos - i0;
      out[i] = Math.round(pcm[i0]! * (1 - frac) + pcm[i1]! * frac);
    }
  }
  return out;
}

/** Interpret raw little-endian s16 bytes as Int16Array (copies to align). */
export function bytesToInt16(bytes: Uint8Array): Int16Array {
  const even = bytes.length - (bytes.length % 2);
  const out = new Int16Array(even / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, even);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true);
  return out;
}

export function int16ToBytes(pcm: Int16Array): Uint8Array {
  const out = new Uint8Array(pcm.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < pcm.length; i++) view.setInt16(i * 2, pcm[i]!, true);
  return out;
}

export function concatInt16(parts: Int16Array[]): Int16Array {
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Int16Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Split μ-law bytes into 20 ms frames (last frame padded with silence 0xff). */
export function frameMulaw(bytes: Uint8Array, frameBytes = MULAW_FRAME_BYTES): Uint8Array[] {
  const frames: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += frameBytes) {
    const chunk = bytes.subarray(i, Math.min(bytes.length, i + frameBytes));
    if (chunk.length === frameBytes) frames.push(chunk);
    else {
      const padded = new Uint8Array(frameBytes).fill(0xff);
      padded.set(chunk);
      frames.push(padded);
    }
  }
  return frames;
}

/** Duration of a μ-law byte buffer in ms. */
export function mulawDurationMs(bytes: Uint8Array): number {
  return (bytes.length / MULAW_SAMPLE_RATE) * 1000;
}

/** Build a PCM16 mono WAV file. */
export function wavFromInt16(pcm: Int16Array, sampleRate: number): Uint8Array {
  const dataBytes = pcm.length * 2;
  const buf = new Uint8Array(44 + dataBytes);
  const v = new DataView(buf.buffer);
  const ascii = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) buf[off + i] = s.charCodeAt(i);
  };
  ascii(0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  ascii(36, "data");
  v.setUint32(40, dataBytes, true);
  buf.set(int16ToBytes(pcm), 44);
  return buf;
}

export function frameFromInt16(samples: Int16Array, sampleRate: number, t: number): AudioFrame {
  return { sampleRate, samples, channels: 1, t };
}

/** 24 kHz PCM (OpenAI TTS "pcm") -> 8 kHz μ-law for telephony. */
export function pcm24kToMulaw8k(pcm24k: Int16Array): Uint8Array {
  return mulawEncode(resample(pcm24k, 24000, MULAW_SAMPLE_RATE));
}

/** Silence of `ms` milliseconds as μ-law. */
export function mulawSilence(ms: number): Uint8Array {
  return new Uint8Array(Math.round((ms / 1000) * MULAW_SAMPLE_RATE)).fill(0xff);
}
