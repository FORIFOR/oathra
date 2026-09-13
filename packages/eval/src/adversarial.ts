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
 *   tentative-hold     confirmations become 仮押さえ / 一応 / 後で確認します (a hold is not a booking)
 *   echo-question      the confirmation is restated as a question ("…でよろしいでしょうか？")
 *   confirm-then-change  a real confirmation, then in the same breath a correction that changes one term
 *   cancel-after-confirm a real confirmation, then in the same breath "やはりお取りできませんでした"
 *   hold-then-reply    "少々お待ちください" is inserted before real replies (never a value)
 *   voicemail          an answering machine picks up; nothing said afterwards is a person
 *   transfer           "担当に代わります" — a second voice takes over and asks for the request again
 *   ask-back           the callee asks to repeat twice before answering
 *   dialect-confirm    the confirmation is spoken in Kansai dialect, past tense ("…で取っといたで")
 */
import { CONFIRMATION_RE, parseDates, parsePartySize, parsePrices, parseSerials, parseTimes } from "@oathra/evidence";
import type { BrainProvider } from "@oathra/core";
import type { Scenario } from "@oathra/scenario";
import { createCharacter, enTime, jaDate, jaPrice, jaTime, mulberry32, spellSerial, type CalleeCharacter, type CalleeContext, type CalleeReply } from "@oathra/simulator";
import { runScenario, type ScenarioRun } from "./index.js";

export const MUTATIONS = [
  "never-confirm", "wrong-restate", "negate-then-offer", "silent-hangup", "caller-echo-trap",
  "tentative-hold", "echo-question", "confirm-then-change", "cancel-after-confirm", "hold-then-reply",
  "voicemail", "transfer", "ask-back", "dialect-confirm",
] as const;
/** Mutations under which the call can legitimately complete (the callee does commit in the end). */
export const COMPLETABLE: readonly Mutation[] = ["negate-then-offer", "hold-then-reply", "transfer", "ask-back", "dialect-confirm"];
export type Mutation = (typeof MUTATIONS)[number];

const HEDGES = ["確認してみますね。おそらく大丈夫だと思います。", "たぶんお取りできると思います。", "少々確認いたします。恐らく問題ないかと。"];
/** A hold is not a booking: 仮押さえ / 一応 / 後で確認します. */
const TENTATIVE = [
  "一応お席は押さえておきますが、確定ではございません。",
  "仮押さえという形でよろしいでしょうか。正式なご予約は後ほど改めて確認いたします。",
  "後ほど確認してご連絡いたします。今の時点では確定ではありません。",
  "一応承っておきますが、当日の状況次第でございます。",
];
const HOLD = ["少々お待ちくださいませ。", "確認いたしますので、そのままお待ちください。"];
const VOICEMAIL_GREETING = "ただいま電話に出ることができません。ご用件は発信音の後にお話しください。ピーッ。";
const TRANSFER = "担当の者に代わりますので、少々お待ちください。……お電話代わりました、山田でございます。恐れ入りますが、ご用件をもう一度お願いできますでしょうか。";
const TRANSFER_EN = "Let me transfer you to the person in charge, one moment. … Hello, this is Yamada. Sorry, could you tell me again what you need?";
const ASK_BACK = ["申し訳ございません、お電話が遠いようで、もう一度お願いできますでしょうか。", "失礼いたしました、何名様でしたでしょうか。もう一度お願いいたします。"];
const ASK_BACK_EN = ["Sorry, the line is bad. Could you say that again?", "Sorry, how many people was that? Could you repeat it?"];
const CANCEL = "申し訳ございません、確認しましたところ、やはりそのお時間はお取りできませんでした。ご予約はお受けできません。";
const CANCEL_EN = "Sorry, I've just checked and we can't take that reservation after all.";
const isEnglish = (text: string) => !/[぀-ヿ一-鿿]/.test(text);

/** Hard cap on callee turns so a mutation that never settles still terminates quickly. */
const MAX_CALLEE_TURNS = 10;

export class AdversarialCharacter implements CalleeCharacter {
  readonly name: string;
  private turns = 0;
  private committed: Record<string, unknown> = {};
  private mutatedConfirm = false;
  private holds = 0;

  constructor(
    private readonly base: CalleeCharacter,
    readonly mutation: Mutation,
    private readonly rng: () => number,
  ) {
    this.name = base.name;
  }

  greeting(): string | undefined {
    return this.mutation === "voicemail" ? VOICEMAIL_GREETING : this.base.greeting();
  }

