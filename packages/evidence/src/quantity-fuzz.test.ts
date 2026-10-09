/**
 * Adversarial fuzz for orders (`quantity` + delivery date, `confirmation: "callee_acceptance"`).
 *
 * 10,000 seeded supplier dialogues in which the order as requested was NOT agreed: the supplier named
 * a different amount, a different unit or a different day, hedged, countered, asked back, held, refused,
 * or agreed to other terms. Any completion is a false completion. Every case is reproducible from its seed.
 * A second, smaller run of clean agreements checks that being safe does not mean refusing everything.
 */
import { describe, expect, it } from "vitest";
import { definePhoneRequest, preparePhoneRequest, type CallContract } from "@oathra/contract";
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

const NOW = new Date(2026, 9, 2, 10);
type Rng = () => number;
type Line = ["caller" | "callee", string];
type Order = { amount: number; unit: string; quantity: string; say: string; date: string; day: string };
type Dialogue = { kind: string; order: Order; lines: Line[] };

const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;
const int = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
const pad = (n: number) => String(n).padStart(2, "0");

// [canonical unit, how it is spoken]
const UNITS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["ケース", ["ケース", "ｹｰｽ"]], ["箱", ["箱"]], ["個", ["個"]], ["本", ["本"]], ["枚", ["枚"]], ["台", ["台"]], ["袋", ["袋"]], ["セット", ["セット"]],
  ["ダース", ["ダース"]], ["パック", ["パック"]], ["kg", ["kg", "キロ", "キログラム"]], ["t", ["トン"]], ["L", ["リットル"]], ["ロット", ["ロット"]], ["缶", ["缶"]], ["冊", ["冊"]],
];
const KANJI: Record<number, string> = { 10: "十", 20: "二十", 30: "三十", 40: "四十", 50: "五十", 60: "六十", 100: "百", 200: "二百", 1000: "千" };
const sayAmount = (rng: Rng, n: number) => (KANJI[n] && rng() < 0.2 ? KANJI[n]! : n >= 1000 && rng() < 0.3 ? n.toLocaleString("en-US") : rng() < 0.1 ? String(n).replace(/\d/g, (d) => String.fromCharCode(d.charCodeAt(0) + 0xfee0)) : String(n));

function order(rng: Rng, not?: Order, vary?: "amount" | "unit" | "date"): Order {
  for (;;) {
    const u = !not || vary === "unit" ? pick(rng, UNITS) : UNITS.find(([c]) => c === not.unit)!;
    const amount = !not || vary === "amount" ? pick(rng, [5, 10, 12, 20, 24, 30, 40, 50, 60, 100, 120, 200, 300, 1000, 1200]) : not.amount;
    const month = !not || vary === "date" ? int(rng, 10, 12) : Number(not.date.slice(5, 7));
    const dayOfMonth = !not || vary === "date" ? int(rng, 3, 28) : Number(not.date.slice(8, 10));
    const o: Order = { amount, unit: u[0], quantity: `${amount}${u[0]}`, say: `${sayAmount(rng, amount)}${pick(rng, u[1])}`, date: `2026-${pad(month)}-${pad(dayOfMonth)}`, day: `${month}月${dayOfMonth}日` };
    if (!not || o.quantity !== not.quantity || o.date !== not.date) return o;
  }
}

