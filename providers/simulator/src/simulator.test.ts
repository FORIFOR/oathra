import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { defineCall } from "@oathra/contract";
import { contractFromScenario, loadScenarioFile } from "@oathra/scenario";
import { runCall } from "@oathra/runtime";
import { ScriptedAgent } from "./agent.js";
import { HumanCharacter, type CalleeContext, type CalleeReply } from "./character.js";
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

  it("asks bounded intake questions only after consent and records explicit answers", async () => {
    const scenario = loadScenarioFile(resolve(ROOT, "restaurant/restaurant-reservation.yaml"));
    const base = contractFromScenario(scenario);
    const contract = defineCall({
      ...base,
      intake: {
        purpose: "Offer a relevant follow-up",
        consentPrompt: "追加で2点だけ伺ってもよろしいでしょうか？",
        fields: [
          { key: "role", label: "ご担当", question: "ご担当を教えていただけますか？" },
          { key: "region", label: "地域", question: "お住まいの地域を教えていただけますか？" },
        ],
        maxQuestions: 2,
      },
    });
    const callee = {
      name: "聞き取り検証店",
      greeting: () => "お電話ありがとうございます。",
      respond: ({ lastAgentText }: CalleeContext): CalleeReply => {
        if (/追加で2点/.test(lastAgentText)) return { text: "はい、お願いします。" };
        if (/ご担当を/.test(lastAgentText)) return { text: "ソフトウェア開発です。" };
        if (/地域を/.test(lastAgentText)) return { text: "東京です。" };
        if (/確定しても/.test(lastAgentText)) return { text: "ご予約承りました。" };
        if (/19時半でお願いします/.test(lastAgentText)) return { text: "ご予約を確定してもよろしいでしょうか？" };
        if (/予約をお願い/.test(lastAgentText) || /予約をお願いします/.test(lastAgentText)) return { text: "9月12日の19時半、2名様で空いております。" };
        return { text: "承知しました。" };
      },
    };
    const o = await runCall({
      contract,
      transport: new SimulatorTransport({ scenario, pace: "fast", character: callee }),
      brain: new ScriptedAgent(),
      now: NOW,
      scenarioId: scenario.id,
      openingTimeoutMs: 50,
    });
    const dialogue = o.transcript.map((t) => `${t.source}: ${t.text}`).join("\n");
    expect(o.result.status, dialogue).toBe("completed");
    expect(o.intake.status).toBe("complete");
    expect(o.intake.askedQuestions).toBe(2);
    expect(o.intake.answers.map((answer) => [answer.key, answer.value])).toEqual([
      ["role", "ソフトウェア開発です。"],
      ["region", "東京です。"],
    ]);
    expect(dialogue).toContain("追加で2点だけ伺ってもよろしいでしょうか？");
    expect(dialogue).toContain("ご担当を教えていただけますか？");
    expect(dialogue).toContain("お住まいの地域を教えていただけますか？");
    expect(o.events.filter((event) => event.type === "intake.answer")).toHaveLength(2);
  });

  it("stops optional intake immediately when the callee declines consent", async () => {
    const scenario = loadScenarioFile(resolve(ROOT, "restaurant/restaurant-reservation.yaml"));
    const base = contractFromScenario(scenario);
    const contract = defineCall({
      ...base,
      intake: {
        purpose: "Offer a relevant follow-up",
        consentPrompt: "追加で1点だけ伺ってもよろしいでしょうか？",
        fields: [{ key: "role", label: "ご担当", question: "ご担当を教えていただけますか？" }],
        maxQuestions: 1,
      },
    });
    const callee = {
      name: "拒否検証店",
      greeting: () => "お電話ありがとうございます。",
      respond: ({ lastAgentText }: CalleeContext): CalleeReply => {
        if (/追加で1点/.test(lastAgentText)) return { text: "いいえ、結構です。" };
        if (/確定しても/.test(lastAgentText)) return { text: "ご予約承りました。" };
        if (/19時半でお願いします/.test(lastAgentText)) return { text: "ご予約を確定してもよろしいでしょうか？" };
        if (/予約をお願い/.test(lastAgentText)) return { text: "9月12日の19時半、2名様で空いております。" };
        return { text: "承知しました。" };
      },
    };
    const o = await runCall({
      contract,
      transport: new SimulatorTransport({ scenario, pace: "fast", character: callee }),
      brain: new ScriptedAgent(),
      now: NOW,
      scenarioId: scenario.id,
      openingTimeoutMs: 50,
    });
    const dialogue = o.transcript.map((t) => `${t.source}: ${t.text}`).join("\n");
    expect(o.result.status, dialogue).toBe("completed");
    expect(o.intake.status).toBe("declined");
    expect(o.intake.answers).toHaveLength(0);
    expect(dialogue).not.toContain("ご担当を教えていただけますか？");
    expect(o.events.filter((event) => event.type === "intake.answer")).toHaveLength(0);
  });

  it("does not repeat consent after an ambiguous reply", async () => {
    const scenario = loadScenarioFile(resolve(ROOT, "restaurant/restaurant-reservation.yaml"));
    const base = contractFromScenario(scenario);
    const contract = defineCall({
      ...base,
      intake: {
        purpose: "Offer a relevant follow-up",
        consentPrompt: "追加で1点だけ伺ってもよろしいでしょうか？",
        fields: [{ key: "role", label: "ご担当", question: "ご担当を教えていただけますか？" }],
        maxQuestions: 1,
      },
    });
    const callee = {
      name: "保留回答検証店",
      greeting: () => "お電話ありがとうございます。",
      respond: ({ lastAgentText }: CalleeContext): CalleeReply => {
        if (/追加で1点/.test(lastAgentText)) return { text: "少し考えます。" };
        if (/確定しても/.test(lastAgentText)) return { text: "ご予約承りました。" };
        if (/19時半でお願いします/.test(lastAgentText)) return { text: "ご予約を確定してもよろしいでしょうか？" };
        if (/予約をお願い/.test(lastAgentText)) return { text: "9月12日の19時半、2名様で空いております。" };
        return { text: "承知しました。" };
      },
    };
    const o = await runCall({
      contract,
      transport: new SimulatorTransport({ scenario, pace: "fast", character: callee }),
      brain: new ScriptedAgent(),
      now: NOW,
      scenarioId: scenario.id,
      openingTimeoutMs: 50,
    });
    const dialogue = o.transcript.map((t) => `${t.source}: ${t.text}`).join("\n");
    expect(o.result.status, dialogue).toBe("completed");
    expect(o.intake.status).toBe("declined");
    expect(o.intake.answers).toHaveLength(0);
    expect(dialogue.match(/追加で1点だけ伺ってもよろしいでしょうか？/g)).toHaveLength(1);
    expect(dialogue).not.toContain("ご担当を教えていただけますか？");
    expect(o.events.filter((event) => event.type === "intake.consent")).toHaveLength(1);
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

describe("ScriptedAgent hold / repeat / transfer", () => {
  const scenario = loadScenarioFile(resolve(ROOT, "hotel/impossible-hotel.yaml"));
  const contract = contractFromScenario(scenario);
  const ctx = (last: string, i: number) => ({
    contract, language: "ja" as const, turnIndex: i, elapsedMs: i * 5000, permitted: ["ask", "reserve", "negotiate", "share_name"] as const,
    transcript: [{ id: `c${i}`, source: "callee" as const, text: last, t: i * 5000 }],
    mission: { verified: {}, pending: {}, missing: ["date", "partySize", "price", "breakfast", "smoking", "confirmed"], violations: [] },
  });
  it("waits on 「少々お待ちください」 and never hangs up for it", async () => {
    const agent = new ScriptedAgent();
    await agent.respond(ctx("", 0));
    for (let i = 1; i <= 3; i++) {
      const r = await agent.respond(ctx("少々お待ちくださいませ。", i));
      expect(r.action).toBeUndefined();
      expect(r.text).toContain("お待ち");
    }
  });
  it("repeats the last line with content on 「もう一度お願いできますでしょうか」, not the hold acknowledgement", async () => {
    const agent = new ScriptedAgent();
    const opener = (await agent.respond(ctx("", 0))).text;
    const q = (await agent.respond(ctx("10月3日、2名様ですね。禁煙のお部屋でしたらご用意できます。朝食付きで1泊23,500円でございます。", 1))).text;
    expect(q).not.toBe(opener);
    await agent.respond(ctx("確認いたしますので、そのままお待ちください。", 2));
    const r = await agent.respond(ctx("恐れ入ります、もう一度お願いできますでしょうか？", 3));
    expect(r.action).toBeUndefined();
    expect(r.text).toBe(q);
    expect(r.verbatim).toBe(true);
  });
  it("restates the whole request when someone else picks up", async () => {
    const agent = new ScriptedAgent();
    const opener = (await agent.respond(ctx("", 0))).text;
    await agent.respond(ctx("朝食付きで1泊23,500円でございます。", 1));
    const r = await agent.respond(ctx("担当の者に代わりますので、少々お待ちください。……お電話代わりました、山田でございます。ご用件をもう一度お願いできますでしょうか。", 2));
    expect(r.action).toBeUndefined();
    expect(r.text).toBe(opener);
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
