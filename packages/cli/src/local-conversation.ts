/**
 * A whole phone-request call without a carrier: the same request → contract → CallRuntime → engine → brain
 * path as the Arena web phone, with the telephone line replaced by a local loop and the callee played from a
 * short script. Nothing rings; the voice APIs are real and paid. Normal lines wait for the agent's reply to
 * finish playing; one line interrupts on purpose to check barge-in.
 */
import type { PhoneRequest } from "@oathra/contract";
import type { BrainContext, BrainProvider, CallEvent } from "@oathra/core";
import { PhoneTransport, type CarrierEvent, type CarrierMediaSession, type CarrierTransport } from "@oathra/phone";
import { CallRuntime } from "@oathra/runtime";
import { MULAW_8K, OutputQueue, toPcm16, type VoiceEngine } from "@oathra/voice";

export type CalleeLine = { text: string; interrupt?: boolean };
export type CalleeVoice = { synthesizeMulaw8k(text: string, opts: { language: "ja" | "en" }): Promise<Uint8Array> };

/** A friend answering a character call. Line 4 cuts in while the agent is talking. */
export const DEFAULT_CALLEE_SCRIPT: CalleeLine[] = [
  { text: "もしもし？" },
  { text: "あ、田中さんの。うん、大丈夫だよ。" },
  { text: "実は最近ちょっと仕事で落ち込んでてさ。" },
  { text: "あ、ごめん、ちょっと待って。", interrupt: true },
  { text: "ありがとう。じゃあね、またね！" },
];

/** Upper-bound prices for the running estimate (USD). */
export const LOCAL_CONVERSATION_RATES = { sttPerMinute: 0.0077, ttsPerSecond: 0.000225, calleeTtsPerChar: 0.000015 };

export type ReplyTiming = {
  line: string;
  calleeEndMs: number;
  /** Speech recognition's final for this line, from the end of the callee's audio. */
  sttFinalAfterMs: number | null;
  /** The brain's reply text was ready. */
  replyTextAfterMs: number | null;
  brainLatencyMs: number | null;
  /** The first audible reply audio played on the line. */
  replyAudioAfterMs: number | null;
};

export type LocalConversationReport = {
  replies: ReplyTiming[];
  interruption: { calleeStartMs: number; agentWasSpeaking: boolean; stoppedAfterMs: number | null; staleAudioAfterStop: boolean } | null;
  transcript: Array<{ atMs: number; who: "callee" | "agent"; text: string; interrupted?: boolean }>;
  endReason: string | null;
  error: string | null;
  durationMs: number;
  agentAudio: Int16Array;
  mixedAudio: Int16Array;
  /** The instructions the brain actually received on its first turn. */
  firstSystemPrompt: string | null;
  usage: { brainCostUsd: number; brainInputTokens: number; brainOutputTokens: number; ttsAudioSeconds: number; sttAudioSeconds: number; calleeTtsChars: number; estimatedUsd: number };
  stoppedForBudget: boolean;
};

export type LocalConversationOptions = {
  request: PhoneRequest;
  contract: import("@oathra/contract").CallContract;
  engine: VoiceEngine;
  brain: BrainProvider;
  callee: CalleeVoice;
  script?: CalleeLine[];
  /** Builds the prompt the brain sees, recorded once (the brain itself still builds its own). */
  systemPrompt?: (ctx: BrainContext) => string;
  maxUsd?: number;
  maxMs?: number;
  onEvent?: (e: CallEvent) => void;
};

const FRAME = 160;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const audible = (pcm: Int16Array) => { for (const x of pcm) if (x > 600 || x < -600) return true; return false; };

