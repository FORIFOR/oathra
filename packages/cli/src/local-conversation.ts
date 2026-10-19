/**
 * A whole phone-request call without a carrier: the same request → contract → CallRuntime → engine → brain
 * path as a real call, with the telephone line replaced by a local loop and the callee played from a
 * short script. Nothing rings; the voice APIs are real and paid. Normal lines wait for the agent's reply to
 * finish playing; one line interrupts on purpose to check barge-in.
 *
 * With `character`, the callee is one of the simulator's scripted characters instead (optionally wrapped in an
 * adversarial mutation): it hears the agent's transcript and answers turn by turn, and its `truth()` says what it
 * actually committed to, so the report carries the verdict and whether it was a false completion.
 */
import type { PhoneRequest } from "@oathra/contract";
import type { BrainContext, BrainProvider, CallEvent } from "@oathra/core";
import { detectFalseCompletion } from "@oathra/eval";
import type { ResultStatus } from "@oathra/evidence";
import { PhoneTransport, type CarrierEvent, type CarrierMediaSession, type CarrierTransport } from "@oathra/phone";
import { CallRuntime, type CallOutcome } from "@oathra/runtime";
import { mulberry32, type CalleeCharacter } from "@oathra/simulator";
import { MULAW_8K, OutputQueue, toPcm16, type VoiceEngine } from "@oathra/voice";
import type { LineConditioner } from "./audio-degrade.js";

export type CalleeLine = { text: string; interrupt?: boolean };
export type CalleeVoice = { synthesizeMulaw8k(text: string, opts: { language: "ja" | "en" }): Promise<Uint8Array> };

/** What the callee says when the agent has been silent for 15 s (at most twice, then it hangs up). */
const HELLO = { ja: "もしもし？", en: "Hello?" } as const;

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
  /** `evaluate()` at the end of the call, as the runtime reported it. Null when the run threw. */
  verdict: { status: ResultStatus; complete: boolean; fields: Record<string, unknown>; missing: string[] } | null;
  /** What a scripted character actually committed to; null for a plain script. */
  truth: Record<string, unknown> | null;
  falseCompletion: boolean;
  disagreements: string[];
};

