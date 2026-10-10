import { describe, expect, it } from "vitest";
import { definePhoneRequest, preparePhoneRequest } from "@oathra/contract";
import { EvidenceEngine, evaluate, extractClaims, parseDates, parsePartySize, parsePrices, parseQuantities, parseTimes } from "./index.js";

const NOW = new Date(2026, 9, 2, 12);
const values = (text: string) => parseQuantities(text).map((q) => q.value);

describe("parseQuantities", () => {
  it.each([
    ["A-100を50ケース、10月20日納品でお願いできますか", ["50ケース"]],
    ["５０ケース", ["50ケース"]],
    ["50ｹｰｽ", ["50ケース"]],
    ["50 ケース", ["50ケース"]],
    ["五十ケース", ["50ケース"]],
    ["二十五本", ["25本"]],
    ["2万5千個", ["25000個"]],
    ["三千枚", ["3000枚"]],
    ["1,200枚", ["1200枚"]],
    ["1.5トン", ["1.5t"]],
    ["2t", ["2t"]],
    ["20kg", ["20kg"]],
    ["20 ㎏", ["20kg"]],
    ["20キロ", ["20kg"]],
    ["20キログラム", ["20kg"]],
    ["500グラム", ["500g"]],
    ["500g", ["500g"]],
    ["18リットル", ["18L"]],
    ["18L", ["18L"]],
    ["30メートル", ["30m"]],
    ["30m", ["30m"]],
    ["12箱", ["12箱"]],
    ["3台", ["3台"]],
    ["10袋", ["10袋"]],
    ["24缶", ["24缶"]],
    ["5束", ["5束"]],
    ["2セット", ["2セット"]],
    ["3ダース", ["3ダース"]],
    ["6パック", ["6パック"]],
    ["100点", ["100点"]],
    ["40冊", ["40冊"]],
    ["8着", ["8着"]],
    ["10足", ["10足"]],
    ["4脚", ["4脚"]],
    ["2基", ["2基"]],
    ["一式", ["1式"]],
    ["3ロット", ["3ロット"]],
    ["2反", ["2反"]],
    ["30俵", ["30俵"]],
    ["豆腐40丁", ["40丁"]],
    ["四十丁", ["40丁"]],
    ["5梱包", ["5梱包"]],
    ["5梱", ["5梱包"]],
    ["50 units", ["50units"]],
    ["200 pieces", ["200pieces"]],
    ["12 pcs please", ["12pieces"]],
    ["50 cases", ["50cases"]],
    ["1 case", ["1cases"]],
    ["40 boxes", ["40boxes"]],
    ["6 cartons", ["6cartons"]],
    ["2 pallets", ["2pallets"]],
  ])("accepts %s", (text, expected) => {
    expect(values(text)).toEqual(expected);
  });

  it("keeps amount and unit apart for callers that need them", () => {
    expect(parseQuantities("50ケース")[0]).toMatchObject({ value: "50ケース", amount: 50, unit: "ケース", span: "50ケース" });
  });

  it("equal only when both the amount and the unit match; no unit conversion", () => {
    expect(values("50ケース")[0]).toBe(values("五十ｹｰｽ")[0]);
    expect(values("50ケース")[0]).not.toBe(values("40ケース")[0]);
    expect(values("50ケース")[0]).not.toBe(values("50箱")[0]);
    expect(values("1ダース")[0]).not.toBe(values("12個")[0]);
    expect(values("1000g")[0]).not.toBe(values("1kg")[0]);
  });

  it.each([
    // a bare number, and the generic counter つ, carry no unit
    "50", "50でお願いします", "1つ", "ひとつ", "二つ", "3つお願いします",
    // people, money, dates, times, ordinals, rates
    "3名", "4人", "2名様", "8,800円", "2万5千円", "10月20日", "3日", "2時間", "19時", "30分", "2階", "3番", "第2", "1回", "2週間", "5%", "19:30",
    // model numbers and codes
    "A-100", "A-100を", "型番ABC123", "注文番号 4567", "RZ-7K3Q", "03-1234-5678", "ABC123個", "A-50ケース",
    // a unit character inside another word
    "本日3本目", "2台目です", "3個人", "5本社", "2点確認させてください", "1点ご質問があります", "3点ほど確認です", "台数は未定です", "3丁目", "銀座四丁目", "八丁堀", "八丁味噌", "5キロメートル", "3トンネル", "5G回線", "5mm", "at 5 tomorrow", "table for 4 tomorrow", "7 pm",
    // unit prices and pack sizes describe the goods, not how many are ordered
    "1個2,000円", "1ケースあたり", "1箱につき", "24本入り", "1個ずつ",
    // zero is not an order
    "0個",
  ])("rejects %s", (text) => {
    expect(values(text)).toEqual([]);
  });

  it("a pack size next to the ordered quantity leaves the order", () => {
    expect(values("24本入りを50ケース")).toEqual(["50ケース"]);
    expect(values("1個2,000円で50個")).toEqual(["50個"]);
  });

  it("does not take anything away from the other parsers", () => {
    const text = "10月20日の19時に3名、8,800円のコースをビール2本付きでお願いします。";
    expect(parseDates(text, NOW).map((d) => d.value)).toEqual(["2026-10-20"]);
    expect(parseTimes(text).map((t) => t.value)).toEqual(["19:00"]);
    expect(parsePartySize(text).map((p) => p.value)).toEqual([3]);
    expect(parsePrices(text).map((p) => p.value)).toEqual([8800]);
    expect(values(text)).toEqual(["2本"]);
    for (const other of ["3名", "4人", "2名様"]) expect(parsePartySize(other)).toHaveLength(1);
    for (const other of ["8,800円", "2万5千円"]) expect(parsePrices(other)).toHaveLength(1);
  });
});

