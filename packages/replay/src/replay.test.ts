import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { defineCall, type CallContract } from "@oathra/contract";
import type { BrainProvider, BrainResponse, CallSession, SessionEvent, SpeakInput, SpeakResult, TransportProvider } from "@oathra/core";
import { runCall, type CallOutcome } from "@oathra/runtime";
import { listCalls, loadCall, renderCallSummary, renderTimeline, saveCall, snapshotAt, transcriptFromEvents } from "./index.js";

// A scripted far end, so the recording under test comes from the real runtime and evidence engine.
function scripted(replies: string[]): TransportProvider {
  const queue: SessionEvent[] = [];
  const waiters: Array<(r: IteratorResult<SessionEvent>) => void> = [];
  let clock = 0, closed = false;
  const push = (e: SessionEvent) => { const w = waiters.shift(); if (w) w({ value: e, done: false }); else queue.push(e); };
  const close = () => { closed = true; for (const w of waiters.splice(0)) w({ value: undefined as never, done: true }); };
  const say = (text: string) => { const startMs = clock + 100; clock = startMs + 900; push({ type: "speech", text, startMs, endMs: clock }); };
  const session: CallSession = {
    events: { [Symbol.asyncIterator]: () => ({ next: () => { const e = queue.shift(); if (e) return Promise.resolve({ value: e, done: false }); if (closed) return Promise.resolve({ value: undefined as never, done: true }); return new Promise((res) => waiters.push(res)); } }) },
    async speak(_input: SpeakInput): Promise<SpeakResult> { const startMs = clock + 80; clock = startMs + 1000; const next = replies.shift(); if (next) say(next); else { push({ type: "hangup" }); close(); } return { startMs, endMs: clock, interrupted: false }; },
    interrupt() {},
    async hangup() { close(); },
    now: () => clock,
  };
  return { name: "scripted", kind: "simulator", deliversText: true, connect: async () => { push({ type: "connected", callee: "テスト店" }); say("お電話ありがとうございます、テスト店です。"); return session; } };
}
const brain = (lines: Array<string | BrainResponse>): BrainProvider => ({ name: "script", respond: async () => { const next = lines.shift() ?? { text: "失礼いたします。", action: "hangup" as const }; return typeof next === "string" ? { text: next } : next; } });

const reservation = (over: Partial<Parameters<typeof defineCall>[0]> = {}): CallContract =>
  defineCall({ goal: "restaurant.reservation", language: "ja", require: { date: true, time: true, partySize: true, confirmed: true }, constraints: { time: { gte: "19:00" } }, permissions: { ask: true, reserve: true }, ...over });

const booked = () => runCall({
  contract: reservation(), callId: "call_booked", now: new Date("2026-09-11T10:00:00+09:00"),
  transport: scripted(["申し訳ございません、19時は満席です。19時半なら空いております。", "はい、9月12日の19時半に2名様でご予約承りました。"]),
  brain: brain(["9月12日の19時以降で2名、予約をお願いします。", "では19時半でお願いします。", { text: "ありがとうございます。失礼いたします。", action: "hangup" }]),
});
const hedged = () => runCall({
  contract: reservation(), callId: "call_hedged", now: new Date("2026-09-11T10:00:00+09:00"),
  transport: scripted(["たぶん大丈夫ですが、まだ確定ではありません。"]),
  brain: brain(["9月12日の19時に2名で予約をお願いします。", { text: "承知しました。失礼いたします。", action: "hangup" }]),
});