export type LocalConversationOptions = {
  /** Kept for the report; the call itself runs from `contract`. */
  request?: PhoneRequest;
  contract: import("@oathra/contract").CallContract;
  engine: VoiceEngine;
  brain: BrainProvider;
  callee: CalleeVoice;
  script?: CalleeLine[];
  /** A scripted character answers instead of `script`. */
  character?: CalleeCharacter;
  /** Feeds the character's choices (default: a fixed seed). */
  rng?: () => number;
  /** The call's reference time for dates and times ("tomorrow"), as in a scenario's `knowledge.now`. */
  now?: Date;
  /** Quieter voice, background noise: applied to everything the callee's side sends. */
  line?: LineConditioner;
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
  const character = opts.character;
  const language = opts.contract.language;
  const maxMs = opts.maxMs ?? 90_000;
  const maxUsd = opts.maxUsd ?? 0.05;
  const t0 = performance.now();
  const now = () => Math.round(performance.now() - t0);

  // The line as the callee hears it: agent audio queued in order, like a carrier's playback buffer.
  const agentLine = new Int16Array(8 * maxMs), calleeLine = new Int16Array(8 * maxMs);
  // playEnd counts every frame the line carries, silence included; voicedEnd only audible agent speech, which is
  // what tells a listener that the agent has finished talking.
  let playEnd = 0, voicedEnd = 0, sentMs = 0;
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
      if (audible(pcm)) { sends.push({ at: now(), playAt: start }); voicedEnd = playEnd; }
    },
    clear() {
      const at = now();
      for (let k = at * 8; k < Math.min(playEnd * 8, agentLine.length); k++) agentLine[k] = 0;
      playEnd = at; voicedEnd = Math.min(voicedEnd, at); clears.push(at);
    },
    async hangup() { hungUp = true; },
    now,
  };
  const carrier: CarrierTransport = { providerId: "local", path: "simulator", playsNotice: true, describe: () => "local loop (no carrier)", async dial() { setTimeout(() => events.push({ type: "connected" }), 0); return media; } };

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
  // A fatal runtime error ends the call as `error` without throwing; the report must still say why.
  let fatal: string | null = null;
  const estimate = () => (now() / 60000) * LOCAL_CONVERSATION_RATES.sttPerMinute + (sentMs / 1000) * LOCAL_CONVERSATION_RATES.ttsPerSecond + brainCostUsd + calleeTtsChars * LOCAL_CONVERSATION_RATES.calleeTtsPerChar;

  const runtime = new CallRuntime({
    contract: opts.contract,
    // Same transport options as the web phone. The transcript notice is the carrier's to play; this loop has none.
    transport: new PhoneTransport(carrier, opts.engine, { transcriptNotice: true }),
    brain,
    callId: `local_${Date.now().toString(36)}`,
    ...(opts.now ? { now: opts.now } : {}),
    onEvent: (e) => {
      const at = now();
      if (e.type === "error" && e.fatal && fatal === null) fatal = e.message;
      if (e.type === "transcript.final") transcript.push({ atMs: at, who: e.source === "callee" ? "callee" : "agent", text: e.text, ...(e.interrupted ? { interrupted: true } : {}) });
      if (e.type === "agent.speech.ended" && e.interrupted) { const last = [...transcript].reverse().find((t) => t.who === "agent"); if (last) last.interrupted = true; }
      if (["transcript.final", "brain.response", "agent.speech.started", "call.ended"].includes(e.type)) log.push({ at, type: e.type, ...("source" in e ? { source: e.source } : {}), ...(e.type === "brain.response" ? { latencyMs: e.latencyMs } : {}) });
      opts.onEvent?.(e);
    },
    openingTimeoutMs: 4000,
  });

  const synthesize = (text: string) => { calleeTtsChars += text.length; return opts.callee.synthesizeMulaw8k(text, { language }); };
  // Pre-synthesize what is known before the call (the script, or the character's greeting), so TTS time does not
  // count as the callee's pause.
  const lines: Uint8Array[] = [];
  if (!character) for (const line of script) lines.push(await synthesize(line.text));
  const greeting = character?.greeting();
  const greetingAudio = greeting ? await synthesize(greeting) : undefined;

  const calleeTurns: Array<{ text: string; interrupt: boolean; start: number; end: number }> = [];
  // Set from the callee loop (a closure), so kept in a holder the compiler does not narrow to null.
  const cut: { start?: { calleeStartMs: number; agentWasSpeaking: boolean } } = {};
  const silence = new Uint8Array(FRAME).fill(0xff);
  const quiet = () => opts.line ? opts.line.silence(FRAME) : silence;
  const feed = async (mu: Uint8Array) => {
    for (let i = 0; i < mu.length && !hungUp; i += FRAME) {
      const frame = mu.subarray(i, i + FRAME);
      record(frame);
      events.push({ type: "audio", chunk: { ...MULAW_8K, data: frame } });
      await sleep(20);
    }
  };
  const record = (frame: Uint8Array) => {
    const pcm = toPcm16({ ...MULAW_8K, data: frame }), at = now();
    for (let k = 0; k < pcm.length && at * 8 + k < calleeLine.length; k++) calleeLine[at * 8 + k] = pcm[k]!;
  };
  const idle = async () => {
    const frame = quiet();
    if (opts.line) record(frame);
    events.push({ type: "audio", chunk: { ...MULAW_8K, data: frame } });
    await sleep(20);
  };
  const speak = async (text: string, mu: Uint8Array, interrupt = false) => {
    const start = now();
    if (interrupt) cut.start = { calleeStartMs: start, agentWasSpeaking: playEnd > start };
    await feed(opts.line ? opts.line.speech(mu) : mu);
    calleeTurns.push({ text, interrupt, start, end: now() });
  };

  const scriptedCallee = async () => {
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
        await speak(line.text, lines[next]!, !!line.interrupt);
        next++;
        continue;
      }
      if (!line && !agentPlaying && t - (calleeTurns.at(-1)?.end ?? 0) > 8000) break;
      await idle();
    }
  };

  // The character answers once the agent's reply has finished playing and its transcript is in. Its reply is
  // synthesized while the line keeps running, so the agent's side never sees a gap in the audio.
  const rng = opts.rng ?? mulberry32(1);
  const slot: { ready?: { text: string; audio: Uint8Array | null; hangup: boolean } | undefined; waiting?: boolean } = {};
  let calleeError: string | null = null;
  const prepare = (text: string, hangup: boolean) => {
    slot.waiting = true;
    (text.trim() ? synthesize(text) : Promise.resolve(null)).then(
      (audio) => { slot.ready = { text, audio, hangup }; slot.waiting = false; },
      (e: Error) => { calleeError = `callee voice: ${e.message}`; slot.waiting = false; runtime.cancel(); },
    );
  };
  const characterCallee = async (c: CalleeCharacter) => {
    const connectedAt = now();
    let turnIndex = 0, hellos = 0;
    if (greeting && greetingAudio) slot.ready = { text: greeting, audio: greetingAudio, hangup: false };
    while (!hungUp && now() < maxMs && calleeError === null) {
      if (estimate() > maxUsd) { stoppedForBudget = true; runtime.cancel(); break; }
      const t = now();
      const ready = slot.ready;
      if (ready && (calleeTurns.length || t - connectedAt > 800)) {
        slot.ready = undefined;
        if (ready.audio) await speak(ready.text, ready.audio);
        if (ready.hangup) break;
        continue;
      }
      if (!ready && !slot.waiting) {
        const lastEnd = calleeTurns.at(-1)?.end ?? connectedAt;
        const replied = sends.some((s) => s.at > lastEnd);
        const heard = transcript.filter((x) => x.who === "agent" && x.atMs > lastEnd);
        if (replied && t - voicedEnd > 700 && (heard.length || t - voicedEnd > 2500)) {
          hellos = 0;
          const reply = await c.respond({
            transcript: transcript.map((x, i) => ({ id: `turn-${i}`, source: x.who === "callee" ? "callee" : "caller", text: x.text, t: x.atMs })),
            lastAgentText: heard.map((x) => x.text).join(" "),
            language, turnIndex: turnIndex++, rng,
          });
          prepare(reply.text, !!reply.hangup);
        } else if (t - Math.max(lastEnd, voicedEnd) > 15_000) {
          if (hellos++ >= 2) break;
          prepare(HELLO[language], false);
        }
      }
      await idle();
    }
  };

  const callee = (async () => {
    await (character ? characterCallee(character) : scriptedCallee());
    if (!hungUp) events.push({ type: "hangup", reason: "callee_done" });
  })();

  let endReason: string | null = null, error: string | null = null, outcome: CallOutcome | null = null;
  const limit = setTimeout(() => runtime.cancel(), maxMs + 5000);
  try { outcome = await runtime.run(); endReason = outcome.endReason; }
  catch (e) { error = (e as Error).message; }
  finally { clearTimeout(limit); hungUp = true; await callee.catch(() => undefined); }
  error ??= calleeError ?? fatal;
  const truth = character ? (await character.truth?.()) ?? null : null;
  const checked = outcome ? detectFalseCompletion(outcome, truth ?? undefined) : { falseCompletion: false, disagreements: [] };

  const interruptedTurn = calleeTurns.find((c) => c.interrupt);
  let interruption: LocalConversationReport["interruption"] = null;
  if (cut.start && interruptedTurn) {
    const stopped = clears.find((at) => at >= interruptedTurn.start) ?? null;
    const nextAgentStart = log.find((l) => l.type === "agent.speech.started" && l.at > (stopped ?? interruptedTurn.start))?.at ?? Infinity;
    interruption = { ...cut.start, stoppedAfterMs: stopped === null ? null : stopped - interruptedTurn.start, staleAudioAfterStop: stopped !== null && sends.some((s) => s.at > stopped && s.at < nextAgentStart) };
  }
  const replies: ReplyTiming[] = calleeTurns.filter((c) => !c.interrupt).map((c) => {
    const stt = log.find((l) => l.type === "transcript.final" && l.source === "callee" && l.at >= c.start);
    const reply = log.find((l) => l.type === "brain.response" && l.at >= (stt?.at ?? c.end));
    const audio = sends.find((s) => s.at >= c.end);
    return { line: c.text, calleeEndMs: c.end, sttFinalAfterMs: stt ? stt.at - c.end : null, replyTextAfterMs: reply ? reply.at - c.end : null, brainLatencyMs: reply?.latencyMs ?? null, replyAudioAfterMs: audio ? audio.playAt - c.end : null };
  });
  const end = Math.min(agentLine.length, Math.ceil(Math.max(now(), playEnd) * 8));
  const mixed = new Int16Array(end);
  for (let i = 0; i < end; i++) mixed[i] = Math.max(-32768, Math.min(32767, agentLine[i]! + calleeLine[i]!));
  return {
    replies, interruption, transcript, endReason, error, durationMs: now(),
    agentAudio: agentLine.slice(0, end), mixedAudio: mixed, firstSystemPrompt, stoppedForBudget,
    verdict: outcome ? { status: outcome.result.status, complete: outcome.result.complete, fields: outcome.result.fields, missing: outcome.result.missing } : null,
    truth, falseCompletion: checked.falseCompletion, disagreements: checked.disagreements,
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