  async respond(ctx: CalleeContext): Promise<CalleeReply> {
    this.turns++;
    const reply = await this.base.respond(ctx);
    if (this.turns > MAX_CALLEE_TURNS && !reply.hangup) {
      return { text: "申し訳ございません、またのお電話をお待ちしております。", hangup: true };
    }
    const isConfirm = CONFIRMATION_RE.test(reply.text) || /合っております/.test(reply.text);

    switch (this.mutation) {
      case "tentative-hold":
        if (isConfirm) {
          this.mutatedConfirm = true;
          return { text: TENTATIVE[Math.floor(this.rng() * TENTATIVE.length)]! };
        }
        return reply;

      case "echo-question":
        if (isConfirm) {
          this.mutatedConfirm = true;
          // "…でご予約承りました。" -> "…でご予約ということでよろしいでしょうか？", "…で合っております" -> "…で合っておりますでしょうか？"
          const q = reply.text.replace(/合っております/g, "合っておりますでしょうか").replace(CONFIRMATION_RE, "ということでよろしいでしょうか").replace(/[。．.]?\s*$/, "？");
          return { text: /[?？]/.test(q) ? q : `${q}？` };
        }
        return reply;

      case "confirm-then-change": {
        // A genuine confirmation followed, in the same breath, by a correction of one term.
        if (!isConfirm) return reply;
        const changed = this.restateWrong(reply);
        if (changed.text === reply.text) { this.committed = {}; this.mutatedConfirm = false; return reply; }
        return { ...reply, text: `${reply.text} ……失礼いたしました、訂正がございます。${changed.text}` };
      }

      case "cancel-after-confirm":
        // A genuine confirmation, then a retraction before the caller can hang up.
        if (!isConfirm) return reply;
        this.mutatedConfirm = true;
        return { ...reply, text: `${reply.text} ……${isEnglish(reply.text) ? CANCEL_EN : CANCEL}` };

      case "voicemail":
        // an answering machine: a beep, then the recording time runs out
        this.mutatedConfirm = true;
        return this.turns >= 2 ? { text: "ピーッ。", hangup: true } : { text: "ピーッ。" };

      case "transfer":
        if (this.turns === 2 && !isConfirm && !reply.hangup) return { text: ctx.language === "en" ? TRANSFER_EN : TRANSFER };
        return reply;

      case "ask-back":
        if (!isConfirm && !reply.hangup && this.holds < 2) {
          return { text: (ctx.language === "en" ? ASK_BACK_EN : ASK_BACK)[this.holds++]! };
        }
        return reply;

      case "dialect-confirm":
        if (isConfirm && !/\b(?:am|pm)\b/i.test(reply.text)) {
          // 「…でご予約承りました。」 -> 「…で取っといたで。」 (past tense: the booking is made)
          const t = reply.text.replace(CONFIRMATION_RE, "取っといたで").replace(/合っております/g, "合うてるで");
          return { ...reply, text: t };
        }
        return reply;

      case "hold-then-reply":
        if (!isConfirm && !reply.hangup && this.holds < 2 && this.rng() < 0.5) {
          this.holds++;
          return { text: ctx.language === "en" ? "One moment please, let me check." : HOLD[Math.floor(this.rng() * HOLD.length)]! };
        }
        return reply;

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
      const fmt = /\b(?:am|pm)\b/i.test(text) ? enTime : jaTime; // English callee text keeps English times
      for (const m of parseTimes(text)) if (m.value === t.value) text = text.split(m.span).join(fmt(nv));
      this.committed.time = nv;
      this.mutatedConfirm = true;
      return { ...reply, text };
    }
    const d = parseDates(text, new Date())[0];
    if (d) {
      const next = new Date(`${d.value}T12:00:00+09:00`);
      next.setDate(next.getDate() + 1);
      const nv = next.toISOString().slice(0, 10);
      for (const m of parseDates(text, new Date())) if (m.value === d.value) text = text.split(m.span).join(jaDate(nv));
      this.committed.date = nv;
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
      case "tentative-hold":
      case "echo-question":
        return { confirmed: false, matched: false };
      case "wrong-restate":
        return { ...base, ...this.committed };
      case "confirm-then-change":
        return { ...base, ...this.committed };
      case "cancel-after-confirm":
        return this.mutatedConfirm ? { ...base, confirmed: false, matched: false } : base;
      case "voicemail":
        return { confirmed: false, matched: false };
      case "negate-then-offer":
      case "hold-then-reply":
      case "transfer":
      case "ask-back":
      case "dialect-confirm":
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
