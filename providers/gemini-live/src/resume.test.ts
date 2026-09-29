// The Live session setup and resumption. A local socket stands in for the Live API: no key, no network, no call.
import { expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { defineCall } from "@oathra/contract";
import { GeminiLiveAgent, liveSetup } from "./live.js";

const deepKeys = (v: unknown, out: string[] = []): string[] => { if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.push(k); deepKeys(x, out); } return out; };

it("the setup never carries what 3.8 rejects, and asks for resumption, compression and patient turn taking", () => {
  const setup = liveSetup({ model: "gemini-3.8-live", voice: "Kore", instructions: "日本語で話す", tools: [] }) as any;
  const keys = deepKeys(setup);
  for (const banned of ["thinkingConfig", "thinkingLevel", "thinking_level", "enableAffectiveDialog", "proactivity", "proactiveAudio"]) expect(keys).not.toContain(banned);
  expect(setup.model).toBe("models/gemini-3.8-live");
  expect(setup.generationConfig.responseModalities).toEqual(["AUDIO"]);
  expect(setup.realtimeInputConfig).toEqual({ activityHandling: "START_OF_ACTIVITY_INTERRUPTS", automaticActivityDetection: { disabled: false, prefixPaddingMs: 200, silenceDurationMs: 650, endOfSpeechSensitivity: "END_SENSITIVITY_LOW" } });
  expect(setup.sessionResumption).toEqual({});
  expect(setup.contextWindowCompression).toEqual({ slidingWindow: {} });
  expect((liveSetup({ model: "m", voice: "v", instructions: "", tools: [], handle: "h1" }) as any).sessionResumption).toEqual({ handle: "h1" });
});

async function server(onSetup: (socket: WebSocket, setup: any, n: number) => void) {
  const wss = new WebSocketServer({ port: 0 }); await new Promise<void>((r) => wss.once("listening", r)); let n = 0;
  wss.on("connection", (socket) => { const k = ++n; socket.on("message", (raw) => { const v = JSON.parse(raw.toString()); if (v.setup) onSetup(socket, v.setup, k); }); });
  return { url: `ws://127.0.0.1:${(wss.address() as { port: number }).port}`, count: () => n, close: () => { for (const c of wss.clients) c.terminate(); return new Promise<void>((r) => wss.close(() => r())); } };
}
const agentFor = (url: string, events: any[]) => {
  const agent = new GeminiLiveAgent({ contract: defineCall({ goal: "phone.message", language: "ja", input: { request: "近況を聞く" }, permissions: { ask: true } }), apiKey: "local-only", url, greetFirst: false });
  return { agent, bridge: { sendAudio: () => {}, clearAudio: () => {}, emit: (e: unknown) => events.push(e), now: () => 0 } };
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

it("on goAway the same conversation moves to a new socket with the last handle; the call does not end", async () => {
  const setups: any[] = [];
  const s = await server((socket, setup, n) => {
    setups.push(setup); socket.send(JSON.stringify({ setupComplete: {} }));
    if (n === 1) { socket.send(JSON.stringify({ sessionResumptionUpdate: { newHandle: "h1", resumable: true } })); setTimeout(() => socket.send(JSON.stringify({ goAway: { timeLeft: "1s" } })), 30); }
  });
  const events: any[] = [];
  const { agent, bridge } = agentFor(s.url, events);
  try {
    await agent.connect(bridge);
    await wait(300);
    expect(s.count()).toBe(2);
    expect(setups[1].sessionResumption).toEqual({ handle: "h1" });
    expect(events.some((e) => e.type === "hangup")).toBe(false);
  } finally { agent.close(); await s.close(); }
});

it("a dropped socket without a handle ends the call as before", async () => {
  const s = await server((socket) => { socket.send(JSON.stringify({ setupComplete: {} })); setTimeout(() => socket.close(), 30); });
  const events: any[] = [];
  const { agent, bridge } = agentFor(s.url, events);
  try { await agent.connect(bridge); await wait(200); expect(events.some((e) => e.type === "hangup")).toBe(true); expect(s.count()).toBe(1); }
  finally { agent.close(); await s.close(); }
});
