import { describe, expect, it } from "vitest";
import { loadScenarioFile } from "@oathra/scenario";
import { LlmCharacter, parseCalleeJson } from "./llm.js";

const scenario = loadScenarioFile(new URL("../../../../scenarios/hotel/impossible-hotel.yaml", import.meta.url).pathname);

describe("parseCalleeJson", () => {
  it("parses say/state/hangup", () => {
    expect(parseCalleeJson('{"say":"はい","state":{"confirmed":true,"price":19900},"hangup":true}')).toEqual({ say: "はい", state: { confirmed: true, price: 19900 }, hangup: true });
  });
  it("strips fences and salvages truncated output without reading JSON aloud", () => {
    expect(parseCalleeJson('```json\n{"say":"少々お待ちください。","state":{}}\n```').say).toBe("少々お待ちください。");
    expect(parseCalleeJson('{"say":"21,100円でしたら","state":{"conf')).toEqual({ say: "21,100円でしたら" });
    expect(parseCalleeJson("かしこまりました。")).toEqual({ say: "かしこまりました。" });
  });
});

describe("LlmCharacter", () => {
  it("plays the callee from the model's JSON and reports its own commitments as truth", async () => {
    const seen: string[][] = [];
    const chat = async (messages: { role: string; content: string }[]) => {
      seen.push(messages.map((m) => m.role));
      const last = messages[messages.length - 1]!.content;
      if (/予算/.test(last)) return '{"say":"朝食付きで19,900円ならご案内できますよ。","state":{"confirmed":false,"price":"19,900円","breakfast":true}}';
      if (/お願いします/.test(last)) return '{"say":"承知しました、10月3日2名様、19,900円で押さえておきますね。","state":{"confirmed":true,"date":"2026-10-03","partySize":2,"price":19900,"breakfast":true,"smoking":false}}';
      return '{"say":"10月3日ですね、禁煙で23,500円になります。","state":{"confirmed":false,"price":23500}}';
    };
    const c = new LlmCharacter(scenario, chat);
    expect(c.greeting()).toContain("ホテル・リンゴ");
    expect(c.truth()).toEqual({ confirmed: false });
    const ctx = (transcript: { source: "caller" | "callee"; text: string }[]) => ({ transcript: transcript.map((t, i) => ({ id: String(i), t: i * 1000, ...t })), lastAgentText: transcript[transcript.length - 1]!.text, language: "ja" as const, turnIndex: transcript.length, rng: () => 0.5 });
    await c.respond(ctx([{ source: "callee", text: "お電話ありがとうございます。" }, { source: "caller", text: "10月3日に2名で泊まりたいです。" }]));
    expect(seen[0]).toEqual(["system", "assistant", "user"]);
    const r2 = await c.respond(ctx([{ source: "caller", text: "予算は2万円です。" }]));
    expect(r2.text).toContain("19,900");
    expect(c.truth()).toMatchObject({ confirmed: false, price: 19900, breakfast: true });
    const r3 = await c.respond(ctx([{ source: "caller", text: "それでお願いします。" }]));
    expect(r3.hangup).toBeUndefined();
    expect(c.truth()).toEqual({ confirmed: true, date: "2026-10-03", partySize: 2, price: 19900, breakfast: true, smoking: false });
  });
  it("never speaks broken JSON", async () => {
    const c = new LlmCharacter(scenario, async () => '{"say": broken');
    const r = await c.respond({ transcript: [{ id: "0", t: 0, source: "caller", text: "こんにちは" }], lastAgentText: "こんにちは", language: "ja", turnIndex: 1, rng: () => 0 });
    expect(r.text).not.toContain("{");
  });
});
