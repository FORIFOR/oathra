import type { ConstraintCheck } from "@oathra/contract";

export type Speaker = "caller" | "callee";
export type EvidenceSource = Speaker | "tool";
export type Language = "ja" | "en";

/** A single utterance reaching the evidence engine (a final transcript). */
export type Utterance = {
  id: string;
  /** Who spoke. `caller` is the agent, `callee` is the other party. */
  source: Speaker;
  text: string;
  /** Call-relative milliseconds. */
  t: number;
  audio?: { startMs: number; endMs: number };
  language?: Language;
  /** ASR confidences when available (simulator reports 1.0). */
  asr?: { primary: number; secondary?: number };
};

export type Confidence = {
  primaryAsr: number;
  secondaryAsr?: number;
  semantic: number;
};

/** A typed claim about a field, anchored to audio and transcript. */
export type Evidence<T = unknown> = {
  id: string;
  field: string;
  value: T;
  source: EvidenceSource;
  utteranceId: string;
  audio?: { startMs: number; endMs: number };
  transcript: string;
  /** The clause inside the transcript that produced the claim. */
  span: string;
  confidence: Confidence;
  /** The value was stated literally (not inferred). */
  explicit: boolean;
  /** Verified by the counter-party (accepted or confirmed), or authoritative. */
  verified: boolean;
  t: number;
  /** Why this evidence is (or is not) verified. */
  note?: string;
};

export type EvidenceRelation = "accepted_by" | "confirmed_by" | "supersedes";

export type EvidenceEdge = {
  from: string;
  to: string;
  relation: EvidenceRelation;
};

export type EvidenceGraph = {
  nodes: Evidence[];
  edges: EvidenceEdge[];
};

export type ConnectionState = "idle" | "dialing" | "active" | "completed" | "failed";

export type ResultStatus = "completed" | "incomplete" | "constraint_violation" | "failed";

export type VerifiedResult = {
  status: ResultStatus;
  /** True only when every required field is verified and constraints hold. */
  complete: boolean;
  fields: Record<string, unknown>;
  missing: string[];
  constraints: ConstraintCheck;
  /** Aggregate confidence over verified required fields (0..1). */
  confidence: number;
  evidence: Evidence[];
  graph: EvidenceGraph;
};
