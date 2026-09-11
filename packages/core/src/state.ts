/**
 * Internal agent states are fine-grained; the UX shows only four.
 * The two are kept separate so the UI never has to know about pipeline internals.
 */
export const AGENT_STATES = [
  "IDLE",
  "DIALING",
  "LISTENING",
  "TRANSCRIBING",
  "TURN_PENDING",
  "THINKING",
  "VERIFYING",
  "TOOL_CALLING",
  "AWAITING_PERMISSION",
  "SYNTHESIZING",
  "SPEAKING",
  "ENDED",
] as const;
export type AgentState = (typeof AGENT_STATES)[number];

export type UxState = "listening" | "understanding" | "acting" | "speaking" | "idle";

export function toUxState(s: AgentState): UxState {
  switch (s) {
    case "LISTENING":
    case "TRANSCRIBING":
    case "TURN_PENDING":
      return "listening";
    case "THINKING":
    case "VERIFYING":
      return "understanding";
    case "TOOL_CALLING":
    case "AWAITING_PERMISSION":
    case "DIALING":
      return "acting";
    case "SYNTHESIZING":
    case "SPEAKING":
      return "speaking";
    case "IDLE":
    case "ENDED":
      return "idle";
  }
}

/** Allowed transitions. Anything not listed is a bug and throws. */
const TRANSITIONS: Record<AgentState, readonly AgentState[]> = {
  IDLE: ["DIALING", "ENDED"],
  DIALING: ["LISTENING", "ENDED"],
  LISTENING: ["TRANSCRIBING", "TURN_PENDING", "THINKING", "ENDED"],
  TRANSCRIBING: ["TURN_PENDING", "LISTENING", "THINKING", "ENDED"],
  TURN_PENDING: ["THINKING", "LISTENING", "ENDED"],
  THINKING: ["VERIFYING", "TOOL_CALLING", "AWAITING_PERMISSION", "SYNTHESIZING", "LISTENING", "ENDED"],
  VERIFYING: ["THINKING", "SYNTHESIZING", "LISTENING", "ENDED"],
  TOOL_CALLING: ["THINKING", "SYNTHESIZING", "ENDED"],
  AWAITING_PERMISSION: ["THINKING", "SYNTHESIZING", "LISTENING", "ENDED"],
  SYNTHESIZING: ["SPEAKING", "LISTENING", "ENDED"],
  SPEAKING: ["LISTENING", "THINKING", "ENDED"],
  ENDED: [],
};

export class StateMachine {
  private current: AgentState = "IDLE";
  private readonly listeners = new Set<(from: AgentState, to: AgentState) => void>();

  get state(): AgentState {
    return this.current;
  }

  get ux(): UxState {
    return toUxState(this.current);
  }

  canTransition(to: AgentState): boolean {
    return TRANSITIONS[this.current].includes(to);
  }

  transition(to: AgentState): void {
    if (to === this.current) return;
    if (!this.canTransition(to)) {
      throw new Error(`Illegal state transition ${this.current} -> ${to}`);
    }
    const from = this.current;
    this.current = to;
    for (const l of this.listeners) l(from, to);
  }

  onChange(listener: (from: AgentState, to: AgentState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
