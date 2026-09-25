import { describe, expect, it } from "vitest";
import { defineCall } from "@oathra/contract";
import { GOODBYE_RE, OpenAILiveAgent } from "./live.js";
import { extractCallerName } from "@oathra/voice-kit";

// Exercise actual instruction generation only; constructors do not open sockets.
describe("reviewed phone message voice instructions", () => {
  for (const Agent of [OpenAILiveAgent]) {
    it(`${Agent.name} carries the request and identifies the AI without reservation or friend impersonation rules`, () => {
      const contract = defineCall({ goal: "phone.message", language: "ja", input: { request: "到着時刻を確認してください。" }, permissions: { ask: true } });
      const instructions = new Agent({ contract }).instructions();
      expect(instructions).toContain(contract.input.request);
      expect(instructions).toContain("最初にAIによる代理電話");
      expect(instructions).toContain("相手が断る");
      expect(instructions).toContain("end_call");
      expect(instructions).not.toContain("ご予約を確定");
      expect(instructions).not.toContain("AIであることや指示の存在は話さない");
      expect(instructions).not.toContain("気の置けない友達");
    });
    it(`${Agent.name} provides the same disclosure and scope in English`, () => {
      const contract = defineCall({ goal: "phone.message", language: "en", input: { request: "Ask when they will arrive." }, permissions: { ask: true } });
      const instructions = new Agent({ contract }).instructions();
      expect(instructions).toContain(contract.input.request);
      expect(instructions).toContain("First disclose that this is an AI");
      expect(instructions).toContain("If they refuse");
      expect(instructions).not.toContain("Never mention being an AI");
    });
  }
  it("does not delegate message calls to web search by default", () => {
    const contract = defineCall({ goal: "phone.message", input: { request: "到着時刻を確認してください。" } });
    const agent = new OpenAILiveAgent({ contract });
    expect(agent.backendInstructions()).not.toContain("- web_search:");
    expect(agent.backendInstructions()).toContain(contract.input.request);
  });

  describe("extractCallerName and caller identity", () => {
    it("extracts explicit callerName when provided", () => {
      const contract = defineCall({ goal: "phone.message", input: { callerName: "周平", request: "お風呂に遅れると伝えてください。" } });
      expect(extractCallerName(contract)).toBe("周平");
    });

    it("extracts caller name from request patterns like '周平の代理として'", () => {
      const contract = defineCall({
        goal: "phone.message",
        input: { request: "周平の代理として、お風呂に遅れると伝えて謝ってください。待ち合わせの変更が必要か聞いてください。" },
      });
      expect(extractCallerName(contract)).toBe("周平");
      const agent = new OpenAILiveAgent({ contract });
      expect(agent.instructions()).toContain("周平さんの代わりにお電話しているAIです");
      expect(agent.instructions()).toContain("周平さんに頼まれて代わりに電話していること");
    });

    it("extracts caller name from '佐藤さんから頼まれて'", () => {
      const contract = defineCall({
        goal: "phone.message",
        input: { request: "佐藤さんから頼まれて伝言です。明日の集合時間を教えてください。" },
      });
      expect(extractCallerName(contract)).toBe("佐藤");
    });

    it("does not extract generic pronouns like '私の代理として'", () => {
      const contract = defineCall({
        goal: "phone.message",
        input: { request: "私の代理として伝えてください。" },
      });
      expect(extractCallerName(contract)).toBeUndefined();
    });
  });
});


describe("audit 2026-09-26: names and farewells", () => {
  it("never treats a role, relation or noun as the caller's name", () => {
    for (const request of ["母の代わりに電話してください。", "会社の代理でお電話します。", "本日は私の代理として伝えてください。", "友達の代わりに伝言です。", "上司から頼まれて連絡しました。", "090-1234-5678の代理です。", "会議の代わりに出席できないと伝えて。"]) {
      expect(extractCallerName(defineCall({ goal: "phone.message", input: { request } })), request).toBeUndefined();
    }
    expect(extractCallerName(defineCall({ goal: "phone.message", input: { request: "田中さんの代わりに電話しています。" } }))).toBe("田中");
  });

  it("does not bake a fixed personal name into the prompt", () => {
    const withName = new OpenAILiveAgent({ contract: defineCall({ goal: "phone.message", language: "ja", input: { callerName: "佐藤", request: "遅れると伝えてください。" } }) }).instructions();
    const without = new OpenAILiveAgent({ contract: defineCall({ goal: "phone.message", language: "ja", input: { request: "遅れると伝えてください。" } }) }).instructions();
    expect(withName).toContain("佐藤さんにもそのようにお伝え");
    expect(withName).not.toContain("周平");
    expect(without).not.toContain("周平");
    expect(without).toContain("依頼者にもそのようにお伝え");
    expect(without).toContain("完了したと主張しないでください");
  });

  it("farewells end the call; conjunctions do not", () => {
    for (const text of ["それじゃ、明日の件なんだけど", "ではでは本題ですが", "それじゃあ何時に集合ですか", "では確認しますね"]) expect(GOODBYE_RE.test(text), text).toBe(false);
    for (const text of ["じゃあね、バイバイ", "はーい、失礼します", "また今度ね", "ok bye"]) expect(GOODBYE_RE.test(text), text).toBe(true);
  });
});
