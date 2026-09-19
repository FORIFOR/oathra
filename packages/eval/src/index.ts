/**
 * Eval — five axes, one honest number, and False Completion as a first-class metric.
 *
 *   Outcome       did the contract complete (and was it real)?
 *   Evidence      how confident is the verified evidence?
 *   Conversation  how efficiently did the agent get there?
 *   Latency       TTFA against the 650ms / 1000ms budget
 *   Efficiency    cost
 */
import { checkConstraints } from "@oathra/contract";
import type { BrainProvider } from "@oathra/core";
import { DEFAULT_LATENCY_TARGETS, recordingNotice } from "@oathra/core";
import { runCall, type CallOutcome } from "@oathra/runtime";
import { contractFromScenario, type Scenario } from "@oathra/scenario";
import { SimulatorTransport, type CalleeCharacter } from "@oathra/simulator";

export type AxisScores = {
  outcome: number;
  evidence: number;
  conversation: number;
  latency: number;
  efficiency: number;
};

export type OathraScore = AxisScores & {
  overall: number;
  /** Scenario-defined points (success + price_saved etc.). */
  points: number;
  falseCompletion: boolean;
  /** Reported complete but ground truth disagrees on these fields. */
  disagreements: string[];
};

export type ScenarioRun = {
  scenario: Scenario;
  brain: string;
  outcome: CallOutcome;
  truth: Record<string, unknown> | undefined;
  score: OathraScore;
};

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

/**
 * A false completion is the worst failure Oathra can produce: the runtime
 * says "completed" but the callee never actually committed to what we report.
 */
export function detectFalseCompletion(outcome: CallOutcome, truth: Record<string, unknown> | undefined): { falseCompletion: boolean; disagreements: string[] } {
  if (!outcome.result.complete || !truth) return { falseCompletion: false, disagreements: [] };
  const disagreements: string[] = [];
  for (const [field, expected] of Object.entries(truth)) {
    if (expected === undefined || field === "name" || field === "matched" || field === "quantity") continue;
    const actual = outcome.result.fields[field];
    if (actual === undefined) continue; // not claimed, not a lie
    if (actual !== expected) disagreements.push(field);
  }
  if (truth.confirmed === false && outcome.result.fields.confirmed === true) disagreements.push("confirmed");
  if (truth.matched === false && outcome.result.fields.serial !== undefined) disagreements.push("serial");
  return { falseCompletion: disagreements.length > 0, disagreements: [...new Set(disagreements)] };
}

export function scoreRun(scenario: Scenario, outcome: CallOutcome, truth: Record<string, unknown> | undefined): OathraScore {
  const { falseCompletion, disagreements } = detectFalseCompletion(outcome, truth);
  const r = outcome.result;
  const win = checkConstraints(
    Object.fromEntries(
      Object.entries(scenario.win).map(([k, v]) => [k, typeof v === "object" && v !== null ? v : { eq: v }]),
    ),
    r.fields,
  );
  const won = r.complete && win.satisfied && win.unknown.length === 0 && !falseCompletion;

  const outcomeScore = falseCompletion ? 0 : won ? 100 : r.complete ? 60 : 0;
  const evidenceScore = clamp(Math.round(r.confidence * 100));
  const turns = outcome.metrics.turns;
  const conversation = clamp(Math.round(100 - Math.max(0, turns - 6) * 5));
  const p50 = outcome.metrics.latency.ttfaP50Ms;
  const latency = p50 === undefined ? 0 : clamp(Math.round(100 - Math.max(0, p50 - DEFAULT_LATENCY_TARGETS.ttfaP50Ms) / 10));
  const efficiency = clamp(Math.round(100 - outcome.metrics.costUsd * 1000));

  const overall = Number((outcomeScore * 0.5 + evidenceScore * 0.2 + conversation * 0.1 + latency * 0.1 + efficiency * 0.1).toFixed(1));

  let points = won ? scenario.score.success : 0;
  const standard = scenario.callee.knowledge.standard_price ?? scenario.callee.knowledge.list_price;
  const price = r.fields.price;
  if (won && typeof standard === "number" && typeof price === "number" && scenario.score.price_saved > 0) {
    points += Math.round((standard - price) * scenario.score.price_saved);
  }
  if (won && p50 !== undefined) points += Math.round(Math.max(0, 1000 - p50) * scenario.score.latency);
  if (won) points += Math.round(Math.max(0, 20 - turns) * 10 * scenario.score.turns);
  if (falseCompletion) points = -scenario.score.success;

  return { outcome: outcomeScore, evidence: evidenceScore, conversation, latency, efficiency, overall, points, falseCompletion, disagreements };
}

