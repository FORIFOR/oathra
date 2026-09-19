export * from "./types.js";
export * from "./proof.js";
export * from "./normalize.js";
export {
  extractClaims,
  splitClauses,
  isAcceptance,
  isAgreement,
  isConfirmRequest,
  isAffirmativeAnswer,
  isCalleeCommitment,
  CALLEE_COMMIT_RE,
  AFFIRMATIVE_RE,
  CONFIRM_REQUEST_RE,
  REFUSAL_RE,
  CONFIRMATION_RE,
  HEDGE_RE,
  AGREEMENT_RE,
  ACCEPTANCE_RE,
  DECLINE_RE,
  type Claim,
  type Clause,
  type Polarity,
} from "./extract.js";
export { EvidenceEngine, type ConfirmationMode, type EngineOptions, type IngestResult } from "./engine.js";
export { evaluate, isComplete } from "./evaluate.js";
