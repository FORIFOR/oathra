import type { Action, CallContract, Target } from "@oathra/contract";
import type { Language } from "@oathra/evidence";
import type { AudioChunk, AudioSpec, VoiceEngine } from "@oathra/voice";

// ---------------------------------------------------------------------------
// Carrier media (one live call on one carrier)
// ---------------------------------------------------------------------------

export type CarrierEvent =
  | { type: "connected"; callId?: string }
  | { type: "audio"; chunk: AudioChunk }
  /** Playback marker echoed by the carrier (optional; bridges fall back to timing). */
  | { type: "mark"; name: string }
  | { type: "hangup"; reason?: string }
  | { type: "error"; message: string; fatal?: boolean };

export interface CarrierMediaSession {
  /** The carrier's wire format for both directions. */
  readonly audio: AudioSpec;
  readonly events: AsyncIterable<CarrierEvent>;
  /** Queue agent audio for playback (must already be in `audio` spec). */
  send(chunk: AudioChunk): void;
  /** Ask the carrier to echo a marker once everything queued so far has played. */
  mark?(name: string): void;
  /** Drop everything queued for playback (barge-in). */
  clear(): void;
  hangup(reason?: string): Promise<void>;
  /** ms since the media session started. */
  now(): number;
}

export type DialOptions = {
  to: string;
  callerId?: string;
  language: Language;
  contract: CallContract;
  /** Directory for callee.wav / caller.wav; carriers may ignore. */
  recordDir?: string;
};

export interface CarrierTransport {
  readonly providerId: string;
  /** e.g. "direct" (Twilio Media Streams) or "sip" (via a SipGateway). */
  readonly path: "direct" | "sip" | "webrtc" | "simulator";
  dial(opts: DialOptions): Promise<CarrierMediaSession>;
  /** Free-form readiness (no network). */
  describe(): string;
}

// ---------------------------------------------------------------------------
// SIP gateway (LiveKit first; Asterisk / FreeSWITCH / direct SIP later)
// ---------------------------------------------------------------------------

export type SipTrunkSpec = {
  /** Outbound SIP address, e.g. "sip.plivo.com" or "sip.example.com:5061". */
  address: string;
  transport?: "udp" | "tcp" | "tls";
  username?: string;
  password?: string;
  /** Caller IDs the trunk may present. */
  numbers: string[];
  /** Provider label for diagnostics. */
  provider: string;
};

export interface SipGateway {
  readonly id: string; // "livekit-cloud" | "livekit-selfhost" | ...
  readonly label: string;
  readonly requires: string[];
  /** Create or update the outbound trunk for a carrier; returns the gateway's trunk id. */
  ensureTrunk(trunk: SipTrunkSpec): Promise<{ trunkId: string; created: boolean }>;
  listTrunks(): Promise<Array<{ trunkId: string; address: string; numbers: string[] }>>;
  removeTrunk(trunkId: string): Promise<void>;
  /** Place a call through a trunk and hand back media. */
  dial(trunkId: string, opts: DialOptions): Promise<CarrierMediaSession>;
  /** Gateway-level checks (auth, reachability). */
  check(): Promise<DoctorCheck[]>;
  /** Loopback test without PSTN, if the gateway can host one. */
  loopback?(engineAudio: AudioSpec): Promise<DoctorCheck[]>;
}

// ---------------------------------------------------------------------------
// Provisioning: automate what we can, guide the human through the rest
// ---------------------------------------------------------------------------

export type ProvisionStep =
  | {
      type: "automatic";
      id: string;
      title: string;
      /** Continue to a following user_action when this check is not ready yet. */
      continueOnFailure?: boolean;
      run(): Promise<{ ok: boolean; detail?: string }>;
    }
  | {
      type: "user_action";
      id: string;
      title: string;
      /** Why the provider needs a human here. */
      reason: string;
      url?: string;
      /** Poll until the human finished. */
      verify(): Promise<boolean>;
    };

export type ProvisionInput = {
  /** Answers collected by `setup` (credentials, number choice...). Secrets stay in env. */
  answers: Record<string, string>;
  env: NodeJS.ProcessEnv;
  gateway?: SipGateway;
};

export type ProvisionResult = {
  /** Provider config persisted to .oathra/phone.yaml (no secrets). */
  config: Record<string, unknown>;
  /** Env vars the user must keep in .env. */
  envKeys: string[];
  notes?: string[];
};

/** A question `setup` asks before provisioning. `secret` answers go to .env, not the config file. */
export type SetupQuestion = { key: string; label: string; secret?: boolean; envKey?: string; placeholder?: string; optional?: boolean };

// ---------------------------------------------------------------------------
// Doctor
// ---------------------------------------------------------------------------

export type DoctorCheck = { label: string; ok: boolean; detail?: string; fix?: string; skipped?: boolean };
export type DoctorSection = { name: string; checks: DoctorCheck[] };
export type LatencySample = { hop: string; ms: number };
export type DoctorReport = {
  sections: DoctorSection[];
  latency: LatencySample[];
  cost?: RateEstimate;
  ready: boolean;
};

export type RateEstimate = { destination: string; provider: string; ratePerMin: number; currency: "USD" | "JPY"; note?: string };

// ---------------------------------------------------------------------------
// Phone provider
// ---------------------------------------------------------------------------

export type PhoneCapabilities = { direct?: boolean; sip: boolean; outbound: boolean; inbound: boolean; sms?: boolean };

export type ProviderContext = {
  config: Record<string, unknown>;
  env: NodeJS.ProcessEnv;
  gateway?: SipGateway;
};

export interface PhoneProvider {
  readonly id: string;
  readonly label: string;
  readonly capabilities: PhoneCapabilities;
  /** Env vars needed at call time. */
  readonly requires: string[];
  readonly questions: SetupQuestion[];
  /** Steps `setup` executes in order. */
  provision(input: ProvisionInput): Promise<{ steps: ProvisionStep[]; finish(): Promise<ProvisionResult> }>;
  transport(ctx: ProviderContext): CarrierTransport;
  doctor(ctx: ProviderContext, opts: { destination?: string; engine?: VoiceEngine }): Promise<DoctorReport>;
  pricing?(destination: string): RateEstimate | undefined;
  remove?(ctx: ProviderContext): Promise<void>;
}

export function definePhoneProvider(def: PhoneProvider): PhoneProvider {
  return def;
}

export type PhoneTarget = Target & { phone: string };
