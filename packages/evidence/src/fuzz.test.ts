/**
 * Property / fuzz tests for the evidence engine.
 *
 * Every case is generated from a seeded PRNG so a failure is reproducible.
 * The invariants here are the ones Oathra's trust story rests on:
 *   - number formats agree,
 *   - negations never become evidence,
 *   - corrections take the last value,
 *   - the caller can never confirm, hedges never confirm,
 *   - a dialogue completes only through offer/accept (or proposal/agree)
 *     plus an explicit callee confirmation.
 */
import { describe, expect, it } from "vitest";
import { defineCall } from "@oathra/contract";
import { EvidenceEngine } from "./engine.js";
import { evaluate } from "./evaluate.js";
import { extractClaims } from "./extract.js";
import { parsePrices } from "./normalize.js";
import type { Utterance } from "./types.js";

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

const NOW = new Date(2026, 8, 11, 10, 0, 0); // 2026-09-11
const pick = <T>(rng: () => number, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;
const int = (rng: () => number, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));

let seq = 0;
function u(source: "caller" | "callee", text: string, t = ++seq * 1000): Utterance {
  return { id: `u${seq}`, source, text, t };
}

// ---------------------------------------------------------------------------
// Japanese number rendering helpers
// ---------------------------------------------------------------------------

const KD = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
function kanjiBelow10000(n: number): string {
  if (n === 0) return "";
  let s = "";
  const sen = Math.floor(n / 1000);
  const hyaku = Math.floor((n % 1000) / 100);
  const juu = Math.floor((n % 100) / 10);
  const ichi = n % 10;
  if (sen) s += (sen === 1 ? "" : KD[sen]) + "千";
  if (hyaku) s += (hyaku === 1 ? "" : KD[hyaku]) + "百";
  if (juu) s += (juu === 1 ? "" : KD[juu]) + "十";
  if (ichi) s += KD[ichi];
  return s;
}
function kanjiNumber(n: number): string {
  const man = Math.floor(n / 10000);
  const rest = n % 10000;
  return (man ? kanjiBelow10000(man) + "万" : "") + kanjiBelow10000(rest);
}
function manFormat(n: number): string {
  const man = Math.floor(n / 10000);
  const rest = n % 10000;
  return man ? `${man}万${rest ? rest : ""}円` : `${rest}円`;
}