describe("quantity claims", () => {
  const claims = (text: string, source: "caller" | "callee" = "callee") =>
    extractClaims({ id: "u", source, text, t: 0 }, { now: NOW, language: "ja" }).filter((c) => c.field === "quantity");

  it("a stated quantity is a positive claim", () => {
    expect(claims("A-100を50ケース、10月20日納品でお願いできますか。", "caller")).toMatchObject([{ value: "50ケース", polarity: "positive", span: "50ケース" }]);
  });
  it("a refused quantity is negative", () => {
    expect(claims("50ケースは難しいです。")).toMatchObject([{ value: "50ケース", polarity: "negative" }]);
    expect(claims("50ケースはご用意できません。")).toMatchObject([{ value: "50ケース", polarity: "negative" }]);
  });
  it("a refusal and a counter-offer are split by clause", () => {
    expect(claims("50ケースは難しいですが、30ケースならご用意できます。")).toMatchObject([{ value: "50ケース", polarity: "negative" }, { value: "30ケース", polarity: "positive" }]);
  });
  it("a correction keeps both; the engine takes the last", () => {
    expect(claims("50ケース…いえ、40ケースです。").map((c) => c.value)).toEqual(["50ケース", "40ケース"]);
  });
  it("other fields in the same sentence are untouched", () => {
    const all = extractClaims({ id: "u", source: "callee", text: "3名様、8,800円、10月20日の19時、ビール2本ですね。", t: 0 }, { now: NOW, language: "ja" });
    expect(Object.fromEntries(all.map((c) => [c.field, c.value]))).toEqual({ partySize: 3, price: 8800, date: "2026-10-20", time: "19:00", quantity: "2本" });
  });
});

