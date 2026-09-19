/**
 * Adversarial fuzz for appointment-style calls (`confirmation: "callee_acceptance"`).
 *
 * 10,000 seeded sales dialogues. Each one is generated together with its ground truth — the slot
 * the callee really committed to, or none — so a false completion is detectable:
 *   the engine says complete, but the callee never committed, or committed to a different slot.
 * Every case is reproducible from its seed.
 */
import { describe, expect, it } from "vitest";
import { defineCall } from "@oathra/contract";
import { EvidenceEngine } from "./engine.js";
import { evaluate } from "./evaluate.js";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOW = new Date(2026, 8, 19, 10);
const CONTRACT = defineCall({ goal: "sales.meeting", language: "ja", require: { date: true, time: true, confirmed: true }, confirmation: "callee_acceptance" });

type Rng = () => number;
type Line = ["caller" | "callee", string];
type Slot = { date: string; time: string; ja: string };
type Dialogue = { kind: string; lines: Line[]; truth: Slot | null };

const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;
const int = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
const pad = (n: number) => String(n).padStart(2, "0");

function slot(rng: Rng, not?: Slot): Slot {
  for (;;) {
    const month = int(rng, 10, 12), day = int(rng, 1, 28), hour = int(rng, 9, 18), half = rng() < 0.3;
    const s: Slot = { date: `2026-${pad(month)}-${pad(day)}`, time: `${pad(hour)}:${half ? "30" : "00"}`, ja: `${month}月${day}日の${hour}時${half ? "半" : ""}` };
    if (!not || s.date !== not.date || s.time !== not.time) return s;
  }
}

const OPENERS = ["お世話になっております。AIアシスタントの者です。新しい受付サービスのご案内でお電話しました。", "突然のお電話失礼いたします。株式会社サンプルのAIアシスタントです。"];
const GREETINGS = ["はい、田中です。", "お電話ありがとうございます。", "はい。", "もしもし。"];
const PROPOSE = [(s: Slot) => `${s.ja}から15分、商談のお時間をいただけますか。`, (s: Slot) => `商談は${s.ja}でよろしいでしょうか？`, (s: Slot) => `もしよろしければ、${s.ja}にオンラインでご説明の機会をいただけないでしょうか。`];
const COMMIT = [(s: Slot) => `はい、${s.ja}でお願いします。`, (s: Slot) => `${s.ja}で大丈夫です。`, (s: Slot) => `承知しました。${s.ja}にお待ちしております。`, () => "かしこまりました。", () => "はい、それで結構です。", (s: Slot) => `はい、${s.ja}で問題ありません。`];
const HEDGES = ["たぶん大丈夫だと思います。", "まだ確定ではありませんが、おそらく。", "仮押さえでお願いします。", "来週なら大丈夫かもしれません。", "承知しました、上司に聞いてから折り返します。", "社内で相談してからお返事します。", "一度持ち帰らせてください。", "検討します。", "まずメールで詳細を送ってもらえますか。それから判断します。", "まあ大丈夫ですやろけど、約束はできまへんで。"];
const CONFLICTS = [(s: Slot) => `ご用件は承知しました。ただ${s.ja}は別の会議が入っています。`, (s: Slot) => `${s.ja}は先約があります。`, () => "その日は出張です。", () => "その時間は予定が入っております。", (s: Slot) => `${s.ja}は無理です。`, () => "あいにく都合がつきません。"];
const QUESTIONS = [(s: Slot) => `${s.ja}ですか？`, () => "どのくらいお時間がかかりますでしょうか？", () => "オンラインでしょうか？", (s: Slot) => `${s.ja}でよろしいでしょうか？`];
const REFUSALS = ["いえ、結構です。", "興味がありません。", "今後お電話は不要です。", "お断りします。"];
const AGREE_WORDS = ["承知しました", "かしこまりました", "大丈夫です", "はい、お願いします", "了解です"];
const SPOILERS = ["ただその日は別の会議が入っています", "上司に聞いてから折り返します", "検討します", "まだ確定ではありません", "約束はできません", "やはりキャンセルしてください", "その時間は先約があります"];
const FILLER: Line[] = [["callee", "少々お待ちください。"], ["caller", "はい、お待ちします。"], ["callee", "お待たせしました。"]];