export type RunScenarioOptions = {
  brain: BrainProvider;
  seed?: number;
  now?: Date;
  character?: CalleeCharacter;
  onEvent?: Parameters<typeof runCall>[0]["onEvent"];
  pace?: "fast" | "realtime";
  callId?: string;
  /** How long the agent waits for the callee to speak first before opening. */
  openingTimeoutMs?: number;
};

export async function runScenario(scenario: Scenario, opts: RunScenarioOptions): Promise<ScenarioRun> {
  const contract = contractFromScenario(scenario);
  const transport = new SimulatorTransport({
    scenario,
    pace: opts.pace ?? "fast",
    ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
    ...(opts.character ? { character: opts.character } : {}),
  });
  const knowledgeNow = scenario.callee.knowledge.now;
  const now = opts.now ?? (typeof knowledgeNow === "string" ? new Date(knowledgeNow) : new Date());
  const outcome = await runCall({
    contract,
    transport,
    brain: opts.brain,
    now,
    scenarioId: scenario.id,
    openingTimeoutMs: opts.openingTimeoutMs ?? (opts.pace === "realtime" ? 1500 : 50),
    // Every saved call is a recording; the simulator opens the way a recorded real call does.
    openingNotice: recordingNotice(contract.language),
    ...(opts.onEvent ? { onEvent: opts.onEvent } : {}),
    ...(opts.callId ? { callId: opts.callId } : {}),
  });
  const truth = await transport.lastCharacter?.truth?.();
  return { scenario, brain: opts.brain.name, outcome, truth, score: scoreRun(scenario, outcome, truth) };
}

export type EvalSummary = {
  runs: ScenarioRun[];
  total: number;
  completed: number;
  falseCompletions: number;
  meanOverall: number;
  ttfaP50Ms?: number;
};

export type BrainFactory = () => BrainProvider;

/**
 * Run every scenario `runs` times. `brain` must be a factory: brains may keep
 * per-call state (negotiation attempts, closing flags), so each run gets a
 * fresh instance.
 */
export type CharacterFactory = (scenario: Scenario) => CalleeCharacter;

export async function evalScenarios(scenarios: Scenario[], brain: BrainFactory, opts: { runs?: number; onRun?: (r: ScenarioRun) => void; character?: CharacterFactory } = {}): Promise<EvalSummary> {
  const runs: ScenarioRun[] = [];
  const n = opts.runs ?? 1;
  for (const s of scenarios) {
    for (let i = 0; i < n; i++) {
      const r = await runScenario(s, { brain: brain(), seed: s.seed + i, ...(opts.character ? { character: opts.character(s) } : {}) });
      runs.push(r);
      opts.onRun?.(r);
    }
  }
  const ttfa = runs.map((r) => r.outcome.metrics.latency.ttfaP50Ms).filter((v): v is number => v !== undefined);
  const summary: EvalSummary = {
    runs,
    total: runs.length,
    completed: runs.filter((r) => r.outcome.result.complete).length,
    falseCompletions: runs.filter((r) => r.score.falseCompletion).length,
    meanOverall: runs.length ? Number((runs.reduce((a, r) => a + r.score.overall, 0) / runs.length).toFixed(1)) : 0,
  };
  if (ttfa.length) summary.ttfaP50Ms = Math.round(ttfa.reduce((a, b) => a + b, 0) / ttfa.length);
  return summary;
}

export type BattleEntry = { brain: string; points: number; success: boolean; durationMs: number; costUsd: number; overall: number; falseCompletion: boolean; run: ScenarioRun };

export async function battle(scenario: Scenario, brains: BrainFactory[], opts: { seed?: number } = {}): Promise<BattleEntry[]> {
  const entries: BattleEntry[] = [];
  for (const factory of brains) {
    const brain = factory();
    const run = await runScenario(scenario, { brain, ...(opts.seed !== undefined ? { seed: opts.seed } : {}) });
    entries.push({
      brain: brain.name,
      points: run.score.points,
      success: run.score.outcome === 100,
      durationMs: run.outcome.metrics.durationMs,
      costUsd: run.outcome.metrics.costUsd,
      overall: run.score.overall,
      falseCompletion: run.score.falseCompletion,
      run,
    });
  }
  return entries.sort((a, b) => b.points - a.points);
}

