import { describe, expect, it } from "vitest";
import { defineCall } from "@oathra/contract";
import { EvidenceEngine } from "./engine.js";
import { evaluate } from "./evaluate.js";
import { kanjiToNumber, parseDates, parsePartySize, parsePrices, parseTimes } from "./normalize.js";
import { isAgreement, RETRACTION_RE, splitClauses } from "./extract.js";
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
  it("keeps the reported issue #8 ambiguous time unresolved", () => {
    // Exact transcript from the observed browser bug, not a fabricated call:
    // https://github.com/FORIFOR/oathra/issues/8
    const e = new EvidenceEngine({ now: NOW, language: "en" });
    const reported = [
      ["caller", "Hi, I'd like to book a table for two on September 12th, at 7 pm or later. Is that available?"],
      ["callee", "7 pm is full. 7:30 is open."],
      ["caller", "7:30 works, please."],
      ["callee", "Yes, you're booked for two at 7:30."],
    ] as const;
    for (const [i, [source, text]] of reported.entries()) e.ingest(u(`issue8-${i}`, source, text, i));
    const result = evaluate(defineCall({
      goal: "restaurant.reservation", language: "en",
      require: { date: true, time: true, partySize: true, confirmed: true },
      constraints: { time: { gte: "19:00" } },
    }), e, "completed");
    expect(result.status).toBe("incomplete");
    expect(result.fields.time).toBeUndefined();
    expect(result.missing).toContain("time");
    expect(result.constraints.violations).toEqual([]);
    expect(e.pending("time")?.note).toContain("ambiguous time");
    expect(e.all().filter((ev) => ev.field === "time" && ev.verified)).toEqual([]);
  });

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

describe("a retraction takes the confirmation back", () => {
  it("in the same breath: 「承りました。……やはりお取りできませんでした」 never produces `confirmed`", () => {
    const e = new EvidenceEngine({ now: NOW });
    e.ingest(u("u1", "caller", "9月12日の19時半に2名でお願いします。", 1000));
    e.ingest(u("u2", "callee", "かしこまりました。9月12日19時半、2名様でご予約承りました。 ……申し訳ございません、確認しましたところ、やはりそのお時間はお取りできませんでした。ご予約はお受けできません。", 2000));
    expect(e.values().confirmed).toBeUndefined();
    expect(e.all().some((n) => n.field === "confirmed" && n.verified)).toBe(false);
  });

  it("on the next turn: the earlier confirmation is revoked, a later one counts again", () => {
    const e = new EvidenceEngine({ now: NOW });
    e.ingest(u("u1", "caller", "9月12日の19時半に2名でお願いします。", 1000));
    e.ingest(u("u2", "callee", "かしこまりました。9月12日19時半、2名様でご予約承りました。", 2000));
    expect(e.values().confirmed).toBe(true);
    e.ingest(u("u3", "callee", "申し訳ございません、やはりそのお時間はお取りできませんでした。", 3000));
    expect(e.values().confirmed).toBeUndefined();
    e.ingest(u("u4", "callee", "20時でしたらご用意できます。", 4000));
    e.ingest(u("u5", "caller", "では、20時でお願いします。", 5000));
    e.ingest(u("u6", "callee", "かしこまりました。20時に2名様でご予約承りました。", 6000));
    expect(e.values()).toMatchObject({ time: "20:00", confirmed: true });
  });

  it("english: \"you're all set … we can't take that reservation after all\" is not confirmed", () => {
    const e = new EvidenceEngine({ now: NOW, language: "en" });
    e.ingest(u("u1", "caller", "A table for two on September 12th at 7:30 pm, please.", 1000));
    e.ingest(u("u2", "callee", "Perfect. September 12 at 7:30 pm, party of 2 — you're all set. Sorry, I've just checked and we can't take that reservation after all.", 2000));
    expect(e.values().confirmed).toBeUndefined();
  });
});