const ITEMS = ["A-100", "型番B-2040", "コピー用紙", "品番KX-88の部品", "ミネラルウォーター"];
const OPENERS = ["お世話になっております。山田商事のAIアシスタントです。ご注文の件でお電話しました。", "いつもお世話になっております。山田商事の代理でお電話しているAIアシスタントです。"];
const GREETINGS = ["はい、丸山物産です。", "お電話ありがとうございます。", "はい。", "もしもし。"];
const ASK = [
  (i: string, o: Order) => `${i}を${o.say}、${o.day}納品でお願いできますか。`,
  (i: string, o: Order) => `${i}を${o.say}、${o.day}に納品いただきたいのですが、可能でしょうか。`,
  (i: string, o: Order) => `${o.day}納品で、${i}を${o.say}お願いしたいです。`,
];
const TERMS = [(o: Order) => `${o.say}、${o.day}納品`, (o: Order) => `${o.day}に${o.say}`, (o: Order) => `${o.say}を${o.day}納品`];
const COMMIT = [(t: string) => `はい、${t}で大丈夫です。`, (t: string) => `${t}で承りました。`, (t: string) => `承知しました。${t}でお受けします。`, (t: string) => `はい、${t}で問題ありません。`, (t: string) => `かしこまりました。${t}でご用意します。`];
const BARE = ["かしこまりました。", "はい、大丈夫です。", "はい。", "承知しました。"];
const HEDGES = [(o: Order) => `${o.say}はたぶん大丈夫だと思います。`, (o: Order) => `${o.say}ですね。在庫を確認してから折り返します。`, () => "おそらくご用意できるかと思いますが、まだ確定ではありません。", (o: Order) => `${o.say}、${o.day}ですね。社内で確認いたします。`, () => "一度持ち帰らせてください。", () => "検討します。", (o: Order) => `${o.say}は確約できませんが、善処します。`, (o: Order) => `${o.day}納品は調整中です。`, () => "承知しました、担当に聞いてから折り返します。"];
const REFUSALS = [(o: Order) => `${o.say}は難しいです。`, (o: Order) => `${o.say}はご用意できません。`, () => "申し訳ございません、その商品は在庫がございません。", (o: Order) => `${o.day}の納品はできかねます。`, () => "お断りします。", () => "今回はお受けできません。", (o: Order) => `${o.say}は無理です。`];
const QUESTIONS = [(o: Order) => `${o.say}ですか？`, (o: Order) => `${o.say}、${o.day}納品でよろしいでしょうか？`, () => "どちらの商品でしょうか？", (o: Order) => `${o.day}に${o.say}ということでしょうか。`, () => "納品先はどちらになりますか？"];
const HOLDS = ["はい、少々お待ちください。", "在庫を見てまいりますので、少々お待ちください。", "はい、確認いたします。"];
const CONDITION = ["なら", "でしたら", "までなら"];
const SPOILERS = [(o: Order) => `ただ${o.say}は難しいです`, () => "在庫を確認してから折り返します", () => "検討します", () => "まだ確定ではありません", () => "確約はできません", () => "やはりキャンセルでお願いします", (o: Order) => `${o.day}の納品はできかねます`];
const AGREE_WORDS = ["承知しました", "かしこまりました", "大丈夫です", "はい、お願いします", "了解です"];

const KINDS = ["different-amount", "different-unit", "different-date", "different-accepted", "hedge", "counter-offer", "counter-accepted", "counter-question", "question", "question-then-caller-yes", "refusal", "refuse-then-counter", "hold", "agree-plus-spoiler", "spoiler-plus-agree", "other-terms-confirmed", "caller-only", "accept-then-cancel", "accept-then-change", "quantity-only", "date-only", "stale-yes"] as const;

