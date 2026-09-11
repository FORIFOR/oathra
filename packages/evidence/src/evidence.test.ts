import { describe, expect, it } from "vitest";
import { defineCall } from "@oathra/contract";
import { EvidenceEngine } from "./engine.js";
import { evaluate } from "./evaluate.js";
import { kanjiToNumber, parseDates, parsePartySize, parsePrices, parseTimes } from "./normalize.js";
import { splitClauses } from "./extract.js";
import type { Utterance } from "./types.js";

const NOW = new Date(2026, 8, 11, 10, 0, 0); // 2026-09-11

describe("normalize", () => {
  it("parses kanji numbers", () => {
    expect(kanjiToNumber("二")).toBe(2);
    expect(kanjiToNumber("十九")).toBe(19);
    expect(kanjiToNumber("二十三")).toBe(23);
    expect(kanjiToNumber("八千八百")).toBe(8800);
    expect(kanjiToNumber("x")).toBeUndefined();
  });

  it("parses japanese times", () => {
    expect(parseTimes("19時半でしたら空いております").map((t) => t.value)).toEqual(["19:30"]);
    expect(parseTimes("午後7時はいかがでしょう").map((t) => t.value)).toEqual(["19:00"]);
    expect(parseTimes("十九時三十分").map((t) => t.value)).toEqual(["19:30"]);
    expect(parseTimes("19:30でお願いします").map((t) => t.value)).toEqual(["19:30"]);
  });

  it("parses english times", () => {
    expect(parseTimes("7:30 pm works", "en").map((t) => t.value)).toEqual(["19:30"]);
    expect(parseTimes("how about seven thirty pm", "en").map((t) => t.value)).toEqual(["19:30"]);
  });

  it("parses dates relative to now", () => {
    expect(parseDates("明日の夜", NOW).map((d) => d.value)).toEqual(["2026-09-12"]);
    expect(parseDates("9月12日", NOW).map((d) => d.value)).toEqual(["2026-09-12"]);
    expect(parseDates("2026-09-12", NOW).map((d) => d.value)).toEqual(["2026-09-12"]);
    expect(parseDates("tomorrow at 7", NOW, "en").map((d) => d.value)).toEqual(["2026-09-12"]);
  });

  it("parses party size", () => {
    expect(parsePartySize("2名でお願いします").map((p) => p.value)).toEqual([2]);
    expect(parsePartySize("お二人様ですね").map((p) => p.value)).toEqual([2]);
    expect(parsePartySize("四人です").map((p) => p.value)).toEqual([4]);
    expect(parsePartySize("a table for two", "en").map((p) => p.value)).toEqual([2]);
  });

  it("parses prices", () => {
    expect(parsePrices("¥12,580").map((p) => p.value)).toEqual([12580]);
    expect(parsePrices("2万円になります").map((p) => p.value)).toEqual([20000]);
    expect(parsePrices("1万8800円でいかがでしょう").map((p) => p.value)).toEqual([18800]);
    expect(parsePrices("二万三千五百円").map((p) => p.value)).toEqual([23500]);
    expect(parsePrices("5,500円").map((p) => p.value)).toEqual([5500]);
    expect(parsePrices("$20").map((p) => p.value)).toEqual([20]);
  });
});

describe("splitClauses", () => {
  it("separates refusal from offer", () => {
    const c = splitClauses("19時はいっぱいですが19時半なら空いております。");
    expect(c.map((x) => x.polarity)).toEqual(["negative", "positive"]);
  });
});

function u(id: string, source: "caller" | "callee", text: string, t: number): Utterance {
  return { id, source, text, t };
}

