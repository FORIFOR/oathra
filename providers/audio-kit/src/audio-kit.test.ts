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
