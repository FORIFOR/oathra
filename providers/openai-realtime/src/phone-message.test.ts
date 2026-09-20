import { describe, expect, it } from "vitest";
import { defineCall } from "@oathra/contract";
import { OpenAIRealtimeAgent } from "./index.js";
import { OpenAILiveAgent } from "./live.js";

// Exercise actual instruction generation only; constructors do not open sockets.
describe("reviewed phone message voice instructions", () => {
  for (const Agent of [OpenAILiveAgent, OpenAIRealtimeAgent]) {
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
});