describe("EvidenceEngine", () => {
  it("verifies a callee offer accepted by the caller, and refuses false completion", () => {
    const e = new EvidenceEngine({ now: NOW });
    e.ingest(u("u1", "caller", "明日の19時以降で2名なのですが空いていますか？", 1000));
    e.ingest(u("u2", "callee", "19時はいっぱいですが、19時半でしたら空いております。", 3000));
    // 19:00 must NOT be evidence; 19:30 is a pending offer.
    expect(e.pending("time")?.value).toBe("19:30");
    expect(e.values().time).toBeUndefined();

    e.ingest(u("u3", "caller", "では19時半でお願いします。", 5000));
    expect(e.values().time).toBe("19:30");

    // Caller claiming completion is never verification.
    e.ingest(u("u4", "caller", "予約できました。", 6000));
    expect(e.values().confirmed).toBeUndefined();

    e.ingest(u("u5", "callee", "かしこまりました。明日19時半、2名様でご予約承りました。", 7000));
    const v = e.values();
    expect(v.confirmed).toBe(true);
    expect(v.date).toBe("2026-09-12");
    expect(v.partySize).toBe(2);
    expect(v.time).toBe("19:30");
  });

  it("verifies a caller proposal confirmed by callee", () => {
    const e = new EvidenceEngine({ now: NOW });
    e.ingest(u("u1", "caller", "明日19時に2名で予約したいのですが。", 1000));
    expect(e.values().date).toBeUndefined();
    e.ingest(u("u2", "callee", "はい、明日19時に2名様ですね。大丈夫です。", 2000));
    expect(e.values()).toMatchObject({ date: "2026-09-12", time: "19:00", partySize: 2 });
  });

  it("supersedes a pending offer with a counter-value", () => {
    const e = new EvidenceEngine({ now: NOW });
    e.ingest(u("u1", "callee", "2万3千500円になります。", 1000));
    e.ingest(u("u2", "caller", "2万円以下になりませんか？", 2000));
    e.ingest(u("u3", "callee", "朝食付きで1万8800円でいかがでしょう。", 3000));
    expect(e.pending("price")?.value).toBe(18800);
    e.ingest(u("u4", "caller", "それでお願いします。", 4000));
    expect(e.values().price).toBe(18800);
    expect(e.values().breakfast).toBe(true);
    const g = e.graph();
    expect(g.edges.some((x) => x.relation === "supersedes")).toBe(true);
    expect(g.edges.some((x) => x.relation === "accepted_by")).toBe(true);
  });
});

describe("evaluate", () => {
  const contract = defineCall({
    goal: "restaurant.reservation",
    require: { date: true, time: true, partySize: true, confirmed: true },
    constraints: { time: { gte: "19:00" } },
  });

  it("is incomplete until the callee confirms", () => {
    const e = new EvidenceEngine({ now: NOW });
    e.ingest(u("u1", "caller", "明日19時に2名で予約したいのですが。", 1000));
    e.ingest(u("u2", "callee", "はい、明日19時に2名様ですね。大丈夫です。", 2000));
    const r = evaluate(contract, e, "completed");
    expect(r.status).toBe("incomplete");
    expect(r.missing).toEqual(["confirmed"]);
    e.ingest(u("u3", "callee", "ご予約承りました。", 3000));
    const r2 = evaluate(contract, e, "completed");
    expect(r2.status).toBe("completed");
    expect(r2.complete).toBe(true);
    expect(r2.confidence).toBeGreaterThan(0.8);
  });

  it("flags constraint violations", () => {
    const e = new EvidenceEngine({ now: NOW });
    e.ingest(u("u1", "caller", "明日18時に2名で予約したいのですが。", 1000));
    e.ingest(u("u2", "callee", "はい、明日18時に2名様ですね。ご予約承りました。", 2000));
    const r = evaluate(contract, e, "completed");
    expect(r.status).toBe("constraint_violation");
    expect(r.complete).toBe(false);
  });

  it("never completes while the call is still active", () => {
    const e = new EvidenceEngine({ now: NOW });
    e.ingest(u("u1", "caller", "明日19時に2名で予約したいのですが。", 1000));
    e.ingest(u("u2", "callee", "はい、明日19時に2名様ですね。ご予約承りました。", 2000));
    expect(evaluate(contract, e, "active").complete).toBe(false);
    expect(evaluate(contract, e, "completed").complete).toBe(true);
  });
});

