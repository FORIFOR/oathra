import { describe, expect, it } from "vitest";
import { definePhoneRequest, preparePhoneRequest } from "@oathra/contract";
import { callInstructions, decisionEvent, delegatedScope, recordsDecisions } from "./index.js";

const scoped = "10月3日の19時に2名で予約を取ってほしい。\n\n【任せる範囲】\nその場で決めてよい：時間は第一希望から2時間以内、席の種類はどれでも\n決めずに持ち帰る（相手に「確認して折り返します」と伝える）：日付を変える案\nしない：支払い・カード番号を伝える、AIであることを隠す";
const contract = (instruction: string) => definePhoneRequest(preparePhoneRequest({ phone: "+819012345678", name: "焼肉 たけ", instruction }));

describe("任せる範囲 and record_decision", () => {
  it("reads the scope the app writes, and only a request with something to decide gets the tool", () => {
    expect(delegatedScope(contract(scoped))).toEqual({ ok: ["時間は第一希望から2時間以内", "席の種類はどれでも"], hold: ["日付を変える案"] });
    expect(recordsDecisions(contract(scoped))).toBe(true);
    expect(recordsDecisions(contract("10月3日の19時に2名で予約を取ってほしい。"))).toBe(false);
    expect(recordsDecisions(contract(scoped.replace(/その場で決めてよい：.*\n/, "")))).toBe(false);
  });
  it("tells the model to record decisions only where the tool exists, and to bring the rest back", () => {
    const text = callInstructions({ contract: contract(scoped) });
    expect(text).toContain("record_decision");
    expect(text).toContain("確認して折り返します");
    expect(callInstructions({ contract: contract("近況を聞いて") })).not.toContain("record_decision");
  });
  it("keeps a decision short and drops an empty one", () => {
    expect(decisionEvent({ decision: "  19時が満席なので20時半にしました ", within: "時間は第一希望から2時間以内" })).toEqual({ type: "decision.made", decision: "19時が満席なので20時半にしました", within: "時間は第一希望から2時間以内" });
    expect(decisionEvent({ decision: "   " })).toBeUndefined();
    expect(decisionEvent({ decision: "あ".repeat(500) })!.decision).toHaveLength(200);
  });
});