/** The supplier never agrees to the order as requested. */
function generate(seed: number): Dialogue {
  const rng = mulberry32(seed);
  const o = order(rng);
  const item = pick(rng, ITEMS);
  const lines: Line[] = [];
  if (rng() < 0.7) lines.push(["callee", pick(rng, GREETINGS)]);
  lines.push(["caller", pick(rng, OPENERS)]);
  if (rng() < 0.4) lines.push(["callee", pick(rng, ["はい。", "ええ。", "お世話になっております。"])]);
  lines.push(["caller", pick(rng, ASK)(item, o)]);
  const other = (vary: "amount" | "unit" | "date") => order(rng, o, vary);
  const terms = (x: Order) => pick(rng, TERMS)(x);
  const commit = (x: Order) => pick(rng, COMMIT)(terms(x));
  const kind = pick(rng, KINDS);
  switch (kind) {
    case "different-amount":
      lines.push(["callee", commit(other("amount"))]);
      break;
    case "different-unit":
      lines.push(["callee", commit(other("unit"))]);
      break;
    case "different-date":
      lines.push(["callee", commit(other("date"))]);
      break;
    case "different-accepted": {
      // The caller goes along with other terms: an agreement, but not to what was requested.
      const x = other(pick(rng, ["amount", "unit", "date"] as const));
      lines.push(["callee", commit(x)], ["caller", `承知しました。${terms(x)}でお願いします。`], ["callee", pick(rng, ["はい、よろしくお願いします。", "はい。", commit(x)])]);
      break;
    }
    case "hedge":
      lines.push(["callee", pick(rng, HEDGES)(o)]);
      break;
    case "counter-offer": {
      const x = other(pick(rng, ["amount", "unit"] as const));
      lines.push(["callee", `${x.say}${pick(rng, CONDITION)}${pick(rng, ["大丈夫です。", "ご用意できます。", "お受けできます。"])}`]);
      break;
    }
    case "counter-accepted": {
      const x = other(pick(rng, ["amount", "unit"] as const));
      lines.push(["callee", `${x.say}${pick(rng, CONDITION)}${pick(rng, ["大丈夫です。", "ご用意できます。"])}`], ["caller", `承知しました。${x.say}でお願いします。`], ["callee", pick(rng, ["はい。", "かしこまりました。", `はい、${x.say}で承りました。`])]);
      break;
    }
    case "counter-question": {
      const x = other(pick(rng, ["amount", "date"] as const));
      lines.push(["callee", `${terms(x)}ならいかがでしょうか？`], ["caller", "確認いたします。"]);
      break;
    }
    case "question":
      lines.push(["callee", pick(rng, QUESTIONS)(o)]);
      break;
    case "question-then-caller-yes":
      // Only the caller says yes; the supplier just asked.
      lines.push(["callee", pick(rng, [`${o.say}ですか？`, `${o.say}、${o.day}納品でよろしいでしょうか？`, `${o.day}に${o.say}ということでしょうか。`])], ["caller", `はい、${terms(o)}でお願いします。`]);
      break;
    case "refusal":
      lines.push(["callee", pick(rng, REFUSALS)(o)]);
      break;
    case "refuse-then-counter": {
      const x = other("amount");
      lines.push(["callee", `${o.say}は難しいですが、${x.say}ならご用意できます。`]);
      if (rng() < 0.5) lines.push(["caller", "確認いたします。"]);
      break;
    }
    case "hold":
      lines.push(["callee", pick(rng, HOLDS)]);
      if (rng() < 0.5) lines.push(["caller", "はい、お待ちします。"], ["callee", pick(rng, ["お待たせしました。", pick(rng, REFUSALS)(o), pick(rng, HEDGES)(o)])]);
      break;
    case "agree-plus-spoiler":
      lines.push(["callee", `${pick(rng, AGREE_WORDS)}。${pick(rng, SPOILERS)(o)}。`]);
      break;
    case "spoiler-plus-agree":
      lines.push(["callee", `${pick(rng, SPOILERS)(o)}。${pick(rng, AGREE_WORDS)}。`]);
      break;
    case "other-terms-confirmed": {
      // An explicit confirmation phrase, for terms nobody requested.
      const x = other(pick(rng, ["amount", "unit", "date"] as const));
      lines.push(["callee", `${terms(x)}でご注文承りました。`]);
      if (rng() < 0.5) lines.push(["caller", "ありがとうございます。"]);
      break;
    }
    case "caller-only":
      lines.push(["caller", `では${terms(o)}で確定とさせていただきます。ありがとうございます。`]);
      break;
    case "accept-then-cancel":
      lines.push(["callee", commit(o)], ["caller", "ありがとうございます。"], ["callee", pick(rng, ["すみません、やはりキャンセルでお願いします。", "申し訳ありません、やはりご用意できません。", "あ、取り消してください。"])]);
      break;
    case "accept-then-change": {
      const x = other(pick(rng, ["amount", "unit", "date"] as const));
      lines.push(["callee", commit(o)], ["callee", pick(rng, [`すみません、${terms(x)}になります。`, `あ、失礼しました。${terms(x)}でした。`])]);
      break;
    }
    case "quantity-only":
      lines.push(["callee", `${o.say}は大丈夫です。ただ${o.day}の納品は難しいです。`]);
      break;
    case "date-only":
      lines.push(["callee", `${o.day}納品は大丈夫です。数量は確認してから折り返します。`]);
      break;
    case "stale-yes":
      lines.push(["callee", "少々お待ちください。"], ["caller", "はい、お待ちします。"], ["callee", "はい。"]);
      break;
  }
  return { kind, order: o, lines };
}

