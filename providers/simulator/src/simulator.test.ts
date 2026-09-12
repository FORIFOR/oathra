import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { contractFromScenario, loadScenarioFile } from "@oathra/scenario";
import { runCall } from "@oathra/runtime";
import { ScriptedAgent } from "./agent.js";
import { HumanCharacter } from "./character.js";
import { SimulatorTransport } from "./transport.js";

const ROOT = resolve(import.meta.dirname, "../../../scenarios");
const NOW = new Date("2026-09-11T10:00:00+09:00");

async function play(file: string) {
  const scenario = loadScenarioFile(resolve(ROOT, file));
  const contract = contractFromScenario(scenario);
  return runCall({
    contract,
    transport: new SimulatorTransport({ scenario, pace: "fast" }),
    brain: new ScriptedAgent(),
    now: NOW,
    scenarioId: scenario.id,
    openingTimeoutMs: 50,
  });
}

describe("scripted agent vs scripted characters", () => {
  it("books the restaurant at 19:30 with verified evidence", async () => {
    const o = await play("restaurant/restaurant-reservation.yaml");
    const dialogue = o.transcript.map((t) => `${t.source}: ${t.text}`).join("\n");
    expect(o.result.status, dialogue).toBe("completed");
    expect(o.result.fields).toMatchObject({ date: "2026-09-12", time: "19:30", partySize: 2, confirmed: true });
    expect(o.result.evidence.some((e) => e.field === "time" && e.value === "19:00" && e.verified)).toBe(false);
    expect(o.endReason).toBe("agent_hangup");
  });

  it("books the English restaurant at 7:30 pm with verified evidence", async () => {
    const o = await play("restaurant/restaurant-reservation-en.yaml");
    const dialogue = o.transcript.map((t) => `${t.source}: ${t.text}`).join("\n");
    expect(o.result.status, dialogue).toBe("completed");
    expect(o.result.fields).toMatchObject({ date: "2026-09-12", time: "19:30", partySize: 2, confirmed: true });
    expect(o.result.evidence.some((e) => e.field === "time" && e.value === "19:00" && e.verified)).toBe(false);
    expect(dialogue).not.toMatch(/[ぁ-んァ-ン一-龥]/);
  });

  it("negotiates the hotel under budget with breakfast", async () => {
    const o = await play("hotel/impossible-hotel.yaml");
    const dialogue = o.transcript.map((t) => `${t.source}: ${t.text}`).join("\n");
    expect(o.result.status, dialogue).toBe("completed");
    expect(o.result.fields.price as number).toBeLessThanOrEqual(20000);
    expect(o.result.fields).toMatchObject({ breakfast: true, smoking: false, confirmed: true });
  });

  it("buys in bulk under budget", async () => {
    const o = await play("shop/bulk-buy.yaml");
    const dialogue = o.transcript.map((t) => `${t.source}: ${t.text}`).join("\n");
    expect(o.result.status, dialogue).toBe("completed");
    expect(o.result.fields.price as number).toBeLessThanOrEqual(5500);
  });

  it("reads back the serial exactly", async () => {
    const o = await play("serial/serial-number.yaml");
    const dialogue = o.transcript.map((t) => `${t.source}: ${t.text}`).join("\n");
    expect(o.result.status, dialogue).toBe("completed");
    expect(o.result.fields.serial).toBe("RZ7K3Q91XA");
  });

  it("never reports a false completion when everything is full", async () => {
    const o = await play("adversarial/false-completion-trap.yaml");
    const dialogue = o.transcript.map((t) => `${t.source}: ${t.text}`).join("\n");
    expect(o.result.complete, dialogue).toBe(false);
    expect(o.result.fields.confirmed).toBeUndefined();
    expect(o.result.status).toBe("incomplete");
  });

  it("produces a replayable event log with latency traces", async () => {
    const o = await play("restaurant/restaurant-reservation.yaml");
    const types = o.events.map((e) => e.type);
    expect(types[0]).toBe("call.started");
    expect(types).toContain("evidence.verified");
    expect(types).toContain("turn.trace");
    expect(types.at(-1)).toBe("result");
    expect(o.metrics.latency.turns).toBeGreaterThan(0);
    expect(o.events.every((e, i) => e.seq === i)).toBe(true);
  });
});

describe("ScriptedAgent stall guard", () => {
  it("walks away instead of asking the same question forever", async () => {
    const scenario = loadScenarioFile(resolve(ROOT, "hotel/impossible-hotel.yaml"));
    const contract = contractFromScenario(scenario);
    const agent = new ScriptedAgent();
    const ctx = (last: string, i: number) => ({
      contract, language: "ja" as const, turnIndex: i, elapsedMs: i * 5000, permitted: ["ask", "reserve", "negotiate", "share_name"] as const,
      transcript: [{ id: `c${i}`, source: "callee" as const, text: last, t: i * 5000 }],
      mission: { verified: {}, pending: {}, missing: ["price", "breakfast", "smoking", "confirmed"], violations: [] },
    });
    const a = await agent.respond(ctx("はい、朝食は付いております。", 1));
    const b = await agent.respond(ctx("はい、朝食は付いております。", 2));
    const c = await agent.respond(ctx("はい、朝食は付いております。", 3));
    expect(a.text).toBe(b.text);
    expect(c.action).toBe("hangup");
  });
});

describe("ScriptedAgent hedge handling", () => {
  it("asks for a definite answer on a hedge instead of giving up", async () => {
    const scenario = loadScenarioFile(resolve(ROOT, "restaurant/restaurant-reservation.yaml"));
    const contract = contractFromScenario(scenario);
    const agent = new ScriptedAgent();
    const ctx = (last: string, i: number) => ({
      contract, language: "ja" as const, turnIndex: i, elapsedMs: i * 5000, permitted: ["ask", "reserve", "negotiate", "share_name"] as const,
      transcript: [{ id: `c${i}`, source: "callee" as const, text: last, t: i * 5000 }],
      mission: { verified: {}, pending: {}, missing: ["date", "time", "partySize", "confirmed"], violations: [] },
    });
    const a = await agent.respond(ctx("たぶん大丈夫ですが、まだ確定ではありません。", 1));
    expect(a.action).toBeUndefined();
    expect(a.text).toContain("確定");
    expect(a.text).toContain("2名");
    const b = await agent.respond(ctx("おそらく大丈夫だと思います。", 2));
    expect(b.action).toBeUndefined();
    expect(b.text).not.toBe(a.text);
  });
});

describe("agent hangup with a human callee", () => {
  it("ends the call right after the agent's goodbye instead of waiting for the human", async () => {
    const scenario = loadScenarioFile(resolve(ROOT, "restaurant/restaurant-reservation.yaml"));
    const contract = contractFromScenario(scenario);
    const human = new HumanCharacter("店員");
    human.reply("お電話ありがとうございます。");
    human.reply("申し訳ございません、明日は終日満席でございます。");
    const started = Date.now();
    const o = await runCall({
      contract,
      transport: new SimulatorTransport({ scenario, pace: "fast", character: human }),
      brain: new ScriptedAgent(),
      now: NOW,
      scenarioId: scenario.id,
      openingTimeoutMs: 50,
    });
    expect(o.endReason).toBe("agent_hangup");
    expect(o.result.status).not.toBe("completed");
    expect(Date.now() - started).toBeLessThan(5000);
  }, 10000);
});
