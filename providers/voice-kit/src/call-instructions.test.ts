import { describe, expect, it } from "vitest";
import { defineCall } from "@oathra/contract";
import { callInstructions } from "./index.js";

// A sales call and a casual chat both let the other side's words decide what comes next (2026-10-04).
describe("two-way calls beyond ordinary requests", () => {
  it("a sales call carries the two-way rules after the shared policies", () => {
    const contract = defineCall({ goal: "sales.materials", target: { phone: "+81312345678", name: "山田商店" }, language: "ja",
      input: { request: "新しいサービスのご案内" }, require: { confirmed: true }, permissions: { ask: true }, budget: { maxDurationMs: 180000, maxTurns: 40, maxCostUsd: 1 } });
    const text = callInstructions({ contract });
    expect(text).toContain("【双方向の会話】");
    expect(text).toContain("「どんな」「どのように」「何が」で聞いてください");
  });
  it("a casual chat asks what and how instead of did-you questions", () => {
    const contract = defineCall({ goal: "chat.friend", target: { phone: "+819012345678", name: "ミカ" }, language: "ja", input: {}, permissions: { ask: true }, budget: { maxDurationMs: 180000, maxTurns: 40, maxCostUsd: 1 } });
    const text = callInstructions({ contract });
    expect(text).toContain("はい・いいえで終わる質問");
    expect(text).not.toContain("【双方向の会話】");
  });
});