/** The supplier agrees to exactly what was requested. */
function generateAgreed(seed: number): Dialogue {
  const rng = mulberry32(seed);
  const o = order(rng);
  const lines: Line[] = [["caller", pick(rng, OPENERS)], ["caller", pick(rng, ASK)(pick(rng, ITEMS), o)]];
  const kind = pick(rng, ["restated", "bare", "hedge-then-restated"] as const);
  const restated = pick(rng, COMMIT)(pick(rng, TERMS)(o));
  if (kind === "restated") lines.push(["callee", restated]);
  else if (kind === "bare") lines.push(["callee", pick(rng, BARE)]);
  else lines.push(["callee", pick(rng, HEDGES)(o)], ["caller", pick(rng, ASK)(pick(rng, ITEMS), o)], ["callee", restated]);
  return { kind, order: o, lines };
}

const contracts = new Map<string, CallContract>();
function contractFor(o: Order): CallContract {
  const key = `${o.quantity}|${o.date}`;
  let c = contracts.get(key);
  if (!c) {
    c = definePhoneRequest(preparePhoneRequest({ phone: "+819000000000", name: "仕入先", instruction: "発注の可否を確認してください。", success: { required: ["quantity", "date", "confirmed"], expected: { quantity: o.quantity, date: o.date } } }));
    contracts.set(key, c);
  }
  return c;
}

function judge(d: Dialogue) {
  const contract = contractFor(d.order);
  const engine = new EvidenceEngine({ language: "ja", now: NOW, confirmation: contract.confirmation! });
  d.lines.forEach(([source, text], i) => engine.ingest({ id: `u${i}`, source, text, t: (i + 1) * 1000 }));
  return evaluate(contract, engine, "completed");
}

const show = (seed: number, d: Dialogue, fields: unknown) => `seed ${seed} [${d.kind}] want=${d.order.quantity} ${d.order.date} got=${JSON.stringify(fields)}\n  ${d.lines.map((l) => l.join(": ")).join("\n  ")}`;

// 10,000 full evaluate() runs take 10-25 s depending on the machine; the count and the zero-false-completion bar stay.
const FUZZ_TIMEOUT_MS = 120_000;

describe("quantity adversarial fuzz", () => {
  it("10,000 seeded supplier dialogues where the order was not agreed: no false completion", () => {
    const RUNS = 10_000;
    const falseCompletions: string[] = [];
    const byKind = new Map<string, number>();
    let count = 0;
    for (let seed = 1; seed <= RUNS; seed++) {
      const d = generate(seed);
      byKind.set(d.kind, (byKind.get(d.kind) ?? 0) + 1);
      const r = judge(d);
      if (!r.complete) continue;
      count++;
      if (falseCompletions.length < 5) falseCompletions.push(show(seed, d, r.fields));
    }
    expect(falseCompletions, falseCompletions.join("\n\n")).toEqual([]);
    expect(count).toBe(0);
    // every kind of disagreement was actually exercised
    for (const kind of KINDS) expect(byKind.get(kind) ?? 0, kind).toBeGreaterThan(300);
  }, FUZZ_TIMEOUT_MS);

  it("2,000 seeded clean agreements still complete, with the requested quantity and date", () => {
    const RUNS = 2_000;
    const missed: string[] = [];
    let completed = 0;
    for (let seed = 1; seed <= RUNS; seed++) {
      const d = generateAgreed(seed);
      const r = judge(d);
      if (r.complete && r.fields.quantity === d.order.quantity && r.fields.date === d.order.date) completed++;
      else if (missed.length < 5) missed.push(show(seed, d, r.fields));
    }
    expect(completed / RUNS, missed.join("\n\n")).toBeGreaterThan(0.99);
  });
});
