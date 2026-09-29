import { describe, expect, it } from "vitest";
import {
  bytesToInt16,
  frameMulaw,
  int16ToBytes,
  mulawDecode,
  mulawDecodeSample,
  mulawEncode,
  mulawEncodeSample,
  mulawDurationMs,
  resample,
  wavFromInt16,
  StreamResampler,
  concatInt16,
  pcm24kToMulaw8k,
} from "./index.js";

describe("mu-law", () => {
  it("round-trips within G.711 quantisation error", () => {
    for (const s of [0, 1, -1, 100, -100, 1000, -1000, 8000, -8000, 30000, -30000, 32767, -32768]) {
      const back = mulawDecodeSample(mulawEncodeSample(s));
      const tol = Math.max(8, Math.abs(s) * 0.07);
      expect(Math.abs(back - s), `sample ${s} -> ${back}`).toBeLessThanOrEqual(tol);
    }
  });
  it("encodes silence as 0xff and keeps buffer lengths", () => {
    expect(mulawEncodeSample(0)).toBe(0xff);
    const pcm = new Int16Array([0, 500, -500, 12000]);
    const enc = mulawEncode(pcm);
    expect(enc.length).toBe(4);
    expect(mulawDecode(enc).length).toBe(4);
  });
});

describe("resample", () => {
  it("produces the expected lengths", () => {
    expect(resample(new Int16Array(2400), 24000, 8000).length).toBe(800);
    expect(resample(new Int16Array(800), 8000, 16000).length).toBe(1600);
    expect(resample(new Int16Array(10), 8000, 8000).length).toBe(10);
  });
  it("preserves a DC level", () => {
    const dc = new Int16Array(2400).fill(1234);
    const down = resample(dc, 24000, 8000);
    expect(down.every((v) => v === 1234)).toBe(true);
  });
});

describe("framing and wav", () => {
  it("frames into 160-byte chunks, padding the tail with silence", () => {
    const frames = frameMulaw(new Uint8Array(400));
    expect(frames).toHaveLength(3);
    expect(frames[2]![159]).toBe(0xff);
    expect(mulawDurationMs(new Uint8Array(8000))).toBe(1000);
  });
  it("writes a valid 44-byte WAV header", () => {
    const wav = wavFromInt16(new Int16Array([1, -1, 2]), 8000);
    expect(wav.length).toBe(44 + 6);
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wav.subarray(8, 12))).toBe("WAVE");
    const v = new DataView(wav.buffer);
    expect(v.getUint32(24, true)).toBe(8000);
    expect(v.getUint32(40, true)).toBe(6);
  });
  it("round-trips int16 <-> bytes", () => {
    const pcm = new Int16Array([-32768, 32767, 0, 42]);
    expect(Array.from(bytesToInt16(int16ToBytes(pcm)))).toEqual(Array.from(pcm));
  });
});

// Measured properties of the phone-line conversion, against the chunk-wise average it replaces.
describe("StreamResampler", () => {
  const tone = (hz: number, rate: number, samples: number, amplitude = 10000): Int16Array => {
    const pcm = new Int16Array(samples);
    for (let i = 0; i < samples; i++) pcm[i] = Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * amplitude);
    return pcm;
  };
  const rms = (pcm: Int16Array, skip = 200): number => {
    let sum = 0;
    for (let i = skip; i < pcm.length - skip; i++) sum += pcm[i]! ** 2;
    return Math.sqrt(sum / (pcm.length - 2 * skip));
  };
  const db = (value: number, reference: number): number => 20 * Math.log10(value / reference);
  const chunked = (r: StreamResampler, pcm: Int16Array, size: number): Int16Array => {
    const parts: Int16Array[] = [];
    for (let i = 0; i < pcm.length; i += size) parts.push(r.process(pcm.subarray(i, i + size)));
    return concatInt16(parts);
  };
  const reference = 10000 / Math.SQRT2;

  it("24 kHz -> 8 kHz: keeps the voice band and removes what would alias into it", () => {
    for (const hz of [300, 1000, 2500, 3000]) {
      expect(Math.abs(db(rms(new StreamResampler(24000, 8000).process(tone(hz, 24000, 24000))), reference))).toBeLessThan(0.6);
    }
    for (const hz of [5000, 6000, 7000]) {
      // 6 kHz would fold to 2 kHz on the line. The three-sample average leaves it only ~6-10 dB down.
      expect(db(rms(resample(tone(hz, 24000, 24000), 24000, 8000)), reference)).toBeGreaterThan(-16);
      expect(db(rms(new StreamResampler(24000, 8000).process(tone(hz, 24000, 24000))), reference)).toBeLessThan(-50);
    }
  });

  it("is sample-identical whether audio arrives whole or in uneven chunks", () => {
    const down = tone(700, 24000, 9600);
    expect(Array.from(chunked(new StreamResampler(24000, 8000), down, 479))).toEqual(Array.from(new StreamResampler(24000, 8000).process(down)));
    const up = tone(700, 8000, 3200);
    expect(Array.from(chunked(new StreamResampler(8000, 24000), up, 160))).toEqual(Array.from(new StreamResampler(8000, 24000).process(up)));
  });

  it("8 kHz -> 24 kHz: exact length, unity gain, and no step at 20 ms frame edges", () => {
    const pcm = tone(1000, 8000, 8000);
    const smooth = chunked(new StreamResampler(8000, 24000), pcm, 160);
    expect(smooth.length).toBe(24000);
    expect(Math.abs(db(rms(smooth), reference))).toBeLessThan(0.6);
    // Energy above the telephone band is what the frame-edge steps and linear interpolation add.
    const residue = (signal: Int16Array): number => rms(new StreamResampler(24000, 8000).process(signal).map((v, i) => v - (pcm[i - 8] ?? 0)), 400);
    const stepped = concatInt16(Array.from({ length: 50 }, (_, f) => resample(pcm.subarray(f * 160, (f + 1) * 160), 8000, 24000)));
    expect(residue(smooth)).toBeLessThan(residue(stepped));
  });

  it("whole-utterance conversion keeps the expected μ-law length", () => {
    expect(pcm24kToMulaw8k(tone(440, 24000, 4800)).length).toBe(1600);
    expect(pcm24kToMulaw8k(new Int16Array(0)).length).toBe(0);
    expect(() => new StreamResampler(44100, 8000)).toThrow(/integer rate ratio/);
  });
});
