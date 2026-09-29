import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mulawSilence } from "@oathra/audio-kit";
import type { CarrierEvent } from "@oathra/phone";
import { MULAW_8K } from "@oathra/voice";
import { TwilioDirectTransport } from "./transport.js";
import { defineCall } from "@oathra/contract";

const PORT = 4991;

describe("TwilioDirectTransport (fake Twilio media stream)", () => {
  it("emits connected/audio/mark, sends media+mark+clear, and hangs up", async () => {
    const recordDir = mkdtempSync(join(tmpdir(), "oathra-twilio-"));
    const transport = new TwilioDirectTransport({ accountSid: "AC", authToken: "x", from: "+10000000000", publicWsUrl: "wss://example.test", port: PORT, placeCall: false });
    const media = await transport.dial({ to: "+818000000000", language: "ja", contract: defineCall({ goal: "chat.casual" }), recordDir });
    expect(media.audio).toEqual(MULAW_8K);

    const received: Record<string, unknown>[] = [];
    const mediaUrl = transport.lastSession!.mediaUrl;
    const client = new WebSocket(`ws://127.0.0.1:${PORT}${new URL(mediaUrl).pathname}`, { headers: { "x-twilio-signature": createHmac("sha1", "x").update(mediaUrl.replace(/^wss:/, "https:")).digest("base64") } });
    await new Promise<void>((r) => client.once("open", () => r()));
    client.on("message", (raw) => received.push(JSON.parse(raw.toString()) as Record<string, unknown>));
    const send = (o: unknown) => client.send(JSON.stringify(o));

    const events: CarrierEvent[] = [];
    const reader = (async () => {
      for await (const e of media.events) events.push(e);
    })();

    send({ event: "connected", protocol: "Call" });
    send({ event: "start", streamSid: "MZ1", start: { callSid: "CA1", streamSid: "MZ1", accountSid: "AC" } });
    for (let i = 0; i < 5; i++) send({ event: "media", media: { payload: Buffer.from(mulawSilence(20)).toString("base64"), track: "inbound" } });
    await new Promise((r) => setTimeout(r, 100));

    expect(events[0]).toEqual({ type: "connected", callId: "CA1" });
    const audio = events.filter((e) => e.type === "audio");
    expect(audio).toHaveLength(5);
    expect(audio[0]!.type === "audio" && audio[0]!.chunk.data.length).toBe(160);
    expect(audio[0]!.type === "audio" && audio[0]!.chunk.format).toBe("mulaw");

    media.send({ ...MULAW_8K, data: mulawSilence(200) });
    media.mark!("m1");
    media.clear();
    await new Promise((r) => setTimeout(r, 100));
    const mediaMsgs = received.filter((m) => m.event === "media");
    expect(mediaMsgs).toHaveLength(10);
    expect(received.some((m) => m.event === "mark" && (m.mark as { name: string }).name === "m1")).toBe(true);
    expect(received.some((m) => m.event === "clear")).toBe(true);
    expect(received.every((m) => m.streamSid === "MZ1")).toBe(true);

    send({ event: "mark", mark: { name: "m1" } });
    await new Promise((r) => setTimeout(r, 50));
    expect(events.some((e) => e.type === "mark" && e.name === "m1")).toBe(true);
    expect(media.now()).toBeGreaterThan(0);

    // Exercise the carrier stop path: it starts hangup asynchronously, so the
    // reader must not finish before the recording files are flushed.
    send({ event: "stop" });
    await reader;
    expect(existsSync(join(recordDir, "callee.wav"))).toBe(true);
    expect(existsSync(join(recordDir, "caller.wav"))).toBe(true);
    expect(readFileSync(join(recordDir, "callee.wav")).subarray(0, 4).toString()).toBe("RIFF");
    expect(readFileSync(join(recordDir, "caller.wav")).subarray(0, 4).toString()).toBe("RIFF");
    client.close();
    rmSync(recordDir, { recursive: true, force: true });
  });

  it("a recorded call is announced by the carrier before the media stream; an unrecorded one is not", async () => {
    const twiml: string[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => { const t = (init.body as URLSearchParams).get("Twiml"); if (t) twiml.push(t); /* hang-ups go through the same stub */ return new Response(JSON.stringify({ sid: "CA1" }), { status: 201 }); }) as unknown as typeof fetch;
    const opts = { accountSid: "AC", authToken: "t", from: "+10000000000", publicWsUrl: "wss://example.test", fetchImpl };
    const recordDir = mkdtempSync(join(tmpdir(), "oathra-notice-"));
    const contract = defineCall({ goal: "chat.casual" });

    const ja = await new TwilioDirectTransport({ ...opts, port: PORT + 2 }).dial({ to: "+818000000000", language: "ja", contract, recordDir });
    const mediaUrl = /url="([^"]+)"/.exec(twiml[0]!)![1]!;
    const localUrl = `ws://127.0.0.1:${PORT + 2}${new URL(mediaUrl).pathname}`;
    // Exercise the actual upgrade handler: no header and a guessed fixed path
    // cannot acquire the session, even before Twilio's authenticated stream.
    for (const url of [localUrl, `ws://127.0.0.1:${PORT + 2}/media`]) {
      const rejected = new WebSocket(url);
      await new Promise<void>((resolve, reject) => {
        rejected.once("error", () => resolve());
        rejected.once("open", () => { rejected.terminate(); reject(new Error("unauthenticated stream accepted")); });
      });
    }
    const headers = { "x-twilio-signature": createHmac("sha1", "t").update(mediaUrl.replace(/^wss:/, "https:")).digest("base64") };
    const wrong = new WebSocket(localUrl, { headers });
    await new Promise<void>(resolve => wrong.once("open", resolve));
    const wrongClosed = new Promise<void>(resolve => wrong.once("close", () => resolve()));
    wrong.send(JSON.stringify({ event: "start", streamSid: "MZ1", start: { callSid: "OTHER_CALL", accountSid: "AC" } }));
    await wrongClosed;
    const right = new WebSocket(localUrl, { headers });
    await new Promise<void>(resolve => right.once("open", resolve));
    const iterator = ja.events[Symbol.asyncIterator]();
    right.send(JSON.stringify({ event: "start", streamSid: "MZ1", start: { callSid: "CA1", accountSid: "AC" } }));
    expect((await iterator.next()).value).toEqual({ type: "connected", callId: "CA1" });
    await ja.hangup();
    const en = await new TwilioDirectTransport({ ...opts, port: PORT + 3 }).dial({ to: "+14155550100", language: "en", contract, recordDir });
    await en.hangup();
    const unrecorded = await new TwilioDirectTransport({ ...opts, port: PORT + 4 }).dial({ to: "+818000000000", language: "ja", contract });
    await unrecorded.hangup();
    // A call that keeps only the transcript says "記録", not "録音"; a recording notice is never doubled by it.
    const transcribed = await new TwilioDirectTransport({ ...opts, port: PORT + 5 }).dial({ to: "+818000000000", language: "ja", contract, transcriptNotice: true });
    await transcribed.hangup();

    expect(twiml[0]).toMatch(/^<Response><Say language="ja-JP" voice="Polly.Kazuha-Neural">この通話は録音されています。<\/Say><Connect><Stream url="wss:\/\/example\.test\/media\/[a-f0-9]{64}"\/><\/Connect><\/Response>$/);
    expect(twiml[1]).toContain('<Say language="en-US">This call is being recorded.</Say><Connect>');
    expect(twiml[3]).toMatch(/^<Response><Say language="ja-JP" voice="Polly.Kazuha-Neural">この通話は記録されています。<\/Say><Connect><Stream /);
    expect(twiml[2]).toMatch(/^<Response><Connect><Stream url="wss:\/\/example\.test\/media\/[a-f0-9]{64}"\/><\/Connect><\/Response>$/);
    expect(JSON.parse(readFileSync(join(recordDir, "recording-notice.json"), "utf8"))).toMatchObject({ text: "This call is being recorded.", method: "carrier_tts_before_media_stream" });
    rmSync(recordDir, { recursive: true, force: true });
  });

  it("rejects when Twilio refuses the call", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ code: 20003, message: "Authenticate" }), { status: 401 })) as unknown as typeof fetch;
    const transport = new TwilioDirectTransport({ accountSid: "AC", authToken: "bad", from: "+10000000000", publicWsUrl: "wss://example.test", port: PORT + 1, fetchImpl });
    await expect(transport.dial({ to: "+818000000000", language: "ja", contract: defineCall({ goal: "chat.casual" }) })).rejects.toThrow(/Twilio 401/);
  });
});

describe("a call Twilio ends before the media stream connects", () => {
  it("is reported within seconds from the call status, not after the whole connect timeout", async () => {
    let statusReads = 0;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (init?.method === "POST" && String(url).endsWith("/Calls.json")) return new Response(JSON.stringify({ sid: "CA9" }), { status: 201 });
      if (!init?.method || init.method === "GET") { statusReads++; return new Response(JSON.stringify({ status: statusReads < 2 ? "in-progress" : "completed" }), { status: 200 }); }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const started = Date.now();
    const session = await new TwilioDirectTransport({ accountSid: "AC", authToken: "t", from: "+10000000000", publicWsUrl: "wss://example.test", port: 47131, fetchImpl, connectTimeoutMs: 60_000, statusPollMs: 50 }).dial({ to: "+818000000000", language: "ja", contract: defineCall({ goal: "chat.casual" }) });
    const first = (await session.events[Symbol.asyncIterator]().next()).value as CarrierEvent;
    expect(first).toMatchObject({ type: "error", fatal: true });
    expect((first as { message: string }).message).toContain("before the media stream connected");
    expect(Date.now() - started).toBeLessThan(3000);
    await session.hangup().catch(() => undefined);
  });
});
