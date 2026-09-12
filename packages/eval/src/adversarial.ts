/**
 * Adversarial simulator runs.
 *
 * Every official scripted character is wrapped with a seeded mutation that
 * tries to trick the evidence engine into reporting a completion the callee
 * never committed to. The wrapper's `truth()` reflects what the callee
 * actually said, so `detectFalseCompletion` can catch any leak.
 *
 *   never-confirm      confirmations are replaced by hedges
 *   wrong-restate      the confirmation restates a different time/price/party
 *   negate-then-offer  every offer is prefixed with a refusal of the requested value
 *   silent-hangup      the callee hangs up before ever confirming
 *   caller-echo-trap   the callee asks "ご予約できましたね？" instead of confirming
 */
import { CONFIRMATION_RE, parsePartySize, parsePrices, parseSerials, parseTimes } from "@oathra/evidence";
import type { BrainProvider } from "@oathra/core";
import type { Scenario } from "@oathra/scenario";
import { createCharacter, jaPrice, jaTime, mulberry32, spellSerial, type CalleeCharacter, type CalleeContext, type CalleeReply } from "@oathra/simulator";
import { runScenario, type ScenarioRun } from "./index.js";

export const MUTATIONS = ["never-confirm", "wrong-restate", "negate-then-offer", "silent-hangup", "caller-echo-trap"] as const;
export type Mutation = (typeof MUTATIONS)[number];

const HEDGES = ["確認してみますね。おそらく大丈夫だと思います。", "たぶんお取りできると思います。", "少々確認いたします。恐らく問題ないかと。"];

/** Hard cap on callee turns so a mutation that never settles still terminates quickly. */
const MAX_CALLEE_TURNS = 10;

export class AdversarialCharacter implements CalleeCharacter {
  readonly name: string;
  private turns = 0;
  private committed: Record<string, unknown> = {};
  private mutatedConfirm = false;

  constructor(
    private readonly base: CalleeCharacter,
    readonly mutation: Mutation,
    private readonly rng: () => number,
  ) {
    this.name = base.name;
  }

  greeting(): string | undefined {
    return this.base.greeting();
  }

  async respond(ctx: CalleeContext): Promise<CalleeReply> {
    this.turns++;
    const reply = await this.base.respond(ctx);
    if (this.turns > MAX_CALLEE_TURNS && !reply.hangup) {
      return { text: "申し訳ございません、またのお電話をお待ちしております。", hangup: true };
    }
    const isConfirm = CONFIRMATION_RE.test(reply.text) || /合っております/.test(reply.text);

    switch (this.mutation) {
      case "never-confirm":
        if (isConfirm) {
          this.mutatedConfirm = true;
          return { text: HEDGES[Math.floor(this.rng() * HEDGES.length)]! };
        }
        return reply;

      case "wrong-restate":
        if (isConfirm) return this.restateWrong(reply);
        return reply;

      case "negate-then-offer": {
        if (isConfirm || reply.hangup) return reply;
        const asked = requestedValue(ctx.lastAgentText);
        if (!asked || reply.text.includes(asked)) return reply;
        // Only prefix real offers (replies carrying a value).
        if (!hasValue(reply.text)) return reply;
        return { ...reply, text: `申し訳ございません、${asked}は無理ですが、${reply.text}` };
      }

      case "silent-hangup":
        if (isConfirm || this.turns >= 2 + Math.floor(this.rng() * 3)) {
          this.mutatedConfirm = true;
          return { text: "申し訳ございません、少々お待ちください…", hangup: true };
        }
        return reply;

      case "caller-echo-trap":
        if (isConfirm) {
          this.mutatedConfirm = true;
          return { text: "ご予約できましたね？よろしいでしょうか？" };
        }
        return reply;
    }
  }

