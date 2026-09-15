/**
 * VoiceEngine adapters for the speech-to-speech agents. A carrier bridge feeds
 * chunks in any format; the adapters normalize the carrier side to μ-law 8 kHz
 * while each OpenAI agent uses its own native WebSocket format internally, then
 * publish model audio, clears and session events on the engine's output queue.
 */
import type { Action } from "@oathra/contract";
import type { MissionView } from "@oathra/core";
import { convert, MULAW_8K, OutputQueue, type AudioChunk, type VoiceEngine, type VoiceOutput, type VoiceSession, type VoiceSessionContext } from "@oathra/voice";
import { OpenAIRealtimeAgent } from "./index.js";
import { OpenAILiveAgent } from "./live.js";

type AgentLike = {
  pushAudio(mulaw: Uint8Array): void;
  updateContext(view: MissionView): void;
  resolveAction(action: Action, approved: boolean): void;
  close(): void;
  interrupt?(): void;
  connect(bridge: { sendAudio(mulaw: Uint8Array): void; clearAudio(): void; emit(event: VoiceOutput extends { type: "event"; event: infer E } ? E : never): void; now(): number }): Promise<void>;
};

class S2SVoiceSession implements VoiceSession {
  readonly output: AsyncIterable<VoiceOutput>;
  private readonly queue = new OutputQueue<VoiceOutput>();
  private closed = false;

  constructor(
    private readonly agent: AgentLike,
    private readonly clock: { now(): number },
  ) {
    this.output = this.queue;
  }

  async start(): Promise<void> {
    await this.agent.connect({
      sendAudio: (mulaw) => this.queue.push({ type: "audio", chunk: { ...MULAW_8K, data: mulaw } }),
      clearAudio: () => this.queue.push({ type: "clear" }),
      emit: (event) => this.queue.push({ type: "event", event }),
      now: () => this.clock.now(),
    });
  }

  input(chunk: AudioChunk): void {
    if (this.closed) return;
    this.agent.pushAudio(convert(chunk, MULAW_8K).data);
  }

  updateContext(view: MissionView): void {
    this.agent.updateContext(view);
  }

  resolveAction(action: Action, approved: boolean): void {
    this.agent.resolveAction(action, approved);
  }

  interrupt(): void {
    this.agent.interrupt?.();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.agent.close();
    this.queue.close();
  }

  now(): number {
    return this.clock.now();
  }
}

export type GptLiveEngineOptions = { model?: string; voice?: string; delegateTo?: string; webSearch?: boolean; apiKey?: string; url?: string };

export function gptLiveEngine(opts: GptLiveEngineOptions = {}): VoiceEngine {
  const model = opts.model ?? "gpt-live-1";
  return {
    id: "gpt-live",
    label: `GPT-Live (${model})`,
    speaksItself: true,
    nativeAudio: MULAW_8K,
    requires: ["OPENAI_API_KEY"],
    async start(ctx: VoiceSessionContext, clock) {
      const agent = new OpenAILiveAgent({
        contract: ctx.contract,
        model,
        ...(opts.voice ? { voice: opts.voice } : {}),
        ...(opts.delegateTo ? { delegateTo: opts.delegateTo } : {}),
        ...(opts.webSearch !== undefined ? { webSearch: opts.webSearch } : {}),
        ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
        ...(opts.url ? { url: opts.url } : {}),
        ...(ctx.calleeName ? { calleeName: ctx.calleeName } : {}),
      });
      const session = new S2SVoiceSession(agent, clock);
      await session.start();
      return session;
    },
  };
}

export type RealtimeEngineOptions = { model?: string; voice?: string; apiKey?: string; url?: string };

export function realtimeEngine(opts: RealtimeEngineOptions = {}): VoiceEngine {
  const model = opts.model ?? "gpt-realtime-2.1";
  return {
    id: "realtime",
    label: `OpenAI Realtime (${model})`,
    speaksItself: true,
    nativeAudio: MULAW_8K,
    requires: ["OPENAI_API_KEY"],
    async start(ctx: VoiceSessionContext, clock) {
      const agent = new OpenAIRealtimeAgent({
        contract: ctx.contract,
        model,
        ...(opts.voice ? { voice: opts.voice } : {}),
        ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
        ...(opts.url ? { url: opts.url } : {}),
        ...(ctx.calleeName ? { calleeName: ctx.calleeName } : {}),
      });
      const session = new S2SVoiceSession(agent, clock);
      await session.start();
      return session;
    },
  };
}