function generate(seed: number): Dialogue {
  const rng = mulberry32(seed);
  const s = slot(rng);
  const lines: Line[] = [];
  if (rng() < 0.7) lines.push(["callee", pick(rng, GREETINGS)]);
  lines.push(["caller", pick(rng, OPENERS)]);
  if (rng() < 0.4) lines.push(["callee", pick(rng, ["はい。", "ええ。", "はあ。"])]);
  if (rng() < 0.15) lines.push(...FILLER);
  lines.push(["caller", pick(rng, PROPOSE)(s)]);
  const commit = () => pick(rng, COMMIT)(s);

  const kinds = ["accept", "accept-then-thanks", "hedge", "conflict", "question", "refusal", "counter-accepted", "counter-ignored", "accept-then-cancel", "accept-then-change", "yes-then-conflict", "agree-plus-spoiler", "spoiler-plus-agree", "materials-only", "stale-yes", "caller-only", "hedge-then-accept", "counter-reconfirmed"] as const;
  const kind = pick(rng, kinds);
  let truth: Slot | null = null;
  switch (kind) {
    case "accept":
      lines.push(["callee", commit()]);
      truth = s;
      break;
    case "accept-then-thanks":
      lines.push(["callee", commit()], ["caller", `ありがとうございます。${s.ja}でお願いいたします。`], ["callee", "はい、よろしくお願いします。"]);
      truth = s;
      break;
    case "hedge":
      lines.push(["callee", pick(rng, HEDGES)]);
      break;
    case "conflict":
      lines.push(["callee", pick(rng, CONFLICTS)(s)]);
      break;
    case "question":
      lines.push(["callee", pick(rng, QUESTIONS)(s)]);
      break;
    case "refusal":
      lines.push(["callee", pick(rng, REFUSALS)]);
      break;
    case "counter-accepted": {
      const s2 = slot(rng, s);
      lines.push(["callee", `${pick(rng, CONFLICTS)(s)}${s2.ja}でお願いします。`], ["caller", `承知しました。${s2.ja}でお願いします。`]);
      truth = s2;
      break;
    }
    case "counter-reconfirmed": {
      // What a careful agent does with a counter-proposal: restate it and ask.
      const s2 = slot(rng, s);
      lines.push(["callee", `${pick(rng, CONFLICTS)(s)}${s2.ja}でお願いします。`], ["caller", `ありがとうございます。それでは${s2.ja}でよろしいでしょうか？`], ["callee", pick(rng, ["はい。", "はい、お願いします。", `はい、${s2.ja}でお願いします。`])]);
      truth = s2;
      break;
    }
    case "counter-ignored": {
      const s2 = slot(rng, s);
      lines.push(["callee", `${s2.ja}ならどうでしょうか？`], ["caller", "確認いたします。"]);
      break;
    }
    case "accept-then-cancel":
      lines.push(["callee", commit()], ["caller", "ありがとうございます。"], ["callee", pick(rng, ["すみません、やはりキャンセルしてください。", "やはりその日は無理です。", "あ、取り消してください。"])]);
      break;
    case "accept-then-change": {
      const s2 = slot(rng, s);
      lines.push(["callee", commit()], ["callee", `あ、やはり${s2.ja}にしてください。`]);
      break;
    }
    case "yes-then-conflict":
      lines.push(["callee", "はい。"], ["callee", pick(rng, ["あ、すみません、その日は出張でした。", "いえ、その時間は別の会議が入っています。", "ええと、上司に聞いてからでないと決められません。"])]);
      break;
    case "agree-plus-spoiler":
      lines.push(["callee", `${pick(rng, AGREE_WORDS)}。${pick(rng, SPOILERS)}。`]);
      break;
    case "spoiler-plus-agree":
      lines.push(["callee", `${pick(rng, SPOILERS)}。${pick(rng, AGREE_WORDS)}。`]);
      break;
    case "materials-only":
      lines.push(["callee", "資料を送ってください。日程はまだ決められません。"]);
      break;
    case "stale-yes":
      lines.push(["callee", "少々お待ちください。"], ["caller", "はい、お待ちします。"], ["callee", "はい。"]);
      break;
    case "caller-only":
      lines.push(["caller", `では${s.ja}で確定とさせていただきます。ありがとうございます。`]);
      break;
    case "hedge-then-accept":
      lines.push(["callee", pick(rng, HEDGES)], ["caller", pick(rng, PROPOSE)(s)], ["callee", commit()]);
      truth = s;
      break;
  }
  return { kind, lines, truth };
}

function judge(d: Dialogue) {
  const engine = new EvidenceEngine({ language: "ja", now: NOW, confirmation: "callee_acceptance" });
  d.lines.forEach(([source, text], i) => engine.ingest({ id: `u${i}`, source, text, t: (i + 1) * 1000 }));
  return evaluate(CONTRACT, engine, "completed");
}

describe("appointment adversarial fuzz", () => {
  it("10,000 seeded sales dialogues: no false completion", () => {
    const RUNS = 10_000;
    const falseCompletions: string[] = [];
    const byKind = new Map<string, { total: number; completed: number; expected: number }>();
    for (let seed = 1; seed <= RUNS; seed++) {
      const d = generate(seed);
      const r = judge(d);
      const k = byKind.get(d.kind) ?? { total: 0, completed: 0, expected: 0 };
      k.total++;
      if (d.truth) k.expected++;
      if (r.complete) k.completed++;
      byKind.set(d.kind, k);
      const wrong = r.complete && (!d.truth || r.fields.date !== d.truth.date || r.fields.time !== d.truth.time);
      if (wrong && falseCompletions.length < 5) falseCompletions.push(`seed ${seed} [${d.kind}] ${JSON.stringify(r.fields)} truth=${JSON.stringify(d.truth)}\n  ${d.lines.map((l) => l.join(": ")).join("\n  ")}`);
    }
    expect(falseCompletions, falseCompletions.join("\n\n")).toEqual([]);

    // Being safe must not mean refusing everything: clean commitments must still complete.
    // ("counter-accepted" is left out on purpose: a commitment spoken in the same breath as a refusal
    //  stays unconfirmed until the agent restates the slot and asks, which "counter-reconfirmed" covers.)
    for (const kind of ["accept", "accept-then-thanks", "hedge-then-accept", "counter-reconfirmed"]) {
      const k = byKind.get(kind)!;
      expect(k.completed / k.expected, kind).toBeGreaterThan(0.99);
    }
  });
});