describe("thousands separators", () => {
  it("does not split 21,100円 into a 100円 clause", () => {
    const e = new EvidenceEngine({ now: NOW });
    e.ingest(u("u1", "callee", "かしこまりました。2名様、1泊21,100円でご予約承りました。", 1000));
    const price = e.all().find((x) => x.field === "price");
    expect(price?.value).toBe(21100);
  });
});

describe("duplicate claims", () => {
  it("records one evidence per field/value per utterance", () => {
    const e = new EvidenceEngine({ now: NOW });
    e.ingest(u("u1", "caller", "予算が5,500円なのですが、5,500円以内になりませんでしょうか？", 1000));
    expect(e.all().filter((x) => x.field === "price")).toHaveLength(1);
  });
});

describe("regressions from adversarial fuzzing", () => {
  it("a hedge is neither a confirmation nor an agreement", () => {
    const e = new EvidenceEngine({ now: NOW });
    e.ingest(u("u1", "caller", "明日19時に2名で予約したいのですが。", 1000));
    e.ingest(u("u2", "callee", "たぶん大丈夫です。ご予約承れると思います。", 2000));
    expect(e.values()).toEqual({});
    e.ingest(u("u3", "callee", "はい、大丈夫です。ご予約承りました。", 3000));
    expect(e.values()).toMatchObject({ time: "19:00", partySize: 2, confirmed: true });
  });

  it("a confirmation that restates a different value unsettles the field", () => {
    const e = new EvidenceEngine({ now: NOW });
    e.ingest(u("u1", "callee", "19時半でしたら空いております。", 1000));
    e.ingest(u("u2", "caller", "では、19時半でお願いします。", 2000));
    expect(e.values().time).toBe("19:30");
    e.ingest(u("u3", "callee", "かしこまりました。19時でご予約承りました。", 3000));
    // 19:30 was agreed, 19:00 was confirmed: neither the time nor the
    // confirmation (which is bound to 19:00) is settled until re-accepted.
    expect(e.values().time).toBeUndefined();
    expect(e.values().confirmed).toBeUndefined();
    expect(e.pendingOffer("time")?.value).toBe("19:00");
    expect(e.graph().edges.some((x) => x.relation === "supersedes")).toBe(true);
    e.ingest(u("u4", "caller", "はい、19時でお願いします。", 4000));
    expect(e.values().time).toBe("19:00");
  });

  it("parses day-only dates as the next occurrence and ignores durations", () => {
    expect(parseDates("14日でお願いします", NOW).map((d) => d.value)).toEqual(["2026-09-14"]);
    expect(parseDates("5日でお願いします", NOW).map((d) => d.value)).toEqual(["2026-10-05"]);
    expect(parseDates("3日間の滞在", NOW)).toEqual([]);
    expect(parseDates("2日後に", NOW)).toEqual([]);
    expect(parseDates("9月12日", NOW).map((d) => d.value)).toEqual(["2026-09-12"]);
  });
});

describe("confirmation is bound to the deal it confirmed", () => {
  it("re-agreeing a different price after the confirmation makes `confirmed` stale", () => {
    const e = new EvidenceEngine({ now: NOW });
    e.ingest(u("u1", "callee", "3個まとめてでしたら、1個5,500円でお出しできます。", 1000));
    e.ingest(u("u2", "caller", "では、5,500円でお願いします。", 2000));
    e.ingest(u("u3", "callee", "かしこまりました。3個、1個6,500円でご注文承りました。", 3000));
    expect(e.values().price).toBeUndefined(); // 5,500 agreed vs 6,500 confirmed: unsettled
    e.ingest(u("u4", "caller", "1個5,500円ではいかがでしょうか？", 4000));
    e.ingest(u("u5", "callee", "はい、1個5,500円で大丈夫です。", 5000));
    expect(e.values().price).toBe(5500);
    expect(e.values().confirmed, "confirmation was for 6,500").toBeUndefined();
    e.ingest(u("u6", "callee", "かしこまりました。1個5,500円でご注文承りました。", 6000));
    expect(e.values()).toMatchObject({ price: 5500, confirmed: true });
  });

  it("accepting the value the callee confirmed keeps the confirmation valid", () => {
    const e = new EvidenceEngine({ now: NOW });
    e.ingest(u("u1", "callee", "19時半でしたら空いております。", 1000));
    e.ingest(u("u2", "caller", "では、19時半でお願いします。", 2000));
    e.ingest(u("u3", "callee", "かしこまりました。19時でご予約承りました。", 3000));
    expect(e.values().time).toBeUndefined();
    e.ingest(u("u4", "caller", "はい、19時でお願いします。", 4000));
    expect(e.values()).toMatchObject({ time: "19:00", confirmed: true });
  });
});

