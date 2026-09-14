/**
 * Provider protocols. Core knows nothing about specific vendors.
 * Dependency direction: contract -> evidence -> core -> runtime -> providers.
 */
import type { Action, CallContract, Target } from "@oathra/contract";
import type { Language, Speaker } from "@oathra/evidence";
import type { AudioFrame } from "./audio.js";

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/** What the runtime receives from the far end of the call. */
export type SessionEvent =
  | { type: "connected"; callee?: string }
  /** Far end started talking (lets the runtime hold its turn before the transcript arrives). */
  | { type: "speech.started"; startMs: number }
  /** Far-end speech that has already been transcribed (simulator, or a transport with built-in STT). */
  | { type: "speech"; text: string; startMs: number; endMs: number; asr?: { primary: number; secondary?: number } }
  /** Raw far-end audio; the runtime routes it through STT + TurnEngine. */
  | { type: "audio"; frame: AudioFrame }
  /** Far end started talking while the agent was speaking. */
  | { type: "interruption"; atMs: number }
  /**
   * The transport produced the agent's speech itself (speech-to-speech
   * models). The runtime records it as the agent's turn instead of running a
   * BrainProvider. `ttfaMs` is time from the callee's speech end to first audio.
   */
  | { type: "agent.speech"; text: string; startMs: number; endMs: number; ttfaMs?: number; interrupted?: boolean }
  /** The transport's own agent asked for an action the contract may not allow. */
  | { type: "action.requested"; action: Action; detail: string }
  | { type: "hangup"; reason?: string }
  /** `fatal: false` reports a recoverable provider error without ending the call. */
  | { type: "error"; message: string; fatal?: boolean };

export type SpeakInput = {
  text: string;
  /** Pre-synthesised audio when the runtime already ran TTS. */
  audio?: AsyncIterable<AudioFrame>;
  language: Language;
};

export type SpeakResult = { startMs: number; endMs: number; interrupted: boolean };

export interface CallSession {
  /** Stream of far-end events. Ends when the call ends. */
  readonly events: AsyncIterable<SessionEvent>;
  /** Play speech to the far end. Resolves when playback finishes or is interrupted. */
  speak(input: SpeakInput): Promise<SpeakResult>;
  /** Stop current playback immediately (interruption). */
  interrupt(): void;
  /**
   * Play a short, pre-synthesised acknowledgement ("はい。") right away while
   * the brain is thinking. Optional; audio transports use it to keep the
   * conversation's rhythm human.
   */
  ack?(): void;
  /**
   * For self-speaking transports: push the current mission state (verified /
   * pending / missing / violations) into the model so its next turn is
   * grounded in the deterministic evidence, not its own memory.
   */
  updateContext?(view: MissionView): void;
  /** For self-speaking transports: answer to an `action.requested` event. */
  resolveAction?(action: Action, approved: boolean): void;
  hangup(reason?: string): Promise<void>;
  /** Milliseconds since the session started. */
  now(): number;
}

export interface TransportProvider {
  readonly name: string;
  readonly kind: "simulator" | "sip" | "webrtc" | "browser";
  /** Whether `speech` events arrive already transcribed. */
  readonly deliversText: boolean;
  /** The transport generates the agent's replies itself (speech-to-speech); no BrainProvider turn is run. */
  readonly speaksItself?: boolean;
  connect(target: Target, opts: { language: Language; contract: CallContract }): Promise<CallSession>;
}

// ---------------------------------------------------------------------------
// STT / TTS
// ---------------------------------------------------------------------------

export type SpeechContext = {
  language: Language;
  /** Vocabulary hints (names, product codes) to bias recognition. */
  keywords?: string[];
};

export type TranscriptEvent =
  | { type: "partial"; text: string; t: number }
  | { type: "final"; text: string; startMs: number; endMs: number; confidence: number };

export interface STTProvider {
  readonly name: string;
  stream(audio: AsyncIterable<AudioFrame>, context: SpeechContext): AsyncIterable<TranscriptEvent>;
}

export interface TTSProvider {
  readonly name: string;
  synthesize(text: string, opts: { language: Language; voice?: string }): AsyncIterable<AudioFrame>;
}