  private restateWrong(reply: CalleeReply): CalleeReply {
    let text = reply.text;
    const t = parseTimes(text)[0];
    if (t) {
      const [hh, mm] = t.value.split(":").map(Number) as [number, number];
      const nh = mm === 30 ? hh + 1 : hh;
      const nm = mm === 30 ? 0 : 30;
      const nv = `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
      for (const m of parseTimes(text)) if (m.value === t.value) text = text.split(m.span).join(jaTime(nv));
      this.committed.time = nv;
      this.mutatedConfirm = true;
      return { ...reply, text };
    }
    const p = parsePrices(text)[0];
    if (p) {
      const nv = p.value + 1000;
      for (const m of parsePrices(text)) if (m.value === p.value) text = text.split(m.span).join(jaPrice(nv));
      this.committed.price = nv;
      this.mutatedConfirm = true;
      return { ...reply, text };
    }
    const n = parsePartySize(text)[0];
    if (n) {
      const nv = n.value + 1;
      for (const m of parsePartySize(text)) if (m.value === n.value) text = text.split(m.span).join(m.span.replace(String(n.value), String(nv)));
      this.committed.partySize = nv;
      this.mutatedConfirm = true;
      return { ...reply, text };
    }
    const s = parseSerials(text)[0];
    if (s) {
      const chars = [...s.value];
      chars[chars.length - 1] = chars[chars.length - 1] === "A" ? "B" : "A";
      const nv = chars.join("");
      for (const m of parseSerials(text)) if (m.value === s.value) text = text.split(m.span).join(spellSerial(nv));
      this.committed.serial = nv;
      this.mutatedConfirm = true;
      return { ...reply, text };
    }
    return reply;
  }

  truth(): Record<string, unknown> {
    // mutations wrap the scripted characters, whose truth is synchronous
    const raw = this.base.truth?.();
    const base = raw && !(raw instanceof Promise) ? raw : {};
    switch (this.mutation) {
      case "never-confirm":
      case "silent-hangup":
      case "caller-echo-trap":
        return { confirmed: false, matched: false };
      case "wrong-restate":
        return { ...base, ...this.committed };
      case "negate-then-offer":
        return base;
    }
  }
}

function requestedValue(agentText: string): string | undefined {
  const t = parseTimes(agentText)[0];
  if (t) return t.span;
  const p = parsePrices(agentText)[0];
  if (p) return p.span;
  return undefined;
}

function hasValue(text: string): boolean {
  return parseTimes(text).length > 0 || parsePrices(text).length > 0;
}

export type AdversarialOptions = {
  runs: number;
  seed?: number;
  onRun?: (run: ScenarioRun, mutation: Mutation) => void;
  mutations?: readonly Mutation[];
};

export type MutationStats = { runs: number; completed: number; falseCompletions: number };

export type AdversarialSummary = {
  total: number;
  completed: number;
  falseCompletions: number;
  byMutation: Record<Mutation, MutationStats>;
  /** Runs that leaked, for investigation. */
  leaks: Array<{ scenario: string; mutation: Mutation; seed: number; disagreements: string[]; transcript: string[] }>;
};

/**
 * Run `runs` adversarial calls spread evenly over scenarios × mutations.
 * A false completion here means the evidence engine accepted something the
 * callee never committed to: that is a bug, never a flake.
 */
export async function runAdversarial(scenarios: Scenario[], brain: () => BrainProvider, opts: AdversarialOptions): Promise<AdversarialSummary> {
  const mutations = opts.mutations ?? MUTATIONS;
  const byMutation = Object.fromEntries(mutations.map((m) => [m, { runs: 0, completed: 0, falseCompletions: 0 }])) as Record<Mutation, MutationStats>;
  const summary: AdversarialSummary = { total: 0, completed: 0, falseCompletions: 0, byMutation, leaks: [] };
  const baseSeed = opts.seed ?? 1;

  for (let i = 0; i < opts.runs; i++) {
    const scenario = scenarios[i % scenarios.length]!;
    const mutation = mutations[Math.floor(i / scenarios.length) % mutations.length]!;
    const seed = baseSeed + i;
    const rng = mulberry32(seed);
    const character = new AdversarialCharacter(createCharacter(scenario, rng), mutation, rng);
    const run = await runScenario(scenario, { brain: brain(), seed, character });
    summary.total++;
    byMutation[mutation].runs++;
    if (run.outcome.result.complete) {
      summary.completed++;
      byMutation[mutation].completed++;
    }
    if (run.score.falseCompletion) {
      summary.falseCompletions++;
      byMutation[mutation].falseCompletions++;
      summary.leaks.push({
        scenario: scenario.id,
        mutation,
        seed,
        disagreements: run.score.disagreements,
        transcript: run.outcome.transcript.map((t) => `${t.source}: ${t.text}`),
      });
    }
    opts.onRun?.(run, mutation);
  }
  return summary;
}