describe("walking away is not acceptance", () => {
  it("does not verify an offer when the caller declines with わかりました", () => {
    const e = new EvidenceEngine({ now: NOW });
    e.ingest(u("u1", "callee", "21,100円でしたらご案内できます。いかがでしょうか？", 1000));
    e.ingest(u("u2", "caller", "わかりました。では、他のホテルを探させていただきます。ありがとうございました。", 2000));
    expect(e.values().price).toBeUndefined();
  });
  it("still verifies a genuine acceptance", () => {
    const e = new EvidenceEngine({ now: NOW });
    e.ingest(u("u1", "callee", "21,100円でしたらご案内できます。", 1000));
    e.ingest(u("u2", "caller", "わかりました、それでお願いします。", 2000));
    expect(e.values().price).toBe(21100);
  });
});

describe("confirmation by answering the caller's question", () => {
  it("verifies confirmed when the callee says yes to an explicit confirm question", () => {
    const e = new EvidenceEngine({ now: NOW });
    e.ingest(u("u1", "caller", "9月12日20時に2名で予約をお願いします。", 1000));
    e.ingest(u("u2", "callee", "はい、9月12日20時に2名様ですね。大丈夫です。", 2000));
    e.ingest(u("u3", "caller", "最終確認として、予約を確定してもよろしいでしょうか？", 3000));
    expect(e.values().confirmed).toBeUndefined();
    e.ingest(u("u4", "callee", "大丈夫ですよ。", 4000));
    expect(e.values().confirmed).toBe(true);
  });
  it("does not count an acknowledgement of a statement, a hedge, or a stale question", () => {
    const e = new EvidenceEngine({ now: NOW });
    e.ingest(u("u1", "caller", "では、その内容で予約をお願いします。", 1000));
    e.ingest(u("u2", "callee", "かしこまりました。", 2000));
    expect(e.values().confirmed).toBeUndefined();
    e.ingest(u("u3", "caller", "予約を確定してもよろしいでしょうか？", 3000));
    e.ingest(u("u4", "callee", "たぶん大丈夫だと思います。", 4000));
    expect(e.values().confirmed).toBeUndefined();
    e.ingest(u("u5", "caller", "ありがとうございます。", 5000));
    e.ingest(u("u6", "callee", "はい、大丈夫です。", 6000));
    expect(e.values().confirmed).toBeUndefined();
  });
});

describe("re-quote is not a yes", () => {
  it("does not confirm when the callee answers a confirm question by repeating the quote", () => {
    const e = new EvidenceEngine({ now: NOW });
    e.ingest(u("u1", "caller", "10月3日、2名様、禁煙のお部屋、朝食付きで1泊19,900円ですね。これでご予約を確定してもよろしいでしょうか？", 1000));
    e.ingest(u("u2", "callee", "10月3日、2名様ですね。禁煙のお部屋でしたらご用意できます。朝食付きで1泊19,900円でございます。", 2000));
    expect(e.values().confirmed).toBeUndefined();
    e.ingest(u("u3", "caller", "これでご予約を確定してもよろしいでしょうか？", 3000));
    e.ingest(u("u4", "callee", "はい、確定で大丈夫です。", 4000));
    expect(e.values().confirmed).toBe(true);
  });
});