/** Markdown leaderboard suitable for README / X posts. */
export function renderBattleMarkdown(scenario: Scenario, entries: BattleEntry[]): string {
  const medals = ["🥇", "🥈", "🥉"];
  const lines = [`**${scenario.title}** — Oathra Agent Battle`, "", "| | Agent | Points | Success | Time | Cost |", "|--|--|--:|:--:|--:|--:|"];
  entries.forEach((e, i) => {
    lines.push(`| ${medals[i] ?? ""} | ${e.brain} | ${e.points.toLocaleString()} | ${e.success ? "✓" : "✗"} | ${(e.durationMs / 1000).toFixed(0)}s | $${e.costUsd.toFixed(2)} |`);
  });
  lines.push("", `False completions: ${entries.filter((e) => e.falseCompletion).length}`);
  return lines.join("\n");
}

export { runAdversarial, AdversarialCharacter, MUTATIONS, COMPLETABLE, type Mutation, type AdversarialSummary, type AdversarialOptions, type MutationStats } from "./adversarial.js";

/**
 * Shareable leaderboard card as SVG (1200×630, the social-card size).
 * Pure string output: no browser needed. Convert to PNG with any renderer.
 */
export function renderBattleSvg(scenario: Scenario, entries: BattleEntry[]): string {
  const W = 1200;
  const H = 630;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const max = Math.max(1, ...entries.map((e) => Math.abs(e.points)));
  const rows = entries.slice(0, 6);
  const rowH = 58;
  const top = 200;
  const fc = entries.filter((e) => e.falseCompletion).length;
  const medals = ["1", "2", "3"];
  const bars = rows
    .map((e, i) => {
      const y = top + i * rowH;
      const w = Math.max(6, Math.round((Math.max(0, e.points) / max) * 430));
      const fill = e.falseCompletion ? "#c0392b" : i === 0 ? "#d98c1f" : "#8a8a8a";
      return [
        `<text x="80" y="${y + 30}" font-family="ui-monospace, Menlo, monospace" font-size="20" fill="#6b6b6b">${medals[i] ?? i + 1}</text>`,
        `<text x="120" y="${y + 30}" font-family="-apple-system, Inter, sans-serif" font-size="24" fill="#111">${esc(e.brain)}</text>`,
        `<rect x="420" y="${y + 10}" width="${w}" height="26" rx="3" fill="${fill}"/>`,
        `<text x="${960}" y="${y + 30}" text-anchor="end" font-family="ui-monospace, Menlo, monospace" font-size="24" fill="#111">${e.points.toLocaleString()}</text>`,
        `<text x="1000" y="${y + 30}" font-family="ui-monospace, Menlo, monospace" font-size="20" fill="${e.success ? "#2e7d32" : "#9a9a9a"}">${e.success ? "✓" : "✗"}</text>`,
        `<text x="1040" y="${y + 30}" font-family="ui-monospace, Menlo, monospace" font-size="18" fill="#6b6b6b">${(e.durationMs / 1000).toFixed(0)}s · $${e.costUsd.toFixed(2)}</text>`,
      ].join("");
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="#f7f6f2"/>
<rect x="40" y="40" width="${W - 80}" height="${H - 80}" fill="#fffdf9" stroke="#d9d6cf"/>
<text x="80" y="110" font-family="-apple-system, Inter, sans-serif" font-size="40" font-weight="600" fill="#111">${esc(scenario.title)}</text>
<text x="80" y="150" font-family="ui-monospace, Menlo, monospace" font-size="18" fill="#6b6b6b">OATHRA AGENT BATTLE · ${esc(scenario.id)} · ${esc(scenario.difficulty)}</text>
<line x1="80" y1="172" x2="${W - 80}" y2="172" stroke="#d9d6cf"/>
${bars}
<line x1="80" y1="${H - 110}" x2="${W - 80}" y2="${H - 110}" stroke="#d9d6cf"/>
<text x="80" y="${H - 70}" font-family="ui-monospace, Menlo, monospace" font-size="22" fill="${fc === 0 ? "#2e7d32" : "#c0392b"}">False completions: ${fc}</text>
<text x="${W - 80}" y="${H - 70}" text-anchor="end" font-family="ui-monospace, Menlo, monospace" font-size="18" fill="#6b6b6b">npx oathra battle ${esc(scenario.id)}</text>
</svg>
`;
}