export async function runLocalConversation(opts: LocalConversationOptions): Promise<LocalConversationReport> {
  const script = opts.script ?? DEFAULT_CALLEE_SCRIPT;
  const maxMs = opts.maxMs ?? 90_000;
  const maxUsd = opts.maxUsd ?? 0.05;
  const t0 = performance.now();
  const now = () => Math.round(performance.now() - t0);

  // The line as the callee hears it: agent audio queued in order, like a carrier's playback buffer.
  const agentLine = new Int16Array(8 * maxMs), calleeLine = new Int16Array(8 * maxMs);
  let playEnd = 0, sentMs = 0;
  const clears: number[] = [];
  const sends: Array<{ at: number; playAt: number }> = [];
  const events = new OutputQueue<CarrierEvent>();
  let hungUp = false;
  const media: CarrierMediaSession = {
    audio: MULAW_8K,
    events,
    send(chunk) {
      const pcm = toPcm16(chunk), start = Math.max(now(), playEnd);
      for (let i = 0; i < pcm.length && start * 8 + i < agentLine.length; i++) agentLine[start * 8 + i] = pcm[i]!;
      playEnd = start + pcm.length / 8; sentMs += pcm.length / 8;
      if (audible(pcm)) sends.push({ at: now(), playAt: start });
    },
    clear() {
      const at = now();
      for (let k = at * 8; k < Math.min(playEnd * 8, agentLine.length); k++) agentLine[k] = 0;
      playEnd = at; clears.push(at);
    },
    async hangup() { hungUp = true; },
    now,
  };
  const carrier: CarrierTransport = { providerId: "local", path: "simulator", describe: () => "local loop (no carrier)", async dial() { setTimeout(() => events.push({ type: "connected" }), 0); return media; } };

  const transcript: LocalConversationReport["transcript"] = [];
  const log: Array<{ at: number; type: string; source?: string; latencyMs?: number }> = [];
  let brainCostUsd = 0, brainInputTokens = 0, brainOutputTokens = 0, firstSystemPrompt: string | null = null, stoppedForBudget = false;
  const brain: BrainProvider = {
    name: opts.brain.name,
    async respond(ctx, hooks) {
      if (firstSystemPrompt === null && opts.systemPrompt) firstSystemPrompt = opts.systemPrompt(ctx);
      const r = await opts.brain.respond(ctx, hooks);
      brainCostUsd += r.usage?.costUsd ?? 0; brainInputTokens += r.usage?.inputTokens ?? 0; brainOutputTokens += r.usage?.outputTokens ?? 0;
      return r;
    },
  };
  let calleeTtsChars = 0;
  const estimate = () => (now() / 60000) * LOCAL_CONVERSATION_RATES.sttPerMinute + (sentMs / 1000) * LOCAL_CONVERSATION_RATES.ttsPerSecond + brainCostUsd + calleeTtsChars * LOCAL_CONVERSATION_RATES.calleeTtsPerChar;

  const runtime = new CallRuntime({
    contract: opts.contract,
    // Same transport options as the web phone. The transcript notice is the carrier's to play; this loop has none.
    transport: new PhoneTransport(carrier, opts.engine, { transcriptNotice: true }),
    brain,
    callId: `local_${Date.now().toString(36)}`,
    onEvent: (e) => {
      const at = now();
      if (e.type === "transcript.final") transcript.push({ atMs: at, who: e.source === "callee" ? "callee" : "agent", text: e.text, ...(e.interrupted ? { interrupted: true } : {}) });
      if (e.type === "agent.speech.ended" && e.interrupted) { const last = [...transcript].reverse().find((t) => t.who === "agent"); if (last) last.interrupted = true; }
      if (["transcript.final", "brain.response", "agent.speech.started", "call.ended"].includes(e.type)) log.push({ at, type: e.type, ...("source" in e ? { source: e.source } : {}), ...(e.type === "brain.response" ? { latencyMs: e.latencyMs } : {}) });
      opts.onEvent?.(e);
    },
    openingTimeoutMs: 4000,
  });

  // Pre-synthesize the callee once (the same audio for every run of the script).
  const lines: Uint8Array[] = [];
  for (const line of script) { lines.push(await opts.callee.synthesizeMulaw8k(line.text, { language: "ja" })); calleeTtsChars += line.text.length; }

  const calleeTurns: Array<{ index: number; start: number; end: number }> = [];
  // Set from the callee loop (a closure), so kept in a holder the compiler does not narrow to null.
  const cut: { start?: { calleeStartMs: number; agentWasSpeaking: boolean } } = {};
  const silence = new Uint8Array(FRAME).fill(0xff);
  const feed = async (mu: Uint8Array) => {
    for (let i = 0; i < mu.length && !hungUp; i += FRAME) {
      const frame = mu.subarray(i, i + FRAME), pcm = toPcm16({ ...MULAW_8K, data: frame }), at = now();
      for (let k = 0; k < pcm.length && at * 8 + k < calleeLine.length; k++) calleeLine[at * 8 + k] = pcm[k]!;
      events.push({ type: "audio", chunk: { ...MULAW_8K, data: frame } });
      await sleep(20);
    }
  };
  const callee = (async () => {
    let next = 0;
    const connectedAt = now();
    while (!hungUp && now() < maxMs) {
      if (estimate() > maxUsd) { stoppedForBudget = true; runtime.cancel(); break; }
      const t = now(), line = script[next];
      const lastEnd = calleeTurns.at(-1)?.end ?? connectedAt;
      const replied = sends.some((s) => s.at > lastEnd);
      const agentPlaying = playEnd > t;
      const agentSince = sends.find((s) => s.at > lastEnd);
      let go = false;
      if (line && next === 0) go = t - connectedAt > 800;
      else if (line?.interrupt) go = agentPlaying && !!agentSince && t - agentSince.playAt > 1200;
      else if (line) go = (replied && !agentPlaying && t - playEnd > 700) || t - lastEnd > 15_000;
      if (go && line) {
        const start = now();
        if (line.interrupt) cut.start = { calleeStartMs: start, agentWasSpeaking: agentPlaying };
        await feed(lines[next]!);
        calleeTurns.push({ index: next, start, end: now() });
        next++;
        continue;
      }
      if (!line && !agentPlaying && t - (calleeTurns.at(-1)?.end ?? 0) > 8000) break;
      events.push({ type: "audio", chunk: { ...MULAW_8K, data: silence } });
      await sleep(20);
    }
    if (!hungUp) events.push({ type: "hangup", reason: "callee_done" });
  })();

  let endReason: string | null = null, error: string | null = null;
  const limit = setTimeout(() => runtime.cancel(), maxMs + 5000);
  try { endReason = (await runtime.run()).endReason; }
  catch (e) { error = (e as Error).message; }
  finally { clearTimeout(limit); hungUp = true; await callee.catch(() => undefined); }

  const interruptedTurn = calleeTurns.find((c) => script[c.index]?.interrupt);
  let interruption: LocalConversationReport["interruption"] = null;
  if (cut.start && interruptedTurn) {
    const stopped = clears.find((at) => at >= interruptedTurn.start) ?? null;
    const nextAgentStart = log.find((l) => l.type === "agent.speech.started" && l.at > (stopped ?? interruptedTurn.start))?.at ?? Infinity;
    interruption = { ...cut.start, stoppedAfterMs: stopped === null ? null : stopped - interruptedTurn.start, staleAudioAfterStop: stopped !== null && sends.some((s) => s.at > stopped && s.at < nextAgentStart) };
  }
  const replies: ReplyTiming[] = calleeTurns.filter((c) => !script[c.index]?.interrupt).map((c) => {
    const stt = log.find((l) => l.type === "transcript.final" && l.source === "callee" && l.at >= c.start);
    const reply = log.find((l) => l.type === "brain.response" && l.at >= (stt?.at ?? c.end));
    const audio = sends.find((s) => s.at >= c.end);
    return { line: script[c.index]!.text, calleeEndMs: c.end, sttFinalAfterMs: stt ? stt.at - c.end : null, replyTextAfterMs: reply ? reply.at - c.end : null, brainLatencyMs: reply?.latencyMs ?? null, replyAudioAfterMs: audio ? audio.playAt - c.end : null };
  });
  const end = Math.min(agentLine.length, Math.ceil(Math.max(now(), playEnd) * 8));
  const mixed = new Int16Array(end);
  for (let i = 0; i < end; i++) mixed[i] = Math.max(-32768, Math.min(32767, agentLine[i]! + calleeLine[i]!));
  return {
    replies, interruption, transcript, endReason, error, durationMs: now(),
    agentAudio: agentLine.slice(0, end), mixedAudio: mixed, firstSystemPrompt, stoppedForBudget,
    usage: { brainCostUsd, brainInputTokens, brainOutputTokens, ttsAudioSeconds: +(sentMs / 1000).toFixed(1), sttAudioSeconds: +(now() / 1000).toFixed(1), calleeTtsChars, estimatedUsd: +estimate().toFixed(4) },
  };
}

/** 16-bit mono WAV bytes. */
export function wavBytes(pcm: Int16Array, sampleRate = 8000): Uint8Array {
  const out = new Uint8Array(44 + pcm.length * 2), v = new DataView(out.buffer);
  const text = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  text(0, "RIFF"); v.setUint32(4, 36 + pcm.length * 2, true); text(8, "WAVE"); text(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); text(36, "data"); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, pcm[i]!, true);
  return out;
}
