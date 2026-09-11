import { describe, expect, it } from "vitest";
import { chunkDurationMs, convert, MULAW_8K, PCM_24K, PCM_48K, toPcm16, type AudioChunk } from "./index.js";

function sine(rate: number, ms: number, hz = 440): AudioChunk {
  const n = Math.round((rate * ms) / 1000);
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) pcm[i] = Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 12000);
  return { format: "pcm_s16le", sampleRate: rate, channels: 1, data: new Uint8Array(pcm.buffer) };
}

describe("audio adapter", () => {
  it("converts 48k PCM to 8k μ-law and back with the right durations", () => {
    const src = sine(48000, 100);
    const mu = convert(src, MULAW_8K);
    expect(mu.format).toBe("mulaw");
    expect(Math.round(chunkDurationMs(mu))).toBe(100);
    const back = convert(mu, PCM_48K);
    expect(Math.round(chunkDurationMs(back))).toBe(100);
    const pcm = toPcm16(back);
    const peak = Math.max(...Array.from(pcm.subarray(0, 480)).map(Math.abs));
    expect(peak).toBeGreaterThan(8000);
  });
  it("converts μ-law 8k to 24k PCM for engines that want it", () => {
    const mu = convert(sine(8000, 40), MULAW_8K);
    const out = convert(mu, PCM_24K);
    expect(out.sampleRate).toBe(24000);
    expect(Math.round(chunkDurationMs(out))).toBe(40);
  });
  it("downmixes stereo", () => {
    const pcm = new Int16Array([1000, 3000, -2000, -4000]);
    const c: AudioChunk = { format: "pcm_s16le", sampleRate: 8000, channels: 2, data: new Uint8Array(pcm.buffer) };
    expect(Array.from(toPcm16(c))).toEqual([2000, -3000]);
  });
  it("round-trips a-law within tolerance", () => {
    const src = sine(8000, 20);
    const a = convert(src, { format: "alaw", sampleRate: 8000, channels: 1 });
    const back = toPcm16(a);
    const orig = toPcm16(src);
    let err = 0;
    for (let i = 0; i < orig.length; i++) err += Math.abs(orig[i]! - back[i]!);
    expect(err / orig.length).toBeLessThan(400);
  });
});
