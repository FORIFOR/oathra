import { describe, expect, it } from "vitest";
import { definePhoneRequest, preparePhoneRequest } from "@oathra/contract";
import type { BrainProvider } from "@oathra/core";
import { pipelineEngine } from "@oathra/voice-pipeline";
import { runLocalConversation, type CalleeLine } from "./local-conversation.js";

// The real pipeline engine and runtime, with speech recognition, TTS, brain and callee voice replaced by
// deterministic stand-ins: a tone per character, recognized as the script line it was made from.
const SCRIPT: CalleeLine[] = [
  { text: "もしもし？" },
  { text: "うん、大丈夫だよ。" },
  { text: "実は最近ちょっと仕事で落ち込んでてさ。" },
  { text: "あ、ごめん、ちょっと待って。", interrupt: true },
  { text: "ありがとう。じゃあね、またね！" },
];
const tone = (ms: number) => { const n = ms * 8, out = new Uint8Array(n); for (let i = 0; i < n; i++) out[i] = i % 16 < 8 ? 0x10 : 0x90; return out; };
const isVoiced = (frame: Uint8Array) => frame.some((b) => b !== 0xff && b !== 0x7f);

function fakeStt() {
  let heard = 0;
  return {
    live() {
      let listener: (e: unknown) => void = () => {};
      let ms = 0, start: number | null = null, lastVoice = 0, partialSent = false;
      return {
        on(fn: (e: unknown) => void) { listener = fn; },
        async open() {},
        send(bytes: Uint8Array) {
          ms += bytes.length / 8;
          if (isVoiced(bytes)) {
            if (start === null) { start = ms; partialSent = false; listener({ type: "speech_started", t: start }); }
            lastVoice = ms;
            if (!partialSent && ms - start > 300) { partialSent = true; listener({ type: "partial", text: SCRIPT[heard]?.text ?? "", startMs: start, endMs: ms, confidence: 0.9 }); }
          } else if (start !== null && ms - lastVoice >= 300) {
            listener({ type: "final", text: SCRIPT[heard]?.text ?? "", startMs: start, endMs: lastVoice, confidence: 0.9, speechFinal: true });
            heard++; start = null;
          }
        },
        finalize() {}, close() {},
      };
    },
  };
}
const fakeTts = { async synthesizeMulaw8k(text: string) { return tone(text.length * 60); }, async *synthesizeMulaw8kStream(text: string) { yield tone(text.length * 60); } };
const calleeVoice = { async synthesizeMulaw8k(text: string) { return tone(text.length * 25); } };
// Turn 3 is long so the callee can cut in; the goodbye hangs up.
const replies = ["もしもし、田中さんの代わりにお電話しているAIです。", "よかった。最近どう？", "そっか、それはしんどかったね。どんなことがあったのか、よかったら少しだけ聞かせてほしいな。無理はしなくていいからね。", "うん、待ってるね。", "こちらこそありがとう。またね！"];
function fakeBrain(): BrainProvider & { turns: number } {
  const b = { name: "fake", turns: 0, async respond() { const i = b.turns++; return { text: replies[Math.min(i, replies.length - 1)]!, action: i >= replies.length - 1 ? "hangup" as const : "continue" as const, usage: { inputTokens: 100, outputTokens: 10, costUsd: 0.001 } }; } };
  return b;
}

describe("local conversation (no carrier)", () => {
  it("runs the phone-request call end to end, waits for replies, and checks a deliberate barge-in", async () => {
    const request = preparePhoneRequest({ phone: "+819012345678", name: "ゆき", callerName: "田中", instruction: "近況を話す", conversationMode: "chat", engine: "character-tts", voicePreset: "character-female" });
    const brain = fakeBrain();
    const report = await runLocalConversation({
      request, contract: definePhoneRequest(request), brain, callee: calleeVoice, script: SCRIPT, maxMs: 40_000,
      engine: pipelineEngine({ brain, stt: fakeStt() as never, tts: fakeTts, acknowledgements: false }),
      systemPrompt: () => "SYSTEM PROMPT USED",
    });
    expect(report.error).toBeNull();
    expect(report.stoppedForBudget).toBe(false);
    expect(report.firstSystemPrompt).toBe("SYSTEM PROMPT USED");
    // Every normal line got a reply, heard after the callee stopped, with the text ready before the audio.
    expect(report.replies.map((r) => r.line)).toEqual(SCRIPT.filter((l) => !l.interrupt).map((l) => l.text));
    for (const r of report.replies) {
      expect(r.replyAudioAfterMs).not.toBeNull();
      expect(r.replyAudioAfterMs!).toBeGreaterThanOrEqual(0);
      expect(r.replyTextAfterMs!).toBeLessThanOrEqual(r.replyAudioAfterMs!);
    }
    // The cut-in happened while the agent spoke; playback stopped and nothing of the old reply played after.
    expect(report.interruption?.agentWasSpeaking).toBe(true);
    expect(report.interruption?.stoppedAfterMs).not.toBeNull();
    expect(report.interruption?.staleAudioAfterStop).toBe(false);
    expect(report.transcript.some((t) => t.who === "agent" && t.interrupted)).toBe(true);
    expect(report.transcript.filter((t) => t.who === "callee").map((t) => t.text)).toEqual(SCRIPT.map((l) => l.text));
    // The goodbye was spoken whole and the agent ended the call.
    expect(report.endReason).toBe("agent_hangup");
    expect(report.transcript.filter((t) => t.who === "agent").at(-1)).toMatchObject({ text: replies.at(-1) });
    expect(report.usage.brainCostUsd).toBeCloseTo(0.005, 6);
    expect(report.agentAudio.length).toBe(report.mixedAudio.length);
  }, 60_000);
});
