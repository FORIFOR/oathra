/**
 * VoiceSession adapter for speech-to-speech agents. A carrier bridge feeds chunks in any format; the
 * adapter normalizes the carrier side to μ-law 8 kHz while each agent uses its own native WebSocket
 * format internally, then publishes model audio, clears and session events on the engine's output queue.
 */
import type { Action } from "@oathra/contract";
import type { MissionView } from "@oathra/core";
import { convert, MULAW_8K, OutputQueue, type AudioChunk, type VoiceOutput, type VoiceSession } from "@oathra/voice";

export type AgentLike = {
  pushAudio(mulaw: Uint8Array): void;
  updateContext(view: MissionView): void;
  resolveAction(action: Action, approved: boolean): void;
  close(): void | Promise<void>;
  interrupt?(): void;
  connect(bridge: { sendAudio(mulaw: Uint8Array): void; clearAudio(): void; emit(event: VoiceOutput extends { type: "event"; event: infer E } ? E : never): void; now(): number }): Promise<void>;
};

export class S2SVoiceSession implements VoiceSession {
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
    await this.agent.close();
    this.queue.close();
  }

  now(): number {
    return this.clock.now();
  }
}

