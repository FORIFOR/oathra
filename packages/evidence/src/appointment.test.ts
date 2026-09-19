import { describe, expect, it } from "vitest";
import { defineCall } from "@oathra/contract";
import { EvidenceEngine, evaluate, type ConfirmationMode } from "./index.js";

const NOW = new Date(2026, 8, 19, 10);
const meeting = defineCall({ goal: "sales.meeting", language: "ja", require: { date: true, time: true, confirmed: true }, confirmation: "callee_acceptance" });
const PROPOSAL = "9月25日の15時から15分、商談のお時間をいただけますか。";

type Line = ["caller" | "callee", string];

function run(lines: Line[], confirmation: ConfirmationMode = "callee_acceptance", language: "ja" | "en" = "ja") {
  const engine = new EvidenceEngine({ language, now: NOW, confirmation });
  lines.forEach(([source, text], i) => engine.ingest({ id: `u${i}`, source, text, t: (i + 1) * 1000 }));
  return evaluate({ ...meeting, language }, engine, "completed");
}

const afterProposal = (reply: string) => run([["caller", PROPOSAL], ["callee", reply]]);

describe("appointment confirmation (callee_acceptance)", () => {
  it.each([
    "はい、9月25日の15時でお願いします。",
    "9月25日の15時で大丈夫です。",
    "はい、それで結構です。9月25日の15時でお願いします。",
    "承知しました。9月25日の15時にお待ちしております。",
    "かしこまりました。",
    "はい。",
  ])("completes on a clean commitment: %s", (reply) => {
    const r = afterProposal(reply);
    expect(r.status).toBe("completed");
    expect(r.fields).toMatchObject({ date: "2026-09-25", time: "15:00", confirmed: true });
  });

  // Each of these was reported COMPLETED by the gateway's own regex verdict on 2026-09-19.
  it.each([
    ["busy at that time", "ご用件は承知しました。ただ9月25日の15時は別の会議が入っています。"],
    ["needs the boss", "9月25日の15時ですね、承知しました、上司に聞いてから折り返します。"],
    ["conditional", "9月25日の15時でお願いします、と言いたいところですが、その日は出張です。"],
    ["email first", "9月25日の15時の件は承知しました。まずメールで詳細を送ってもらえますか。それから判断します。"],
    ["dialect hedge", "9月25日の15時なあ、まあ大丈夫ですやろけど、約束はできまへんで。"],
  ])("does not complete: %s", (_name, reply) => {
    const r = afterProposal(reply);
    expect(r.complete).toBe(false);
    expect(r.fields.confirmed).toBeUndefined();
    // The slot itself must not look settled either.
    expect(r.fields.date).toBeUndefined();
    expect(r.fields.time).toBeUndefined();
  });

  it.each([
    "来週なら大丈夫かもしれません。",
    "9月25日15時ならたぶん大丈夫です。",
    "9月25日15時で仮押さえをお願いします。",
    "9月25日15時でお願いしますか？",
    "9月25日15時は無理です。",
    "9月25日の15時は先約があります。",
    "その日は予定が入っております。",
    "検討します。",
    "社内で相談してからお返事します。",
    "資料を送ってください。",
    "9月25日の15時ですか？",
    "結構です。",
    "興味がありません。",
  ])("does not complete: %s", (reply) => {
    expect(afterProposal(reply).complete).toBe(false);
  });

  it("never lets the caller certify the meeting", () => {
    expect(run([["caller", "9月25日15時で確定です。ありがとうございます。"]]).complete).toBe(false);
    expect(run([["caller", PROPOSAL], ["caller", "では9月25日の15時でお願いします。"]]).complete).toBe(false);
  });

  it("a bare yes answers only the turn right before it", () => {
    const r = run([["caller", PROPOSAL], ["callee", "少々お待ちください。"], ["caller", "はい、お待ちします。"], ["callee", "はい。"]]);
    expect(r.complete).toBe(false);
  });

  it("a greeting is not a commitment", () => {
    expect(run([["callee", "はい、田中です。"], ["caller", PROPOSAL]]).complete).toBe(false);
  });

  it("a counter-proposal completes only after the caller accepts it", () => {
    const counter: Line[] = [["caller", PROPOSAL], ["callee", "9月26日の16時でお願いします。"]];
    expect(run(counter).complete).toBe(false);
    const accepted = run([...counter, ["caller", "承知しました。9月26日の16時でお願いします。"]]);
    expect(accepted.status).toBe("completed");
    expect(accepted.fields).toMatchObject({ date: "2026-09-26", time: "16:00", confirmed: true });
  });

  it("a later cancellation or change takes the commitment back", () => {
    const agreed: Line[] = [["caller", PROPOSAL], ["callee", "はい、9月25日の15時でお願いします。"]];
    expect(run([...agreed, ["callee", "すみません、やはりキャンセルしてください。"]]).complete).toBe(false);
    expect(run([...agreed, ["callee", "あ、やはり9月26日にしてください。"]]).complete).toBe(false);
  });

  it("an ambiguous clock time is not a slot", () => {
    const r = run([["caller", "Could we meet on September 25 at 3 pm?"], ["callee", "Sure, 3:30 works for me."]], "callee_acceptance", "en");
    expect(r.complete).toBe(false);
  });

  it("works in English", () => {
    const ask: Line = ["caller", "Could we meet on September 25 at 3 pm for fifteen minutes?"];
    expect(run([ask, ["callee", "Yes, September 25 at 3 pm works for me."]], "callee_acceptance", "en").status).toBe("completed");
    expect(run([ask, ["callee", "I already have a meeting then, but sure, send me the deck."]], "callee_acceptance", "en").complete).toBe(false);
    expect(run([ask, ["callee", "Sounds good, but I need to check with my manager first."]], "callee_acceptance", "en").complete).toBe(false);
  });
});

describe("appointment confirmation: agreement words next to a spoiler never complete", () => {
  const agreements = ["承知しました", "かしこまりました", "大丈夫です", "はい、お願いします", "9月25日の15時でお願いします", "9月25日の15時で大丈夫です", "了解です", "問題ございません"];
  const spoilers = [
    "ただ9月25日の15時は別の会議が入っています",
    "9月25日は出張です",
    "その時間は先約があります",
    "上司に聞いてから折り返します",
    "社内で相談してからお返事します",
    "一度持ち帰らせてください",
    "検討します",
    "たぶんですが",
    "まだ確定ではありません",
    "仮押さえでお願いします",
    "約束はできません",
    "やはりキャンセルしてください",
    "それから判断します",
    "9月25日の15時は無理です",
  ];
  for (const a of agreements) {
    for (const sp of spoilers) {
      it(`${a} + ${sp}`, () => {
        expect(afterProposal(`${a}。${sp}。`).complete).toBe(false);
        expect(afterProposal(`${sp}。${a}。`).complete).toBe(false);
      });
    }
  }
});

describe("reservation contracts are unchanged by the appointment rule", () => {
  it("a shop's polite acceptance is still not a confirmation by default", () => {
    const r = run([["caller", "9月25日の15時に2名で予約をお願いします。"], ["callee", "はい、9月25日の15時で大丈夫です。"]], "callee_statement");
    expect(r.fields.confirmed).toBeUndefined();
    expect(r.complete).toBe(false);
  });

  it("scheduling conflicts no longer settle a proposed value in any mode", () => {
    const r = run([["caller", PROPOSAL], ["callee", "承知しました。ただ9月25日の15時は別の会議が入っています。"]], "callee_statement");
    expect(r.fields.date).toBeUndefined();
    expect(r.fields.time).toBeUndefined();
  });
});
