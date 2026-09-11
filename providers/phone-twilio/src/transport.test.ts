import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import { mulawSilence } from "@oathra/audio-kit";
import type { CarrierEvent } from "@oathra/phone";
import { MULAW_8K } from "@oathra/voice";
import { TwilioDirectTransport } from "./transport.js";
import { defineCall } from "@oathra/contract";

const PORT = 4991;

describe("TwilioDirectTransport (fake Twilio media stream)", () => {
  it("emits connected/audio/mark, sends media+mark+clear, and hangs up", async () => {
    const transport = new TwilioDirectTransport({ accountSid: "AC", authToken: "x", from: "+10000000000", publicWsUrl: "wss://example.test", port: PORT, placeCall: false });
    const media = await transport.dial({ to: "+818000000000", language: "ja", contract: defineCall({ goal: "chat.casual" }) });
    expect(media.audio).toEqual(MULAW_8K);

    const received: Record<string, unknown>[] = [];
    const client = new WebSocket(`ws://127.0.0.1:${PORT}/media`);
    await new Promise<void>((r) => client.once("open", () => r()));
    client.on("message", (raw) => received.push(JSON.parse(raw.toString()) as Record<string, unknown>));
    const send = (o: unknown) => client.send(JSON.stringify(o));

    const events: CarrierEvent[] = [];
    const reader = (async () => {
      for await (const e of media.events) events.push(e);
    })();

    send({ event: "connected", protocol: "Call" });
    send({ event: "start", streamSid: "MZ1", start: { callSid: "CA1", streamSid: "MZ1" } });
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

    await media.hangup("test");
    await reader;
    client.close();
  });

  it("rejects when Twilio refuses the call", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ code: 20003, message: "Authenticate" }), { status: 401 })) as unknown as typeof fetch;
    const transport = new TwilioDirectTransport({ accountSid: "AC", authToken: "bad", from: "+10000000000", publicWsUrl: "wss://example.test", port: PORT + 1, fetchImpl });
    await expect(transport.dial({ to: "+818000000000", language: "ja", contract: defineCall({ goal: "chat.casual" }) })).rejects.toThrow(/Twilio 401/);
  });
});