// ---------------------------------------------------------------------------
// Turn engine
// ---------------------------------------------------------------------------

export type TurnState = "listening" | "possible_end" | "confirmed_end" | "interruption" | "backchannel";

export interface TurnEngine {
  readonly name: string;
  onAudio(frame: AudioFrame): void;
  onTranscript(event: TranscriptEvent): void;
  readonly state: TurnState;
  onStateChange(listener: (state: TurnState, atMs: number) => void): () => void;
  reset(): void;
}

// ---------------------------------------------------------------------------
// Brain
// ---------------------------------------------------------------------------

export type Turn = { id: string; source: Speaker; text: string; t: number };

export type MissionView = {
  /** Verified field values so far. */
  verified: Record<string, unknown>;
  /** Fields the callee has offered but the agent has not yet accepted (unverified). */
  pending: Record<string, unknown>;
  /** Required fields not yet verified. */
  missing: string[];
  /** Constraint violations on verified values, if any. */
  violations: Array<{ field: string; rule: string; expected: unknown; actual: unknown }>;
  /** Optional consent-gated intake state for self-speaking transports. */
  intake?: IntakeView;
};

export type IntakeStatus = "disabled" | "not_started" | "awaiting_consent" | "active" | "declined" | "complete";

/** One explicit answer captured after consent; never an inferred attribute. */
export type IntakeAnswer = {
  key: string;
  label: string;
  value: string;
  utteranceId: string;
  transcript: string;
  t: number;
};

/** The callee's explicit answer to the one-time intake consent prompt. */
export type IntakeConsent = {
  granted: boolean;
  utteranceId: string;
  t: number;
};

/** Runtime state surfaced to brains so they can ask one bounded question at a time. */
export type IntakeView = {
  status: IntakeStatus;
  purpose?: string;
  maxQuestions?: number;
  askedQuestions: number;
  pendingField?: string;
  consent?: IntakeConsent;
  answers: IntakeAnswer[];
  declined: string[];
};

export type BrainContext = {
  contract: CallContract;
  language: Language;
  transcript: Turn[];
  mission: MissionView;
  /** Optional consent-gated intake state. Absent means this call has no intake. */
  intake?: IntakeView;
  /** Actions the agent is allowed to take without asking. */
  permitted: Action[];
  /** Milliseconds since the call started. */
  elapsedMs: number;
  turnIndex: number;
  /** One-off steering from the runtime (e.g. "do not repeat your last line"). */
  hints?: string[];
};

export type BrainResponse = {
  text: string;
  /** "hangup" ends the call after speaking. Default "continue". */
  action?: "continue" | "hangup";
  /** An action the brain wants to take that needs a permission check. */
  requestedAction?: { action: Action; detail: string };
  usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number };
  /** The line is repeated on purpose (the callee asked to hear it again); the runtime must not rewrite it. */
  verbatim?: boolean;
  /** Deterministic runtime marker for a consent or one-field intake question. */
  intakeQuestion?: { kind: "consent" } | { kind: "field"; field: string };
};

export interface BrainProvider {
  readonly name: string;
  /** Produce the agent's next utterance. Implementations may stream via onToken. */
  respond(ctx: BrainContext, hooks?: { onToken?: (token: string) => void }): Promise<BrainResponse>;
}

// ---------------------------------------------------------------------------
// Verification (secondary ASR / entity fusion)
// ---------------------------------------------------------------------------

export interface VerificationProvider {
  readonly name: string;
  /** Re-transcribe a span of audio for entity agreement checks. */
  verify(audio: AudioFrame[], context: SpeechContext): Promise<{ text: string; confidence: number }>;
}

// ---------------------------------------------------------------------------
// Permission
// ---------------------------------------------------------------------------

export type PermissionDecision = { approved: boolean; by: "policy" | "human" };

export interface PermissionGate {
  /** Called when the brain requests an action the contract does not pre-authorise. */
  ask(action: Action, detail: string): Promise<PermissionDecision>;
}

export const denyAll: PermissionGate = {
  ask: async () => ({ approved: false, by: "policy" }),
};
