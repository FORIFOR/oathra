import type { Action, CallContract } from "@oathra/contract";
import type { Evidence, VerifiedResult } from "@oathra/evidence";
import type { AgentState, UxState } from "./state.js";
import type { TurnTrace } from "./trace.js";

/** Every event carries a call-relative timestamp and a monotonic sequence. */
type Base = { seq: number; t: number };

export type CallEvent = Base &
  (
    | { type: "call.started"; callId: string; contract: CallContract; transport: string; brain: string; scenario?: string }
    | { type: "call.connected"; callee?: string }
    | { type: "state.changed"; from: AgentState; to: AgentState; ux: UxState }
    | { type: "callee.speech.started"; turnId: string }
    | { type: "callee.speech.ended"; turnId: string; startMs: number; endMs: number }
    | { type: "transcript.partial"; turnId: string; source: "caller" | "callee"; text: string }
    | { type: "transcript.final"; turnId: string; source: "caller" | "callee"; text: string; startMs: number; endMs: number; asr?: { primary: number; secondary?: number } }
    | { type: "evidence.created"; evidence: Evidence }
    | { type: "evidence.verified"; evidence: Evidence }
    | { type: "brain.request"; turnId: string; brain: string }
    | { type: "brain.response"; turnId: string; brain: string; text: string; latencyMs: number; costUsd?: number; action?: "continue" | "hangup" }
    | { type: "permission.requested"; action: Action; detail: string }
    | { type: "permission.decided"; action: Action; approved: boolean; by: "policy" | "human" }
    | { type: "agent.speech.started"; turnId: string; text: string }
    | { type: "agent.speech.ended"; turnId: string; startMs: number; endMs: number; interrupted: boolean }
    | { type: "turn.trace"; trace: TurnTrace }
    | { type: "mission.progress"; verified: string[]; missing: string[]; pending: string[] }
    | { type: "intake.question"; kind: "consent" | "field"; field?: string }
    | { type: "intake.consent"; granted: boolean; utteranceId: string }
    | { type: "intake.answer"; field: string; value?: string; declined: boolean; utteranceId: string }
    | { type: "call.ended"; reason: EndReason; durationMs: number }
    | { type: "result"; result: VerifiedResult }
    | { type: "error"; message: string; fatal: boolean }
  );

export type EndReason =
  | "agent_hangup"
  | "callee_hangup"
  | "voicemail"
  | "completed"
  | "budget_exceeded"
  | "cancelled"
  | "error";

export type CallEventType = CallEvent["type"];

/** Omit that distributes over a union (plain Omit collapses union members). */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** An event without its sequence number (assigned by the log). */
export type EventInput = DistributiveOmit<CallEvent, "seq">;

export type EventListener = (event: CallEvent) => void;

/** Ordered, append-only log with subscription. Used by runtime, UI and replay. */
export class EventLog {
  private readonly events: CallEvent[] = [];
  private readonly listeners = new Set<EventListener>();
  private seq = 0;

  append(event: EventInput): CallEvent {
    const e = { ...event, seq: this.seq++ } as CallEvent;
    this.events.push(e);
    for (const l of this.listeners) l(e);
    return e;
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  all(): readonly CallEvent[] {
    return this.events;
  }

  toJSONL(): string {
    return this.events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  }

  static fromJSONL(text: string): CallEvent[] {
    return text
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as CallEvent);
  }
}
