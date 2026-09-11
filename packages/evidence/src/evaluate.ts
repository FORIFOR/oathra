import { checkConstraints, requiredFields, type CallContract } from "@oathra/contract";
import type { EvidenceEngine } from "./engine.js";
import type { ConnectionState, ResultStatus, VerifiedResult } from "./types.js";

/**
 * Deterministic completion check. We never ask the LLM "did it succeed?".
 *
 * Success =
 *   Connected(completed)
 * ∧ every required field has verified evidence
 * ∧ constraints satisfied on verified values
 */
export function evaluate(
  contract: CallContract,
  engine: EvidenceEngine,
  connection: ConnectionState,
): VerifiedResult {
  const values = engine.values();
  const required = requiredFields(contract);
  const missing = required.filter((f) => values[f] === undefined);
  const constraints = checkConstraints(contract.constraints, values);
  const evidence = engine.all();
  const graph = engine.graph();

  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) fields[k] = v;

  let status: ResultStatus;
  if (connection === "failed") status = "failed";
  else if (!constraints.satisfied) status = "constraint_violation";
  else if (missing.length > 0 || connection !== "completed") status = "incomplete";
  else status = "completed";

  const complete = status === "completed";

  // Confidence: mean of (asr * semantic) over the latest verified evidence per required field.
  const confs: number[] = [];
  for (const f of required) {
    const ev = engine.latestVerified(f);
    if (!ev) continue;
    const asr = ev.confidence.secondaryAsr !== undefined
      ? Math.min(ev.confidence.primaryAsr, ev.confidence.secondaryAsr)
      : ev.confidence.primaryAsr;
    confs.push(asr * ev.confidence.semantic);
  }
  const confidence = confs.length === 0 ? 0 : Number((confs.reduce((a, b) => a + b, 0) / confs.length).toFixed(3));

  return { status, complete, fields, missing, constraints, confidence, evidence, graph };
}

/** Shorthand mirroring the spec's isComplete(state). */
export function isComplete(contract: CallContract, engine: EvidenceEngine, connection: ConnectionState): boolean {
  return evaluate(contract, engine, connection).complete;
}