const jaTime = (hh: number, mm: number) => (mm === 0 ? `${hh}時` : mm === 30 ? `${hh}時半` : `${hh}時${mm}分`);
const hhmm = (hh: number, mm: number) => `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;

// ---------------------------------------------------------------------------
// 1. Price formats agree
// ---------------------------------------------------------------------------

describe("fuzz: price formats", () => {
  it("every rendering of the same amount parses to the same number (2,000 cases)", () => {
    const rng = mulberry32(101);
    for (let i = 0; i < 2000; i++) {
      // Amounts spoken on the phone: hundreds to hundreds of thousands, whole hundreds.
      const amount = int(rng, 1, 9999) * 100;
      const renderings = [
        `${amount.toLocaleString("en-US")}円`,
        `${amount}円`,
        `¥${amount.toLocaleString("en-US")}`,
        `￥${amount}`,
        manFormat(amount),
        `${kanjiNumber(amount)}円`,
      ];
      for (const r of renderings) {
        const parsed = parsePrices(r).map((p) => p.value);
        expect(parsed, `${r} -> ${JSON.stringify(parsed)}`).toEqual([amount]);
      }
    }
  });

  it("thousands separators never split into a wrong claim through ingest (1,000 cases)", () => {
    const rng = mulberry32(102);
    const frames = [
      (p: string) => `かしこまりました。1泊${p}でご予約承りました。`,
      (p: string) => `${p}でしたらご案内できます。いかがでしょうか？`,
      (p: string) => `お一人様${p}、2名様で${p}です。`,
      (p: string) => `はい、${p}で大丈夫です。`,
    ];
    for (let i = 0; i < 1000; i++) {
      const amount = int(rng, 10, 9999) * 100;
      const p = pick(rng, [`${amount.toLocaleString("en-US")}円`, `¥${amount.toLocaleString("en-US")}`, manFormat(amount)]);
      const text = pick(rng, frames)(p);
      const e = new EvidenceEngine({ now: NOW });
      e.ingest(u("callee", text));
      const prices = e.all().filter((x) => x.field === "price").map((x) => x.value);
      expect(prices, text).toEqual([amount]);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Negation never becomes evidence
// ---------------------------------------------------------------------------

describe("fuzz: negation", () => {
  it("a negated value is never a pending offer nor verified; the alternative is the offer (3,000 cases)", () => {
    const rng = mulberry32(201);
    for (let i = 0; i < 3000; i++) {
      const kind = pick(rng, ["time", "price", "party", "date"] as const);
      let negText: string;
      let negValue: unknown;
      let altText: string | undefined;
      let altValue: unknown;
      let field: string;
      if (kind === "time") {
        field = "time";
        const hh = int(rng, 10, 21);
        const mm = pick(rng, [0, 30]);
        const ahh = mm === 30 ? hh + 1 : hh;
        const amm = mm === 30 ? 0 : 30;
        negText = jaTime(hh, mm);
        negValue = hhmm(hh, mm);
        altText = jaTime(ahh, amm);
        altValue = hhmm(ahh, amm);
      } else if (kind === "price") {
        field = "price";
        const n = int(rng, 20, 300) * 100;
        negText = `${n.toLocaleString("en-US")}円`;
        negValue = n;
        altText = `${(n + 1000).toLocaleString("en-US")}円`;
        altValue = n + 1000;
      } else if (kind === "party") {
        field = "partySize";
        const n = int(rng, 2, 8);
        negText = `${n}名様`;
        negValue = n;
        altText = `${n - 1}名様`;
        altValue = n - 1;
      } else {
        field = "date";
        const d = int(rng, 12, 27);
        negText = `9月${d}日`;
        negValue = `2026-09-${String(d).padStart(2, "0")}`;
        altText = `9月${d + 1}日`;
        altValue = `2026-09-${String(d + 1).padStart(2, "0")}`;
      }
      const templates: Array<(n: string, a: string) => string> = [
        (n) => `${n}ではありません。`,
        (n) => `${n}は無理です。`,
        (n) => `申し訳ございません、${n}は満席でございます。`,
        (n) => `${n}はいっぱいです。`,
        (n) => `${n}以内は無理です。`,
        (n) => `${n}はご用意できません。`,
        (n, a) => `${n}は無理ですが${a}なら空いております。`,
        (n, a) => `${n}はいっぱいですが、${a}でしたら空いております。`,
        (n, a) => `申し訳ございません、${n}は難しいのですが、${a}であればご案内できます。`,
        (n, a) => `${n}はございませんけど、${a}ならございます。`,
      ];
      const tpl = pick(rng, templates);
      const text = tpl(negText, altText!);
      const hasAlt = text.includes(altText!);

      const e = new EvidenceEngine({ now: NOW });
      e.ingest(u("caller", "空いていますでしょうか？"));
      e.ingest(u("callee", text));
      const offer = e.pendingOffer(field);
      const values = e.values();
      expect(values[field], `verified from negation: ${text}`).toBeUndefined();
      if (hasAlt) {
        expect(offer?.value, `alt should be the offer: ${text}`).toEqual(altValue);
      } else {
        expect(offer, `negated value became an offer: ${text}`).toBeUndefined();
      }
      // The negated value must not exist as a positive claim at all.
      const neg = e.all().find((x) => x.field === field && x.value === negValue);
      expect(neg, `negated value recorded: ${text}`).toBeUndefined();

      // Even if the caller blindly says "それでお願いします", the negated value stays unverified.
      e.ingest(u("caller", "それでお願いします。"));
      expect(e.values()[field], `negated value verified after blind acceptance: ${text}`).not.toEqual(negValue);
      if (hasAlt) expect(e.values()[field]).toEqual(altValue);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Corrections take the last value
// ---------------------------------------------------------------------------

describe("fuzz: corrections", () => {
  it("the corrected value wins and a supersedes edge exists (2,000 cases)", () => {
    const rng = mulberry32(301);
    for (let i = 0; i < 2000; i++) {
      const kind = pick(rng, ["date", "party", "time", "price"] as const);
      const side = pick(rng, ["caller", "callee"] as const);
      let text: string;
      let field: string;
      let wrong: unknown;
      let right: unknown;
      if (kind === "date") {
        field = "date";
        const d = int(rng, 12, 27);
        wrong = `2026-09-${String(d).padStart(2, "0")}`;
        right = `2026-09-${String(d + 1).padStart(2, "0")}`;
        text = pick(rng, [
          `${d}日、いや${d + 1}日です。`,
          `9月${d}日、すみません、${d + 1}日でお願いします。`,
          `${d}日ではなく${d + 1}日です。`,
        ]);
      } else if (kind === "party") {
        field = "partySize";
        const n = int(rng, 2, 7);
        wrong = n;
        right = n + 1;
        text = pick(rng, [
          `${n}名ではなく${n + 1}名でお願いします。`,
          `${n}名、あ、${n + 1}名です。`,
          `${n}人、すみません${n + 1}人で。`,
        ]);
      } else if (kind === "time") {
        field = "time";
        const hh = int(rng, 11, 20);
        wrong = hhmm(hh, 0);
        right = hhmm(hh, 30);
        text = pick(rng, [
          `${hh}時…すみません${hh}時半で。`,
          `${hh}時、いえ${hh}時半でお願いします。`,
          `${hh}時ではなく${hh}時半です。`,
        ]);
      } else {
        field = "price";
        const n = int(rng, 20, 300) * 100;
        wrong = n;
        right = n + 500;
        text = pick(rng, [
          `${n.toLocaleString("en-US")}円、失礼しました、${(n + 500).toLocaleString("en-US")}円です。`,
          `${n}円ではなく${n + 500}円になります。`,
        ]);
      }
      const e = new EvidenceEngine({ now: NOW });
      e.ingest(u(side, text));
      const pending = e.pending(field);
      expect(pending?.value, `corrected value: ${text}`).toEqual(right);
      const nodes = e.all().filter((x) => x.field === field);
      const wrongNode = nodes.find((x) => x.value === wrong);
      const rightNode = nodes.find((x) => x.value === right);
      expect(rightNode, text).toBeDefined();
      if (wrongNode) {
        const edge = e.graph().edges.find((x) => x.relation === "supersedes" && x.from === rightNode!.id && x.to === wrongNode.id);
        expect(edge, `missing supersedes edge: ${text}`).toBeDefined();
      }
      // After the counterpart resolves, only the corrected value is verified.
      const resolver = side === "caller" ? u("callee", "はい、かしこまりました。") : u("caller", "はい、それでお願いします。");
      e.ingest(resolver);
      expect(e.values()[field], `verified after correction: ${text}`).toEqual(right);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Caller can never confirm; hedges never confirm
// ---------------------------------------------------------------------------

describe("fuzz: confirmation authority", () => {
  const CALLER_CLAIMS = [
    "予約できました。",
    "予約を取りました。",
    "予約が取れました！",
    "確定しました。",
    "ご予約承りました。",
    "承りました。",
    "予約完了です。",
    "OK, booked it.",
    "We're all set.",
    "The table is confirmed.",
    "I've booked it.",
  ];
  const CALLEE_HEDGES = [
    "予約を取れると思います。",
    "たぶん大丈夫です。",
    "おそらく空いています。",
    "確認してみます。",
    "多分ご予約承れると思います。",
    "承れるかもしれません。",
    "確認いたしますので少々お待ちください。",
    "I think we can book that.",
    "Probably confirmed, let me check.",
    "Maybe it's all set.",
  ];
  const CALLEE_CONFIRMS = ["かしこまりました、ご予約承りました。", "ご予約をお取りしました。", "確定いたしました。", "Your table is confirmed."];

  it("caller completion claims never verify `confirmed` (1,000 cases)", () => {
    const rng = mulberry32(401);
    for (let i = 0; i < 1000; i++) {
      const e = new EvidenceEngine({ now: NOW });
      const n = int(rng, 1, 4);
      for (let k = 0; k < n; k++) {
        e.ingest(u("caller", pick(rng, CALLER_CLAIMS)));
        if (rng() < 0.5) e.ingest(u("callee", pick(rng, ["少々お待ちください。", "はい。", "ありがとうございます。", "お調べします。"])));
      }
      expect(e.values().confirmed, `caller verified confirmed after: ${e.all().map((x) => x.transcript).join(" / ")}`).toBeUndefined();
      expect(e.all().filter((x) => x.field === "confirmed").every((x) => !x.verified)).toBe(true);
    }
  });

  it("callee hedges never verify `confirmed` nor agree to a proposal (1,000 cases)", () => {
    const rng = mulberry32(402);
    for (let i = 0; i < 1000; i++) {
      const e = new EvidenceEngine({ now: NOW });
      const hh = int(rng, 17, 21);
      e.ingest(u("caller", `明日${jaTime(hh, 0)}に2名で予約したいのですが。`));
      const hedge = pick(rng, CALLEE_HEDGES);
      e.ingest(u("callee", hedge));
      const v = e.values();
      expect(v.confirmed, `hedge confirmed: ${hedge}`).toBeUndefined();
      expect(v.time, `hedge agreed to time: ${hedge}`).toBeUndefined();
      expect(v.partySize, `hedge agreed to party: ${hedge}`).toBeUndefined();
      // A real confirmation afterwards still works.
      e.ingest(u("callee", pick(rng, CALLEE_CONFIRMS)));
      expect(e.values().confirmed).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Full-dialogue invariant
// ---------------------------------------------------------------------------

type Field = "date" | "time" | "partySize" | "price";
type FieldVal = { field: Field; value: unknown; ja: string };

function randomField(rng: () => number, field: Field): FieldVal {
  switch (field) {
    case "date": {
      const d = int(rng, 12, 28);
      return { field, value: `2026-09-${String(d).padStart(2, "0")}`, ja: `9月${d}日` };
    }
    case "time": {
      const hh = int(rng, 11, 21);
      const mm = pick(rng, [0, 30]);
      return { field, value: hhmm(hh, mm), ja: jaTime(hh, mm) };
    }
    case "partySize": {
      const n = int(rng, 1, 8);
      return { field, value: n, ja: `${n}名` };
    }
    case "price": {
      const n = int(rng, 30, 400) * 100;
      return { field, value: n, ja: pick(rng, [`${n.toLocaleString("en-US")}円`, manFormat(n)]) };
    }
  }
}

const NOISE_CALLEE = ["少々お待ちください。", "はい。", "ありがとうございます。", "お調べいたします。", "少々確認いたします。"];
const NOISE_CALLER = ["はい。", "ありがとうございます。", "よろしくお願いします。", "なるほど。"];

const CONTRACT_BASE = { goal: "fuzz.reservation", permissions: { ask: true, reserve: true } };

describe("fuzz: full dialogues", () => {
  it("valid dialogues complete; mutated dialogues never do (1,500 dialogues)", () => {
    const rng = mulberry32(501);
    for (let i = 0; i < 1500; i++) {
      const fieldPool: Field[] = ["date", "time", "partySize", "price"];
      const count = int(rng, 1, 4);
      const fields = [...fieldPool].sort(() => rng() - 0.5).slice(0, count);
      const vals = fields.map((f) => randomField(rng, f));
      const require: Record<string, boolean> = { confirmed: true };
      for (const f of fields) require[f] = true;
      const contract = defineCall({ ...CONTRACT_BASE, require });

      const mutation = pick(rng, ["none", "none", "drop-confirm", "negate-offer", "caller-claims", "hedge-confirm", "wrong-restate"] as const);

      const lines: string[] = [];
      const build = (mut: typeof mutation) => {
        const e = new EvidenceEngine({ now: NOW });
        const say = (source: "caller" | "callee", text: string) => {
          lines.push(`${source}: ${text}`);
          return e.ingest(u(source, text));
        };
        const maybeNoise = (source: "caller" | "callee") => {
          if (rng() < 0.3) say(source, pick(rng, source === "callee" ? NOISE_CALLEE : NOISE_CALLER));
        };
        const negated = new Set<Field>();
        say("callee", "お電話ありがとうございます。");
        maybeNoise("caller");

        // Each field is settled either by offer/accept or by proposal/agree.
        for (const [idx, v] of vals.entries()) {
          // negate-offer must negate at least one real offer.
          const mode = mut === "negate-offer" && idx === 0 ? "offer" : pick(rng, ["offer", "proposal"] as const);
          if (mode === "offer") {
            const negate = mut === "negate-offer";
            const offer = negate
              ? `申し訳ございません、${v.ja}は${pick(rng, ["満席でございます。", "無理です。", "ご用意できません。"])}`
              : pick(rng, [`${v.ja}でしたら空いております。いかがでしょうか？`, `${v.ja}でご案内できます。`, `${v.ja}になります。`]);
            say("callee", offer);
            maybeNoise("callee");
            // After a refusal a blind acceptance must not settle anything; a caller
            // restating the refused value would be a new proposal (tested elsewhere).
            say("caller", negate ? pick(rng, ["それでお願いします。", "はい、それで大丈夫です。"]) : pick(rng, [`では、${v.ja}でお願いします。`, "それでお願いします。", "はい、それで大丈夫です。"]));
            if (negate) negated.add(v.field);
          } else {
            say("caller", pick(rng, [`${v.ja}でお願いしたいのですが。`, `${v.ja}で予約したいです。`, `${v.ja}は空いていますか？`]));
            maybeNoise("caller");
            say("callee", pick(rng, ["はい、大丈夫です。", `${v.ja}ですね、かしこまりました。`, "承知いたしました。"]));
          }
          maybeNoise("callee");
        }

        if (mut === "caller-claims") {
          say("caller", pick(rng, ["予約できました。", "確定しました。", "ご予約承りました。"]));
        } else if (mut === "hedge-confirm") {
          say("callee", pick(rng, ["ご予約承れると思います。", "たぶん承りました。", "おそらくお取りできます。"]));
        } else if (mut !== "drop-confirm") {
          // A confirmation that explicitly restates a value settles it, so a
          // negated field is simply not restated (the callee never offered it).
          const restated = vals
            .filter((v) => !negated.has(v.field))
            .map((v) => {
              if (mut === "wrong-restate" && v === vals[0]) {
                let other = randomField(rng, v.field);
                for (let tries = 0; other.value === v.value && tries < 50; tries++) other = randomField(rng, v.field);
                return other.ja;
              }
              return v.ja;
            })
            .join("、");
          say("callee", `かしこまりました。${restated}でご予約承りました。`);
        }
        return e;
      };

      const e = build(mutation);
      const result = evaluate(contract, e, "completed");
      const dialogue = lines.join("\n") + "\nfields=" + JSON.stringify(result.fields);
      if (mutation === "none") {
        expect(result.complete, `valid dialogue did not complete:\n${dialogue}\nmissing=${result.missing}`).toBe(true);
        for (const v of vals) expect(result.fields[v.field], `${v.field}\n${dialogue}`).toEqual(v.value);
      } else {
        expect(result.complete, `mutation ${mutation} completed:\n${dialogue}`).toBe(false);
        if (mutation === "wrong-restate") {
          // Either the deal is unsettled, or the reported value is what the callee actually restated — never the stale one.
          const stale = vals[0]!;
          const reported = result.fields[stale.field];
          if (reported !== undefined) expect(reported).not.toEqual(stale.value);
        }
      }
    }
  });
});