describe("asking back is not agreement", () => {
  it("「…で合っておりますでしょうか？」 does not verify the caller's serial", () => {
    expect(isAgreement("はい、R、Z、7、K、3、Q、9、1、X、A、で合っておりますでしょうか？", "callee")).toBe(false);
    expect(isAgreement("はい、R、Z、7、K、3、Q、9、1、X、A、で合っております。", "callee")).toBe(true);
    expect(RETRACTION_RE.test("ご予約はお受けできません")).toBe(true);
    expect(RETRACTION_RE.test("19時はいっぱいですが19時半なら空いております")).toBe(false);
  });
});

describe("dialect confirmations", () => {
  it("「19時半に2名さんで取っといたで」 is a confirmation; 「取っとくわ」 (future) is only a commitment", () => {
    const e = new EvidenceEngine({ now: NOW });
    e.ingest(u("u1", "caller", "9月12日の19時半に2名でお願いします。", 1000));
    e.ingest(u("u2", "callee", "ほな、9月12日の19時半に2名さんで取っといたで。", 2000));
    expect(e.values()).toMatchObject({ time: "19:30", partySize: 2, confirmed: true });
    const f = new EvidenceEngine({ now: NOW });
    f.ingest(u("u1", "caller", "9月12日の19時半に2名でお願いします。", 1000));
    f.ingest(u("u2", "callee", "ほな、19時半に2名さんで取っとくわ。", 2000));
    expect(f.values().confirmed).toBeUndefined();
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

describe("serial extraction precision", () => {
  it("ignores product names that merely look like serials", () => {
    const e = new EvidenceEngine({ language: "ja" });
    const r = e.ingest({ id: "c0", source: "callee", text: "お電話ありがとうございます、ホテル・リンゴ（openai:gpt-4o-mini）でございます。", t: 0 });
    expect(r.created.filter((c) => c.field === "serial")).toHaveLength(0);
  });
  it("keeps serials that are announced or spelled out", () => {
    const e = new EvidenceEngine({ language: "ja" });
    expect(e.ingest({ id: "c1", source: "callee", text: "シリアル番号はRZ7K3Q91XAです。", t: 0 }).created.some((c) => c.field === "serial" && c.value === "RZ7K3Q91XA")).toBe(true);
    expect(e.ingest({ id: "c2", source: "callee", text: "R、Z、7、K、3、Q、9、1、X、A、です。", t: 1 }).created.some((c) => c.field === "serial" && c.value === "RZ7K3Q91XA")).toBe(true);
  });
});

describe("a refusal that quotes the number is not an offer", () => {
  it("does not let the caller accept a price the callee just declined", () => {
    const e = new EvidenceEngine({ language: "ja" });
    e.ingest({ id: "a0", source: "caller", text: "予算が5,500円なのですが、5,500円以内になりませんでしょうか？", t: 0 });
    const r1 = e.ingest({ id: "c1", source: "callee", text: "申し訳ありませんが、ワイヤレスイヤホンは3個で5,500円にはなりません。", t: 1 });
    expect(r1.created.filter((c) => c.field === "price")).toHaveLength(0);
    const r2 = e.ingest({ id: "a1", source: "caller", text: "では、5,500円でお願いします。", t: 2 });
    expect(r2.verified.filter((c) => c.field === "price")).toHaveLength(0);
    const r3 = e.ingest({ id: "c2", source: "callee", text: "6,000円でしたらご提供できかねますが、6,500円ならご用意できます。", t: 3 });
    expect(r3.created.filter((c) => c.field === "price").map((c) => c.value)).toEqual([6500]);
  });
});

describe("natural confirmations", () => {
  const conf = (text: string) => new EvidenceEngine({ language: "ja", now: new Date("2026-09-11T10:00:00+09:00") }).ingest({ id: "c", source: "callee", text, t: 0 }).verified.some((e) => e.field === "confirmed" && e.value === true);
  it("accepts past-tense bookings", () => {
    expect(conf("田中様、9月12日の19時30分に2名でご予約いたしました。")).toBe(true);
    expect(conf("2名様で19時半、手配いたしました。")).toBe(true);
    expect(conf("19時半で2名様、お席を押さえました。")).toBe(true);
  });
  it("treats a present-tense commitment as an intention unless it answers the caller's confirmation question", () => {
    expect(conf("佐藤様、10月3日に2名様で朝食付き・禁煙のお部屋を19,800円でご予約いたします。")).toBe(false);
    const e = new EvidenceEngine({ language: "ja", now: new Date("2026-09-11T10:00:00+09:00") });
    e.ingest({ id: "a0", source: "caller", text: "では、10月3日、2名、朝食付き禁煙で19,800円、ご予約を確定してもよろしいでしょうか？", t: 0 });
    const r = e.ingest({ id: "c0", source: "callee", text: "はい、10月3日に2名様で朝食付き・禁煙のお部屋を19,800円でご予約いたします。", t: 1 });
    expect(r.verified.some((x) => x.field === "confirmed")).toBe(true);
    const e2 = new EvidenceEngine({ language: "ja" });
    e2.ingest({ id: "a0", source: "caller", text: "ご予約を確定してもよろしいでしょうか？", t: 0 });
    expect(e2.ingest({ id: "c0", source: "callee", text: "それでは、ご予約いたします。お名前を教えていただけますか？", t: 1 }).verified.some((x) => x.field === "confirmed")).toBe(false);
  });
  it("does not count questions, hedges or echo traps", () => {
    expect(conf("ご予約内容を確認いたします。")).toBe(false);
    expect(conf("19時半で2名様、ご予約いたしますか？")).toBe(false);
    expect(conf("たぶん19時半で2名様、ご予約いたしました。")).toBe(false);
    expect(conf("ご予約できましたね？よろしいでしょうか？")).toBe(false);
  });
});

describe("agreements", () => {
  it("verifies a serial when the callee says the read-back is right", () => {
    const e = new EvidenceEngine({ language: "ja" });
    e.ingest({ id: "c0", source: "callee", text: "シリアル番号はRZ7K3Q91XAです。", t: 0 });
    e.ingest({ id: "a0", source: "caller", text: "復唱いたします。R、Z、7、K、3、Q、9、1、X、A、でよろしいでしょうか？", t: 1 });
    const r = e.ingest({ id: "c1", source: "callee", text: "はい、それで正しいです。シリアル番号はRZ7K3Q91XAです。", t: 2 });
    expect(r.verified.some((x) => x.field === "serial" && x.value === "RZ7K3Q91XA")).toBe(true);
  });
  it("does not settle a value from an acknowledgement that goes on with a contrast", () => {
    const e = new EvidenceEngine({ language: "ja" });
    e.ingest({ id: "a0", source: "caller", text: "予算が5,500円なのですが、5,500円以内になりませんでしょうか？", t: 0 });
    const r = e.ingest({ id: "c0", source: "callee", text: "ご予算について承知いたしました。お値段は少し調整可能ですが、3個購入の場合はもう少しお高くなります。", t: 1 });
    expect(r.verified.filter((x) => x.field === "price")).toHaveLength(0);
    const e2 = new EvidenceEngine({ language: "ja" });
    e2.ingest({ id: "a0", source: "caller", text: "では、19時半でお願いします。", t: 0 });
    expect(e2.ingest({ id: "c0", source: "callee", text: "承知いたしました。", t: 1 }).verified.some((x) => x.field === "time" && x.value === "19:30")).toBe(true);
  });
});

describe("English restaurant flow", () => {
  it("verifies the offered slot on acceptance and completes on the callee's confirmation", () => {
    const e = new EvidenceEngine({ language: "en", now: new Date("2026-09-11T10:00:00+09:00") });
    e.ingest({ id: "a0", source: "caller", text: "Hi, I'd like to book a table for 2 on September 12, 7 pm or later. Do you have anything available?", t: 0 });
    const r1 = e.ingest({ id: "c1", source: "callee", text: "7 pm is fully booked, but we do have 7:30 pm. Would that work?", t: 1 });
    expect(r1.created.some((x) => x.field === "time" && x.value === "19:30")).toBe(true);
    expect(r1.created.some((x) => x.field === "time" && x.value === "19:00")).toBe(false);
    const r2 = e.ingest({ id: "a1", source: "caller", text: "That works. Let's go with 7:30 pm, please.", t: 2 });
    expect(r2.verified.some((x) => x.field === "time" && x.value === "19:30")).toBe(true);
    e.ingest({ id: "c2", source: "callee", text: "Certainly. May I have a name for the reservation?", t: 3 });
    e.ingest({ id: "a2", source: "caller", text: "It's under Tanaka.", t: 4 });
    const r3 = e.ingest({ id: "c3", source: "callee", text: "Perfect. September 12 at 7:30 pm, party of 2 under Tanaka — you're all set. We'll see you then.", t: 5 });
    expect(r3.verified.some((x) => x.field === "confirmed" && x.value === true)).toBe(true);
    expect(r3.verified.some((x) => x.field === "partySize" && x.value === 2) || r3.created.some((x) => x.field === "partySize")).toBe(true);
  });
});

describe("breakfast polarity", () => {
  const claim = (text: string) => new EvidenceEngine({ language: "ja" }).ingest({ id: "c", source: "callee", text, t: 0 }).created.filter((e) => e.field === "breakfast").map((e) => e.value);
  it("does not read a negated phrase as breakfast included", () => {
    expect(claim("最低価格の18,800円で朝食は含まれませんが、禁煙のお部屋をご用意できます。")).toEqual([false]);
    expect(claim("朝食は付いておりません。")).toEqual([false]);
    expect(claim("朝食なしの禁煙のお部屋を18,800円でお取りいたします。")).toEqual([false]);
  });
  it("still reads the positive forms", () => {
    expect(claim("はい、朝食は含まれております。")).toEqual([true]);
    expect(claim("朝食付きで19,900円でご案内できます。")).toEqual([true]);
    expect(claim("朝食は付いております。")).toEqual([true]);
  });
});

describe("the slot is gone after the booking was taken", () => {
  const contract = defineCall({ goal: "restaurant.reservation", language: "ja", input: { date: "2026-09-25", partySize: 2 }, require: { date: true, time: true, partySize: true, confirmed: true }, permissions: { ask: true, reserve: true } });
  const verdict = (lines: Utterance["source"] extends never ? never : [Utterance["source"], string][]) => {
    const engine = new EvidenceEngine({ now: new Date("2026-09-21T10:00:00+09:00"), language: "ja" });
    lines.forEach(([source, text], i) => engine.ingest({ id: `t${i}`, source, text, t: i + 1 }));
    return evaluate(contract, engine, "completed");
  };
  const booked: Utterance["source"] extends never ? never : [Utterance["source"], string][] = [["caller", "9月25日の19時半に2名でお願いします。田中と申します。"], ["callee", "9月25日19時半、2名様、田中様でご予約承りました。"]];

  it("takes the booking back: the table cannot be both held and 貸切/満席", () => {
    for (const taken of ["あ、失礼しました、その日は貸切でした。お受けできません。", "申し訳ありません、その時間は満席になってしまいました。", "すみません、その日は定休日でした。"]) {
      const r = verdict([...booked, ["callee", taken]]);
      expect(r.fields.confirmed, taken).toBeUndefined();
      expect(r.complete, taken).toBe(false);
    }
  });

  it("keeps the booking when the same words are about something else, or came before it", () => {
    // A payment or policy remark is not a cancellation.
    expect(verdict([...booked, ["callee", "恐れ入りますが、クレジットカードはお受けできません。"]]).fields.confirmed).toBe(true);
    // The ordinary flow: the first choice was full, the offered one was booked.
    expect(verdict([["caller", "9月25日の19時に2名でお願いします。田中と申します。"], ["callee", "19時は満席ですが、19時半でしたら空いております。"], ["caller", "では19時半でお願いします。"], ["callee", "9月25日19時半、2名様、田中様でご予約承りました。"]]).fields.confirmed).toBe(true);
    // Pre-existing conservative rule, unchanged here: a confirmation sharing an utterance with a refusal
    // clause is not counted at all, so the same sentence is incomplete with or without the availability word.
    for (const oneBreath of ["19時は満席ですが、19時半でしたらご予約承りました。", "19時はご用意できませんが、19時半でしたらご予約承りました。"]) {
      expect(verdict([["caller", "9月25日の19時に2名でお願いします。田中と申します。"], ["callee", oneBreath]]).fields.confirmed, oneBreath).toBeUndefined();
    }
  });
});
