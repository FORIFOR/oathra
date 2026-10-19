/**
 * Many local conversations against scripted characters: which runs to make (mutation × line condition × repeat),
 * what each one should have ended as, and the totals. Pure; `phone test --level conversation --scenario` runs it.
 */
import { checkConstraints, type CallContract } from "@oathra/contract";
import { MUTATIONS, type Mutation } from "@oathra/eval";
import type { LocalConversationReport } from "./local-conversation.js";

export type BatchMutation = Mutation | "none";
export type PlannedRun = { mutation: BatchMutation; condition: string; seed: number };

/** Repeats outermost, so a run stopped at the budget still covers every mutation and condition evenly. */
export function planRuns(opts: { mutations: string[]; conditions: string[]; runs: number; seed: number }): PlannedRun[] {
  if (!Number.isInteger(opts.runs) || opts.runs < 1 || opts.runs > 100) throw new Error("--runs must be an integer from 1 to 100");
  for (const m of opts.mutations) {
    if (m !== "none" && !(MUTATIONS as readonly string[]).includes(m)) throw new Error(`Unknown mutation "${m}". Use none or one of: ${MUTATIONS.join(", ")}`);
  }
  if (!opts.mutations.length || !opts.conditions.length) throw new Error("need at least one mutation and one condition");
  const plan: PlannedRun[] = [];
  for (let r = 0; r < opts.runs; r++)
    for (const mutation of opts.mutations as BatchMutation[])
      for (const condition of opts.conditions) plan.push({ mutation, condition, seed: opts.seed + plan.length });
  return plan;
}

/** The callee committed (or the serial matched) to terms inside the contract's constraints. */
export function expectedComplete(contract: CallContract, truth: Record<string, unknown> | null): boolean {
  if (!truth || (truth.confirmed !== true && truth.matched !== true)) return false;
  return checkConstraints(contract.constraints, truth).violations.length === 0;
}

export type BatchRun = PlannedRun & {
  index: number;
  dir: string;
  status: string | null;
  complete: boolean;
  expectedComplete: boolean;
  asExpected: boolean;
  falseCompletion: boolean;
  disagreements: string[];
  error: string | null;
  endReason: string | null;
  stoppedForBudget: boolean;
  replyAudioAfterMs: number[];
  estimatedUsd: number;
};

export function toBatchRun(planned: PlannedRun, index: number, dir: string, contract: CallContract, report: LocalConversationReport): BatchRun {
  const complete = report.verdict?.complete ?? false;
  const expected = expectedComplete(contract, report.truth);
  return {
    ...planned, index, dir,
    status: report.verdict?.status ?? null, complete, expectedComplete: expected,
    asExpected: report.error === null && !report.stoppedForBudget && complete === expected,
    falseCompletion: report.falseCompletion, disagreements: report.disagreements,
    error: report.error, endReason: report.endReason, stoppedForBudget: report.stoppedForBudget,
    replyAudioAfterMs: report.replies.flatMap((r) => (r.replyAudioAfterMs === null ? [] : [r.replyAudioAfterMs])),
    estimatedUsd: report.usage.estimatedUsd,
  };
}

/** Nearest-rank percentile; null for no samples. */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
}

type Group = { runs: number; completed: number; asExpected: number; falseCompletions: number };

export type BatchSummary = Group & {
  asExpectedRate: number | null;
  /** The run threw, or the call ended in `error`. */
  runtimeErrors: number;
  stoppedForBudget: number;
  /** Callee stops speaking → first audible agent reply, over every reply in every run. */
  replyAudioAfterMs: { n: number; p50: number | null; p95: number | null };
  estimatedUsd: number;
  byMutation: Record<string, Group>;
  byCondition: Record<string, Group>;
};

export function summarizeRuns(runs: BatchRun[]): BatchSummary {
  const group = (rs: BatchRun[]): Group => ({ runs: rs.length, completed: rs.filter((r) => r.complete).length, asExpected: rs.filter((r) => r.asExpected).length, falseCompletions: rs.filter((r) => r.falseCompletion).length });
  const by = (key: (r: BatchRun) => string) => {
    const out: Record<string, Group> = {};
    for (const k of new Set(runs.map(key))) out[k] = group(runs.filter((r) => key(r) === k));
    return out;
  };
  const latency = runs.flatMap((r) => r.replyAudioAfterMs);
  const all = group(runs);
  return {
    ...all,
    asExpectedRate: runs.length ? +(all.asExpected / runs.length).toFixed(3) : null,
    runtimeErrors: runs.filter((r) => r.error !== null || r.endReason === "error").length,
    stoppedForBudget: runs.filter((r) => r.stoppedForBudget).length,
    replyAudioAfterMs: { n: latency.length, p50: percentile(latency, 50), p95: percentile(latency, 95) },
    estimatedUsd: +runs.reduce((s, r) => s + r.estimatedUsd, 0).toFixed(4),
    byMutation: by((r) => r.mutation),
    byCondition: by((r) => r.condition),
  };
}
