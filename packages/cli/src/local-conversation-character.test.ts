import { describe, expect, it } from "vitest";
import { defineCall } from "@oathra/contract";
import type { BrainProvider } from "@oathra/core";
import { AdversarialCharacter } from "@oathra/eval";
import { contractFromScenario, loadScenarioDir } from "@oathra/scenario";
import { createCharacter, mulberry32 } from "@oathra/simulator";
import { pipelineEngine } from "@oathra/voice-pipeline";
import { LineConditioner, parseCondition } from "./audio-degrade.js";
import { toBatchRun } from "./conversation-batch.js";
import { runLocalConversation } from "./local-conversation.js";
import { scenariosDir } from "./paths.js";

// The real pipeline engine and runtime against the restaurant scenario's scripted character. Speech recognition,
// TTS and the brain are deterministic stand-ins: the callee's voice is a tone per character, recognized as the
// line it was made from, in the order the lines were synthesized.
const scenario = loadScenarioDir(scenariosDir()).find((s) => s.id === "restaurant-reservation")!;
const tone = (ms: number) => { const n = ms * 8, out = new Uint8Array(n); for (let i = 0; i < n; i++) out[i] = i % 16 < 8 ? 0x10 : 0x90; return out; };
const isVoiced = (frame: Uint8Array) => frame.some((b) => b !== 0xff && b !== 0x7f);

function calleeSide() {
  const said: string[] = [];
  let heard = 0;
  const voice = { async synthesizeMulaw8k(text: string) { said.push(text); return tone(Math.min(2500, text.length * 25)); } };
  const stt = {
    live() {
      let listener: (e: unknown) => void = () => {};
      let ms = 0, start: number | null = null, lastVoice = 0;
      return {
        on(fn: (e: unknown) => void) { listener = fn; },
        async open() {},
        send(bytes: Uint8Array) {
          ms += bytes.length / 8;
          if (isVoiced(bytes)) {
            if (start === null) { start = ms; listener({ type: "speech_started", t: start }); }
            lastVoice = ms;
          } else if (start !== null && ms - lastVoice >= 300) {
            listener({ type: "final", text: said[heard] ?? "", startMs: start, endMs: lastVoice, confidence: 0.9, speechFinal: true });
            heard++; start = null;
          }
        },
        finalize() {}, close() {},
      };
    },
  };
  return { said, voice, stt };
}
const agentTts = { async synthesizeMulaw8k(text: string) { return tone(Math.min(1500, text.length * 30)); }, async *synthesizeMulaw8kStream(text: string) { yield tone(Math.min(1500, text.length * 30)); } };
const LINES = ["9月12日の19時以降で、2名で予約をお願いできますか。", "では19時半でお願いします。", "田中と申します。", "ありがとうございました。失礼します。"];
function agentBrain(): BrainProvider {
  let i = 0;
  return { name: "fake", async respond() { const k = Math.min(i++, LINES.length - 1); return { text: LINES[k]!, action: k === LINES.length - 1 ? "hangup" as const : "continue" as const, usage: { inputTokens: 100, outputTokens: 10, costUsd: 0.001 } }; } };
}

async function run(mutation: "none" | "tentative-hold", condition = "clean") {
  const side = calleeSide(), rng = mulberry32(7);
  const base = createCharacter(scenario, rng);
  const character = mutation === "none" ? base : new AdversarialCharacter(base, mutation, rng);
  const brain = agentBrain(), contract = defineCall({ ...contractFromScenario(scenario), target: { phone: "+819000000000", name: scenario.callee.persona.name } });
  const report = await runLocalConversation({
    contract, brain, character, rng, callee: side.voice, maxMs: 60_000,
    engine: pipelineEngine({ brain, stt: side.stt as never, tts: agentTts, acknowledgements: false }),
    now: new Date(scenario.callee.knowledge.now as string),
    line: new LineConditioner(parseCondition(condition), null),
  });
  return { report, side, run: toBatchRun({ mutation, condition, seed: 7 }, 1, "", contract, report) };
}

describe("local conversation with a scripted character (no carrier)", () => {
  it("books the table when the character commits, and reports the verdict and the character's truth", async () => {
    const { report, side, run: r } = await run("none", "quiet");
    expect(report.error).toBeNull();
    expect(side.said[0]).toContain("お電話ありがとうございます");
    expect(report.truth).toMatchObject({ confirmed: true, time: "19:30", partySize: 2 });
    expect(report.verdict).toMatchObject({ status: "completed", complete: true, fields: { time: "19:30", partySize: 2, confirmed: true } });
    expect(report.falseCompletion).toBe(false);
    expect(r).toMatchObject({ expectedComplete: true, asExpected: true });
    expect(report.replies.length).toBeGreaterThanOrEqual(3);
  }, 90_000);

  it("a tentative hold never completes and is not a false completion", async () => {
    const { report, side, run: r } = await run("tentative-hold");
    expect(report.error).toBeNull();
    expect(report.replies.length).toBeGreaterThanOrEqual(2);
    expect(side.said.some((t) => /仮押さえ|一応|後ほど確認|確定ではございません|確定ではありません/.test(t))).toBe(true);
    expect(report.truth?.confirmed).not.toBe(true);
    expect(report.verdict?.complete).toBe(false);
    expect(report.falseCompletion).toBe(false);
    expect(r).toMatchObject({ expectedComplete: false, asExpected: true });
  }, 90_000);
});
