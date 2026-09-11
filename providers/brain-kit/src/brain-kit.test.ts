import { describe, expect, it } from "vitest";
import { defineCall } from "@oathra/contract";
import type { BrainContext } from "@oathra/core";
import { buildMessages, buildSystemPrompt, estimateCostUsd, parseBrainJson } from "./index.js";

const ctx: BrainContext = {
  contract: defineCall({
    goal: "restaurant.reservation",
    input: { date: "2026-09-12", partySize: 2 },
    require: { date: true, time: true, confirmed: true },
    constraints: { time: { gte: "19:00" } },
    permissions: { ask: true, reserve: true },
  }),
  language: "ja",
  transcript: [
    { id: "c0", source: "callee", text: "お電話ありがとうございます。", t: 1000 },
    { id: "a0", source: "caller", text: "明日19時以降で2名お願いします。", t: 2000 },
    { id: "c1", source: "callee", text: "19時半なら空いております。", t: 3000 },
  ],
  mission: { verified: {}, pending: { time: "19:30" }, missing: ["date", "time", "confirmed"], violations: [] },
  permitted: ["ask", "reserve"],
  elapsedMs: 3000,
  turnIndex: 1,
};

describe("parseBrainJson", () => {
  it("parses plain JSON", () => {
    expect(parseBrainJson('{"text":"はい","action":"hangup"}')).toEqual({ text: "はい", action: "hangup" });
  });
  it("strips code fences and surrounding prose", () => {
    const r = parseBrainJson('Sure:\n```json\n{"text":"19時半でお願いします。","action":"continue"}\n```');
    expect(r.text).toBe("19時半でお願いします。");
    expect(r.action).toBe("continue");
  });
  it("handles braces inside strings", () => {
    expect(parseBrainJson('{"text":"a {b} c","action":"continue"} trailing')).toEqual({ text: "a {b} c", action: "continue" });
  });
  it("falls back to raw text on invalid JSON", () => {
    expect(parseBrainJson("19時半でお願いします。")).toEqual({ text: "19時半でお願いします。", action: "continue" });
    expect(parseBrainJson('{"text": broken')).toEqual({ text: '{"text": broken', action: "continue" });
  });
  it("keeps only valid requestedAction values", () => {
    expect(parseBrainJson('{"text":"x","requestedAction":{"action":"payment","detail":"pay 100"}}').requestedAction).toEqual({ action: "payment", detail: "pay 100" });
    expect(parseBrainJson('{"text":"x","requestedAction":{"action":"launch_rocket"}}').requestedAction).toBeUndefined();
  });
  it("caps text length", () => {
    expect(parseBrainJson(JSON.stringify({ text: "あ".repeat(1000) })).text.length).toBeLessThanOrEqual(300);
  });
});

describe("prompt building", () => {
  it("includes contract, mission and rules", () => {
    const p = buildSystemPrompt(ctx);
    expect(p).toContain("restaurant.reservation");
    expect(p).toContain('"time":"19:30"');
    expect(p).toContain("Never claim the task is complete");
    expect(p).toContain("Japanese");
    expect(p).toContain("STATUS: not done yet");
  });
  it("tells the model to hang up when nothing is missing", () => {
    const done = { ...ctx, mission: { verified: { date: "2026-09-12", time: "19:30", confirmed: true }, pending: {}, missing: [], violations: [] } };
    expect(buildSystemPrompt(done)).toContain('set action to "hangup"');
  });
  it("maps transcript to alternating user/assistant messages, callee first", () => {
    const m = buildMessages(ctx);
    expect(m[0]?.role).toBe("system");
    expect(m.slice(1).map((x) => x.role)).toEqual(["user", "assistant", "user"]);
    expect(m.at(-1)?.content).toBe("19時半なら空いております。");
  });
  it("adds an opening prompt when the callee has not spoken", () => {
    const m = buildMessages({ ...ctx, transcript: [] });
    expect(m.at(-1)?.role).toBe("user");
    expect(m).toHaveLength(2);
  });
});

describe("estimateCostUsd", () => {
  it("prices known models and zeroes unknown ones", () => {
    expect(estimateCostUsd("gpt-4o-mini", { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(0.75, 6);
    expect(estimateCostUsd("gemini-2.0-flash-001", { inputTokens: 1_000_000 })).toBeCloseTo(0.1, 6);
    expect(estimateCostUsd("qwen2.5:7b", { inputTokens: 1_000_000 })).toBe(0);
  });
});