const root = mkdtempSync(join(tmpdir(), "oathra-replay-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const dir = (name: string) => { const d = join(root, name); mkdirSync(d, { recursive: true }); return d; };

describe("saveCall / loadCall", () => {
  it("writes every file of a recording and reads the same call back", async () => {
    const outcome = await booked(), calls = dir("roundtrip"), path = saveCall(outcome, calls);
    for (const file of ["events.jsonl", "contract.json", "result.json", "summary.md", "metrics.json", "transcript.json", "traces.json", "intake.json"]) expect(existsSync(join(path, file)), file).toBe(true);
    expect(readFileSync(join(path, "events.jsonl"), "utf8").trim().split("\n")).toHaveLength(outcome.events.length);

    const rec = loadCall("call_booked", calls);
    expect(rec.callId).toBe("call_booked");
    expect(rec.result).toEqual(outcome.result);
    expect(rec.contract).toEqual(outcome.contract);
    expect(rec.metrics).toEqual(outcome.metrics);
    expect(rec.transcript).toEqual(outcome.transcript);
    expect(rec.traces).toEqual(outcome.traces);
    expect(rec.events).toEqual([...outcome.events]);
    // The directory itself is accepted too.
    expect(loadCall(path).result.status).toBe("completed");
  });

  it("rebuilds the transcript and traces from events when an older recording lacks those files", async () => {
    const outcome = await booked(), calls = dir("legacy"), path = saveCall(outcome, calls);
    for (const file of ["transcript.json", "traces.json", "intake.json"]) rmSync(join(path, file));
    const rec = loadCall("call_booked", calls);
    expect(rec.transcript.map((t) => [t.source, t.text])).toEqual(outcome.transcript.map((t) => [t.source, t.text]));
    expect(rec.traces).toEqual(outcome.traces);
    expect(rec.intake).toBeUndefined();
    expect(transcriptFromEvents(rec.events)).toEqual(rec.transcript);
  });

  it("lists only directories that hold a recording, in order", async () => {
    const calls = dir("list");
    expect(listCalls(join(calls, "missing"))).toEqual([]);
    saveCall(await hedged(), calls); saveCall(await booked(), calls);
    mkdirSync(join(calls, "not-a-call")); writeFileSync(join(calls, "notes.txt"), "x");
    expect(listCalls(calls)).toEqual(["call_booked", "call_hedged"]);
  });

  it("fails loudly on a missing recording instead of inventing one", () => {
    expect(() => loadCall("nope", dir("empty"))).toThrow();
  });
});

describe("snapshotAt: time travel", () => {
  it("shows the offer as pending before it is accepted and nothing confirmed before the callee confirms", async () => {
    const outcome = await booked(), events = [...outcome.events], { transcript, result } = outcome;
    expect(snapshotAt(events, -1)).toMatchObject({ agentState: "IDLE", transcript: [], verified: {}, pending: {} });

    const offerAt = transcript.find((t) => t.text.includes("19時半なら"))!.t;
    const atOffer = snapshotAt(events, offerAt);
    expect(atOffer.pending.time).toBe("19:30");
    expect(atOffer.verified.confirmed).toBeUndefined();
    expect(atOffer.transcript.length).toBeLessThan(transcript.length);

    const end = snapshotAt(events, Number.MAX_SAFE_INTEGER);
    expect(end.verified).toMatchObject({ time: "19:30", confirmed: true });
    expect(end.pending.time).toBeUndefined();
    expect(end.transcript).toHaveLength(transcript.length);
    expect(end.agentState).toBe("ENDED");
    expect(end.lastTrace?.ttfaMs).toBeGreaterThanOrEqual(0);
    expect(result.status).toBe("completed");
  });

  it("never shows a hedge as verified", async () => {
    const events = [...(await hedged()).events];
    expect(snapshotAt(events, Number.MAX_SAFE_INTEGER).verified.confirmed).toBeUndefined();
  });
});

describe("renderTimeline / renderCallSummary", () => {
  it("renders one line per notable event with a mm:ss.mmm clock", async () => {
    const lines = renderTimeline([...(await booked()).events]);
    expect(lines[0]).toMatch(/^00:00\.000 {2}call\.started {6}scripted \/ script$/);
    expect(lines.some((l) => /verified {10}confirmed = true/.test(l))).toBe(true);
    expect(lines.some((l) => /callee {12}はい、9月12日の19時半に2名様でご予約承りました。/.test(l))).toBe(true);
    expect(lines.at(-1)).toMatch(/result {12}completed$/);
    expect(lines.every((l) => /^\d{2}:\d{2}\.\d{3} {2}\S/.test(l))).toBe(true);
  });

  it("writes an honest memo: verified fields with their utterance, missing fields when incomplete", async () => {
    const done = renderCallSummary(await booked());
    expect(done).toContain("- 状態: 完了");
    expect(done).toContain("- **time**: 19:30");
    expect(done).toMatch(/\*\*confirmed\*\* = true — callee: 「[^」]*承り[^」]*」 — 発話 `turn_/);
    expect(done).toContain("## 不足項目\nなし");

    const open = await hedged(), memo = renderCallSummary(open);
    expect(memo).toContain("- 状態: 未完了");
    expect(memo).toContain("- 完了: —");
    expect(memo).toContain("- confirmed");
    expect(memo).not.toContain("**confirmed**");
    expect(memo).toContain(`- 終了理由: ${open.endReason}`);
  });

  it("speaks English for an English contract and records a consented intake answer with its utterance", async () => {
    const outcome: CallOutcome = { ...(await booked()), contract: reservation({ language: "en" }),
      intake: { status: "complete", purpose: "Follow-up", askedQuestions: 1, consent: { granted: true, utteranceId: "turn_c", t: 9000 }, answers: [{ key: "source", label: "Source", value: "A friend", utteranceId: "turn_a", transcript: "A friend told me.", t: 12000 }], declined: [] } };
    const memo = renderCallSummary(outcome);
    expect(memo).toContain("# Call decision memo");
    expect(memo).toContain("## Consented operational profile");
    expect(memo).toContain("- **Source** (source): A friend — utterance: 「A friend told me.」 — utterance ID: `turn_a` (12000ms)");
    expect(memo).toContain("no callee attributes are inferred");
  });
});
