/**
 * Latency budget per agent turn. All timestamps are call-relative ms.
 *
 * speech_end -> turn_confirm -> brain_first_token -> tts_first_audio -> playback
 */
export type TurnTrace = {
  turnId: string;
  speechEndMs: number;
  turnConfirmMs?: number;
  brainStartMs?: number;
  brainFirstTokenMs?: number;
  brainEndMs?: number;
  ttsFirstAudioMs?: number;
  playbackStartMs?: number;
  /** Time to first audio: playbackStart - speechEnd. */
  ttfaMs?: number;
};

export type LatencyTargets = {
  ttfaP50Ms: number;
  ttfaP95Ms: number;
  turnConfirmMaxMs: number;
  brainFirstTokenMaxMs: number;
  ttsFirstAudioMaxMs: number;
};

export const DEFAULT_LATENCY_TARGETS: LatencyTargets = {
  ttfaP50Ms: 650,
  ttfaP95Ms: 1000,
  turnConfirmMaxMs: 400,
  brainFirstTokenMaxMs: 200,
  ttsFirstAudioMaxMs: 120,
};

export function percentile(values: number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export type LatencySummary = {
  turns: number;
  ttfaP50Ms?: number;
  ttfaP95Ms?: number;
  ttfaMaxMs?: number;
  meetsP50: boolean;
  meetsP95: boolean;
};

export function summarizeLatency(traces: TurnTrace[], targets: LatencyTargets = DEFAULT_LATENCY_TARGETS): LatencySummary {
  const ttfa = traces.map((t) => t.ttfaMs).filter((v): v is number => typeof v === "number");
  const p50 = percentile(ttfa, 50);
  const p95 = percentile(ttfa, 95);
  const s: LatencySummary = {
    turns: ttfa.length,
    meetsP50: p50 !== undefined && p50 <= targets.ttfaP50Ms,
    meetsP95: p95 !== undefined && p95 <= targets.ttfaP95Ms,
  };
  if (p50 !== undefined) s.ttfaP50Ms = p50;
  if (p95 !== undefined) s.ttfaP95Ms = p95;
  if (ttfa.length) s.ttfaMaxMs = Math.max(...ttfa);
  return s;
}