describe("evaluate: an order for a quantity", () => {
  const request = (required: Array<"quantity" | "date" | "confirmed">, expected: { quantity?: string; date?: string }) =>
    definePhoneRequest(preparePhoneRequest({ phone: "+819000000000", name: "仕入先", instruction: "A-100を50ケース、10月20日納品でお願いできるか確認してください。", success: { required, expected } }));
  const order = request(["quantity", "date", "confirmed"], { quantity: "50ケース", date: "2026-10-20" });
  const ASK = "A-100を50ケース、10月20日納品でお願いできますか。";
  type Line = ["caller" | "callee", string];
  const run = (lines: Line[], contract = order) => {
    const engine = new EvidenceEngine({ language: "ja", now: NOW, ...(contract.confirmation ? { confirmation: contract.confirmation } : {}) });
    lines.forEach(([source, text], i) => engine.ingest({ id: `u${i}`, source, text, t: (i + 1) * 1000 }));
    return evaluate(contract, engine, "completed");
  };
  const reply = (text: string, contract = order) => run([["caller", ASK], ["callee", text]], contract);

  it("the contract requires and constrains the quantity like the other fields", () => {
    expect(order.require).toEqual({ quantity: true, date: true, confirmed: true });
    expect(order.constraints).toEqual({ quantity: { eq: "50ケース" }, date: { eq: "2026-10-20" } });
    expect(order.confirmation).toBe("callee_acceptance");
  });

  it.each([
    "はい、50ケース、10月20日納品で大丈夫です。",
    "50ケース、10月20日納品で承りました。",
    "承知しました。五十ケースを10月20日にお届けします。",
    "はい、50ｹｰｽ、10月20日で問題ありません。",
    "かしこまりました。",
    "はい。",
  ])("the supplier's own words settle it: %s", (text) => {
    const r = reply(text);
    expect(r.status).toBe("completed");
    expect(r.fields).toMatchObject({ quantity: "50ケース", date: "2026-10-20", confirmed: true });
    expect(r.evidence.some((e) => e.field === "quantity" && e.source === "callee" && e.verified)).toBe(true);
  });

  it.each([
    ["a different amount", "はい、40ケース、10月20日納品で大丈夫です。", "40ケース"],
    ["a different unit", "はい、50箱、10月20日納品で大丈夫です。", "50箱"],
    ["a partial amount", "30ケースなら大丈夫です。", "30ケース"],
    ["a correction takes the last", "50ケース…いえ、40ケースで大丈夫です。", "40ケース"],
  ])("%s is not the order: incomplete, then a reported violation once accepted", (_name, text, said) => {
    const r = reply(text);
    expect(r.complete).toBe(false);
    expect(r.fields.quantity).toBeUndefined();
    expect(r.missing).toContain("quantity");
    // Even if the caller goes along with it, the request asked for 50ケース.
    const accepted = run([["caller", ASK], ["callee", text], ["caller", `承知しました。${said}でお願いします。`]]);
    expect(accepted.complete).toBe(false);
    expect(accepted.status).toBe("constraint_violation");
    expect(accepted.constraints.violations).toContainEqual({ field: "quantity", rule: "eq", expected: "50ケース", actual: said });
  });

  it("without an expected quantity the accepted counter-offer is what gets reported", () => {
    const open = request(["quantity", "date", "confirmed"], {});
    const r = run([["caller", ASK], ["callee", "30ケースなら大丈夫です。"], ["caller", "承知しました。30ケースでお願いします。"]], open);
    expect(r.status).toBe("completed");
    expect(r.fields.quantity).toBe("30ケース");
  });

  it.each([
    "50ケースはたぶん大丈夫だと思います。",
    "50ケース、10月20日ですね。在庫を確認してから折り返します。",
    "50ケースですか？",
    "50ケース、10月20日納品でよろしいでしょうか？",
    "50ケースは難しいです。",
    "50ケースはご用意できません。",
    "50ケースは難しいですが、30ケースならご用意できます。",
    "はい、少々お待ちください。",
    "検討します。",
    "お断りします。",
  ])("a hedge, a question, a hold or a refusal settles nothing: %s", (text) => {
    const r = reply(text);
    expect(r.complete).toBe(false);
    expect(r.fields.quantity).toBeUndefined();
    expect(r.fields.confirmed).toBeUndefined();
  });

  it("a quantity only echoed as a question is not confirmed by the caller's own yes", () => {
    const r = run([["caller", ASK], ["callee", "50ケース、10月20日ですか？"], ["caller", "はい、50ケース、10月20日でお願いします。"]]);
    expect(r.complete).toBe(false);
    expect(r.missing).toContain("confirmed");
  });

  it("the caller can never certify the order", () => {
    expect(run([["caller", ASK], ["caller", "では50ケース、10月20日納品で確定とさせていただきます。"]]).complete).toBe(false);
  });

  it("quantity confirmed but the date not: incomplete", () => {
    const moved = reply("はい、50ケースは大丈夫です。ただ10月20日は難しいです。");
    expect(moved.complete).toBe(false);
    const other = reply("はい、50ケース、10月21日納品で大丈夫です。");
    expect(other.complete).toBe(false);
    expect(other.fields.quantity).toBe("50ケース");
    expect(other.missing).toContain("date");
    const onlyQuantity = run([["caller", "A-100を50ケースお願いできますか。"], ["callee", "はい、50ケースで大丈夫です。"]]);
    expect(onlyQuantity.complete).toBe(false);
    expect(onlyQuantity.fields.quantity).toBe("50ケース");
    expect(onlyQuantity.missing).toEqual(expect.arrayContaining(["date"]));
  });

  it("date confirmed but the quantity not: incomplete", () => {
    const r = reply("10月20日納品は大丈夫です。数量は確認してから折り返します。");
    expect(r.complete).toBe(false);
  });

  it("a later change of the quantity takes the settled one back", () => {
    const r = run([["caller", ASK], ["callee", "はい、50ケース、10月20日納品で大丈夫です。"], ["callee", "すみません、40ケースになります。"]]);
    expect(r.complete).toBe(false);
  });

  it("a call that speaks of a time still needs the whole slot before a commitment confirms", () => {
    // The delivery time is on the table and unsettled, so a yes to the quantity and the day is not yet the order.
    const r = run([["caller", ASK], ["callee", "お届けは14時ごろになりますが、よろしいですか？"], ["caller", "確認いたします。"], ["callee", "50ケース、10月20日で大丈夫です。"]]);
    expect(r.fields.confirmed).toBeUndefined();
    expect(r.complete).toBe(false);
  });
});
