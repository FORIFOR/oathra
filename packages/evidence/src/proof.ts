import type { VerifiedResult } from "./types.js";

/** Ordered proof levels for a real-world action. */
export const PROOF_LEVELS = ["claimed", "conversation", "confirmation", "system", "outcome"] as const;
export type ProofLevel = (typeof PROOF_LEVELS)[number];

export type ConfirmationSource = "email" | "sms" | "webhook";
export type SystemSource = "reservation_api" | "browser" | "calendar" | "pos";
export type OutcomeSource = "manual" | "operator";
export type ProofSource = "conversation" | ConfirmationSource | SystemSource | OutcomeSource;

/** Context passed to an external verification provider for one call. */
export type VerificationContext = {
  /** Call identifier used to correlate provider records with the transcript. */
  callId?: string;
  /** Evaluation/provider time. Providers should use this for freshness checks. */
  now?: Date;
  /** Non-sensitive correlation data supplied by the host application. */
  metadata?: Readonly<Record<string, unknown>>;
};

/** The fields that must be true for an action to be considered complete. */
export type ActionExpectation = {
  action: string;
  fields: Record<string, unknown>;
};

/**
 * An observation supplied by an adapter or by the conversation evidence
 * engine. Adapters must establish `sourceVerified` before submitting data;
 * merely parsing an email, SMS or web page is not enough to create a proof.
 */
export type ProofObservation = {
  id: string;
  source: ProofSource;
  observedAt: string;
  fields: Record<string, unknown>;
  sourceVerified: boolean;
  /** A stable provider message, reservation or record identifier. */
  referenceId?: string;
  /** Optional freshness bound for confirmations and external records. */
  expiresAt?: string;
  /** IDs of conversation evidence nodes supporting a conversation observation. */
  evidenceIds?: string[];
};

export type ProofCheck = {
  observationId: string;
  source: ProofSource;
  level: ProofLevel;
  verified: boolean;
  missing: string[];
  mismatched: string[];
  reasons: string[];
};

export type ActionProof = {
  action: string;
  expected: Record<string, unknown>;
  /** Highest level whose observation passed every check. */
  level: ProofLevel;
  verified: boolean;
  checkedAt: string;
  checks: ProofCheck[];
  /** IDs of observations that passed and support the selected level. */
  evidenceIds: string[];
};

export type ProofEvaluationOptions = {
  /** Evaluation time. Defaults to the current time. */
  now?: Date;
};

/**
 * Contract for an authenticated email/SMS/webhook, system or outcome adapter.
 *
 * The adapter owns authentication and provider-specific API calls. Oathra
 * still performs the deterministic field, timestamp and reference checks in
 * `evaluateActionProof`; an adapter cannot mark an observation as trusted by
 * changing the final proof itself.
 */
export interface VerificationProvider {
  readonly id: string;
  readonly source: Exclude<ProofSource, "conversation">;
  verify(expected: ActionExpectation, context: VerificationContext): Promise<ProofObservation>;
}

/** Alias used by integrations that call providers "adapters". */
export type VerificationAdapter = VerificationProvider;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function valuesEqual(actual: unknown, expected: unknown): boolean {
  if (Object.is(actual, expected)) return true;
  if (Array.isArray(actual) && Array.isArray(expected)) {
    return actual.length === expected.length && actual.every((value, index) => valuesEqual(value, expected[index]));
  }
  if (isRecord(actual) && isRecord(expected)) {
    const actualKeys = Object.keys(actual);
    const expectedKeys = Object.keys(expected);
    return actualKeys.length === expectedKeys.length
      && expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(actual, key) && valuesEqual(actual[key], expected[key]));
  }
  return false;
}

function compareFields(expected: Record<string, unknown>, actual: Record<string, unknown>): Pick<ProofCheck, "missing" | "mismatched"> {
  const missing: string[] = [];
  const mismatched: string[] = [];
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (!Object.prototype.hasOwnProperty.call(actual, key)) {
      missing.push(key);
      continue;
    }
    if (!valuesEqual(actual[key], expectedValue)) mismatched.push(key);
  }
  return { missing, mismatched };
}

