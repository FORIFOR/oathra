import { describe, expect, it } from "vitest";
import { EventLog } from "./events.js";
import { normalizeCurrency, normalizeForSpeech, normalizePhone, normalizeTime, readNumberJa } from "./speech.js";
import { StateMachine, toUxState } from "./state.js";
import { summarizeLatency } from "./trace.js";

describe("StateMachine", () => {
  it("compresses internal states to four UX states", () => {
    expect(toUxState("TRANSCRIBING")).toBe("listening");
    expect(toUxState("VERIFYING")).toBe("understanding");
    expect(toUxState("TOOL_CALLING")).toBe("acting");
    expect(toUxState("SYNTHESIZING")).toBe("speaking");
  });
  it("rejects illegal transitions", () => {
    const sm = new StateMachine();
    sm.transition("DIALING");
    sm.transition("LISTENING");
    expect(() => sm.transition("SPEAKING")).toThrow(/Illegal/);
    sm.transition("THINKING");
    sm.transition("SYNTHESIZING");
    sm.transition("SPEAKING");
    expect(sm.ux).toBe("speaking");
  });
});

describe("EventLog", () => {
  it("round-trips JSONL with sequence numbers", () => {
    const log = new EventLog();
    log.append({ t: 0, type: "call.connected" });
    log.append({ t: 10, type: "call.ended", reason: "completed", durationMs: 10 });
    const back = EventLog.fromJSONL(log.toJSONL());
    expect(back.map((e) => e.seq)).toEqual([0, 1]);
    expect(back[1]?.type).toBe("call.ended");
  });
});

describe("speech normalizer", () => {
  it("reads numbers", () => {
    expect(readNumberJa(12580)).toBe("いちまん にせん ごひゃく はちじゅう");
    expect(readNumberJa(20000)).toBe("にまん");
    expect(readNumberJa(3000)).toBe("さんぜん");
  });
  it("normalises currency, time and phone", () => {
    expect(normalizeCurrency(12580)).toBe("いちまん にせん ごひゃく はちじゅう えん");
    expect(normalizeTime("19:30")).toBe("じゅうくじ はん");
    expect(normalizeTime("19:30", "en")).toBe("7:30 PM");
    expect(normalizePhone("03-1234-5678")).toBe("ゼロ さん、いち に さん よん、ご ろく なな はち");
  });
  it("normalises inside a sentence", () => {
    expect(normalizeForSpeech("2026-09-12の19:30、¥12,580です")).toBe("くがつ じゅうににちのじゅうくじ はん、いちまん にせん ごひゃく はちじゅう えんです");
  });
});

describe("latency", () => {
  it("summarises ttfa percentiles against targets", () => {
    const s = summarizeLatency([
      { turnId: "1", speechEndMs: 0, ttfaMs: 400 },
      { turnId: "2", speechEndMs: 0, ttfaMs: 600 },
      { turnId: "3", speechEndMs: 0, ttfaMs: 1200 },
    ]);
    expect(s.ttfaP50Ms).toBe(600);
    expect(s.meetsP50).toBe(true);
    expect(s.meetsP95).toBe(false);
  });
});
