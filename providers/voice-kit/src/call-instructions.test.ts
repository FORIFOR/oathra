import { describe, expect, it } from "vitest";
import { defineCall, definePhoneInbound, defineRestaurantReception } from "@oathra/contract";
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

describe("every situation, not only sales and requests (2026-10-04)", () => {
  it("an incoming call to a business line invites the caller to speak and asks only what is missing", () => {
    const text = callInstructions({ contract: definePhoneInbound({ ownerName: "丸山商事", callerPhone: "+819011112222", business: true }) });
    expect(text).toContain("【受付の会話】");
    expect(text).toContain("すでに話したことは聞き直さないでください");
  });
  it("a restaurant's reception does the same", () => {
    const text = callInstructions({ contract: defineRestaurantReception({ restaurantName: "ビストロ灯", callerPhone: "+819011112222", today: "2026-10-04", seatings: ["18:00"], maxParty: 6 }) });
    expect(text).toContain("【受付の会話】");
  });
  it("any other call the AI leads carries the two-way rules", () => {
    const contract = defineCall({ goal: "restaurant.reservation", target: { phone: "+81312345678", name: "店" }, language: "ja", input: { request: "2名で予約" }, require: { date: true, time: true, confirmed: true }, permissions: { ask: true, reserve: true }, budget: { maxDurationMs: 180000, maxTurns: 40, maxCostUsd: 1 } });
    expect(callInstructions({ contract })).toContain("【双方向の会話】");
  });
});
