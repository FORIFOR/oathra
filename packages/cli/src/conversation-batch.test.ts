import { describe, expect, it } from "vitest";
import { contractFromScenario, loadScenarioDir } from "@oathra/scenario";
import { LineConditioner, noiseFromWav, parseCondition, pinkNoise, voicedRms } from "./audio-degrade.js";
import { expectedComplete, percentile, planRuns, summarizeRuns, type BatchRun } from "./conversation-batch.js";
import { wavBytes } from "./local-conversation.js";
import { scenariosDir } from "./paths.js";
import { MULAW_8K, convert, toPcm16 } from "@oathra/voice";

const rng = (seed: number) => () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
const speech = (ms: number, amp = 6000) => {
  const pcm = new Int16Array(ms * 8);
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.round(amp * Math.sin((2 * Math.PI * 300 * i) / 8000));
  return convert({ format: "pcm_s16le", sampleRate: 8000, channels: 1, data: new Uint8Array(pcm.buffer) }, MULAW_8K).data;
};
const rmsOf = (mu: Uint8Array) => { const pcm = toPcm16({ ...MULAW_8K, data: mu }); let s = 0; for (const x of pcm) s += x * x; return Math.sqrt(s / pcm.length); };

describe("line conditions", () => {
  it("parses conditions joined with +, and refuses unknown ones", () => {
    expect(parseCondition("clean")).toEqual({ id: "clean", gainDb: 0, snrDb: null, fast: false });
    expect(parseCondition("fast+noise-10db+quiet")).toEqual({ id: "fast+noise-10db+quiet", gainDb: -18, snrDb: 10, fast: true });
    expect(() => parseCondition("loud")).toThrow(/Unknown condition/);
  });

  it("clean passes speech through untouched and keeps silence silent", () => {
    const line = new LineConditioner(parseCondition("clean"), null), mu = speech(200);
    expect(line.speech(mu)).toBe(mu);
    expect([...line.silence(160)].every((b) => b === 0xff)).toBe(true);
  });

  it("quiet lowers the voice by 18 dB", () => {
    const mu = speech(400), out = new LineConditioner(parseCondition("quiet"), null).speech(mu);
    expect(20 * Math.log10(rmsOf(out) / rmsOf(mu))).toBeCloseTo(-18, 0);
  });

  it("noise is held at the requested SNR below the first spoken line, fills silence, and repeats for a seed", () => {
    const make = () => new LineConditioner(parseCondition("noise-10db"), pinkNoise(8000 * 2, rng(3)));
    const line = make(), mu = speech(500);
    line.speech(mu);
    const bed = line.silence(8000);
    const snr = 20 * Math.log10(voicedRms(toPcm16({ ...MULAW_8K, data: mu })) / rmsOf(bed));
    expect(snr).toBeGreaterThan(8.5);
    expect(snr).toBeLessThan(11.5);
    const again = make();
    again.speech(mu);
    expect(again.silence(8000)).toEqual(bed);
    expect(() => new LineConditioner(parseCondition("noise-10db"), null)).toThrow(/noise bed/);
  });

  it("reads a WAV noise bed at any rate into 8 kHz at RMS 1", () => {
    const pcm = new Int16Array(16000);
    for (let i = 0; i < pcm.length; i++) pcm[i] = Math.round(2000 * Math.sin((2 * Math.PI * 500 * i) / 16000));
    const bed = noiseFromWav(wavBytes(pcm, 16000));
    expect(bed.length).toBe(8000);
    expect(Math.sqrt(bed.reduce((s, x) => s + x * x, 0) / bed.length)).toBeCloseTo(1, 1);
    expect(() => noiseFromWav(new Uint8Array(40))).toThrow(/WAV/);
  });
});

describe("conversation batch", () => {
  it("plans repeats outermost with one seed per run, and refuses unknown mutations", () => {
    const plan = planRuns({ mutations: ["none", "tentative-hold"], conditions: ["clean", "quiet"], runs: 2, seed: 10 });
    expect(plan).toHaveLength(8);
    expect(plan.slice(0, 4).map((p) => `${p.mutation}/${p.condition}`)).toEqual(["none/clean", "none/quiet", "tentative-hold/clean", "tentative-hold/quiet"]);
    expect(plan.map((p) => p.seed)).toEqual([10, 11, 12, 13, 14, 15, 16, 17]);
    expect(() => planRuns({ mutations: ["polite"], conditions: ["clean"], runs: 1, seed: 1 })).toThrow(/Unknown mutation/);
    expect(() => planRuns({ mutations: ["none"], conditions: ["clean"], runs: 0, seed: 1 })).toThrow(/--runs/);
  });

  it("expects completion only when the callee committed inside the contract's constraints", () => {
    const contract = contractFromScenario(loadScenarioDir(scenariosDir()).find((s) => s.id === "restaurant-reservation")!);
    expect(expectedComplete(contract, { confirmed: true, date: "2026-09-12", time: "19:30", partySize: 2 })).toBe(true);
    expect(expectedComplete(contract, { confirmed: true, date: "2026-09-12", time: "18:30", partySize: 2 })).toBe(false);
    expect(expectedComplete(contract, { confirmed: false })).toBe(false);
    expect(expectedComplete(contract, null)).toBe(false);
  });

  it("summarizes false completions, expectations, errors and reply latency", () => {
    const base: BatchRun = { mutation: "none", condition: "clean", seed: 1, index: 1, dir: "", status: "completed", complete: true, expectedComplete: true, asExpected: true, falseCompletion: false, disagreements: [], error: null, endReason: "agent_hangup", stoppedForBudget: false, replyAudioAfterMs: [800, 1200], estimatedUsd: 0.1 };
    const s = summarizeRuns([
      base,
      { ...base, index: 2, mutation: "tentative-hold", complete: true, expectedComplete: false, asExpected: false, falseCompletion: true, replyAudioAfterMs: [1000] },
      { ...base, index: 3, condition: "quiet", complete: false, asExpected: false, error: "boom", endReason: null, replyAudioAfterMs: [3000] },
    ]);
    expect(s).toMatchObject({ runs: 3, completed: 2, asExpected: 1, falseCompletions: 1, runtimeErrors: 1, estimatedUsd: 0.3, asExpectedRate: 0.333 });
    expect(s.replyAudioAfterMs).toEqual({ n: 4, p50: 1000, p95: 3000 });
    expect(s.byMutation["tentative-hold"]).toEqual({ runs: 1, completed: 1, asExpected: 0, falseCompletions: 1 });
    expect(s.byCondition.quiet).toEqual({ runs: 1, completed: 0, asExpected: 0, falseCompletions: 0 });
    expect(percentile([], 50)).toBeNull();
  });
});