function parseDate(value: string, label: string, reasons: string[]): Date | undefined {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) reasons.push(`${label} must be an ISO-8601 timestamp`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function levelForSource(source: ProofSource): ProofLevel {
  if (source === "conversation") return "conversation";
  if (source === "email" || source === "sms" || source === "webhook") return "confirmation";
  if (source === "reservation_api" || source === "browser" || source === "calendar" || source === "pos") return "system";
  return "outcome";
}

function validateObservation(
  expected: Record<string, unknown>,
  observation: ProofObservation,
  now: Date,
): ProofCheck {
  const level = levelForSource(observation.source);
  const reasons: string[] = [];
  const observedAt = parseDate(observation.observedAt, "observedAt", reasons);
  const expiresAt = observation.expiresAt ? parseDate(observation.expiresAt, "expiresAt", reasons) : undefined;
  const { missing, mismatched } = compareFields(expected, observation.fields);

  if (!observation.id.trim()) reasons.push("id is required");
  if (!observation.sourceVerified) reasons.push("source identity was not verified");
  if (level !== "conversation" && !observation.referenceId?.trim()) reasons.push("referenceId is required for independent proof");
  if (observedAt && observedAt.getTime() > now.getTime()) reasons.push("observedAt is in the future");
  if (expiresAt && expiresAt.getTime() < now.getTime()) reasons.push("observation has expired");
  if (expiresAt && observedAt && expiresAt.getTime() < observedAt.getTime()) reasons.push("expiresAt precedes observedAt");
  if (missing.length) reasons.push(`missing expected fields: ${missing.join(", ")}`);
  if (mismatched.length) reasons.push(`mismatched expected fields: ${mismatched.join(", ")}`);

  return {
    observationId: observation.id,
    source: observation.source,
    level,
    verified: reasons.length === 0,
    missing,
    mismatched,
    reasons,
  };
}

/**
 * Convert the existing conversation result into a V1 observation. This keeps
 * the existing EvidenceEngine as the authority for conversation proof while
 * allowing the same expected fields to be checked against later evidence.
 */
export function conversationObservation(
  expected: ActionExpectation,
  result: Pick<VerifiedResult, "complete" | "fields" | "evidence">,
  observedAt = new Date().toISOString(),
): ProofObservation {
  return {
    id: `conversation:${expected.action}`,
    source: "conversation",
    observedAt,
    fields: result.fields,
    sourceVerified: result.complete,
    evidenceIds: result.evidence.filter((e) => e.verified).map((e) => e.id),
  };
}

/**
 * Evaluate independent observations without contacting any provider.
 *
 * The function is intentionally conservative: a V2/V3 observation must have
 * an authenticated source, a stable reference ID, matching expected fields,
 * valid timestamps and (when supplied) a non-expired freshness bound. An
 * invalid higher-level observation never downgrades a valid conversation proof
 * and is retained in `checks` for audit output.
 */
export function evaluateActionProof(
  expected: ActionExpectation,
  observations: readonly ProofObservation[],
  options: ProofEvaluationOptions = {},
): ActionProof {
  const now = options.now ?? new Date();
  const checks = observations.map((observation) => validateObservation(expected.fields, observation, now));
  const valid = checks.filter((check) => check.verified);
  let level: ProofLevel = "claimed";
  for (const candidate of PROOF_LEVELS.slice(1)) {
    if (valid.some((check) => check.level === candidate)) level = candidate;
  }
  const selected = valid.filter((check) => check.level === level);
  return {
    action: expected.action,
    expected: { ...expected.fields },
    level,
    verified: level !== "claimed",
    checkedAt: now.toISOString(),
    checks,
    evidenceIds: selected.map((check) => check.observationId),
  };
}
