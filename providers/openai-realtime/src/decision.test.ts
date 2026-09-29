// record_decision on GPT-Live: a local socket stands in for the Live API. No credentials, no phone call.
import { expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { definePhoneRequest, preparePhoneRequest } from "@oathra/contract";
import type { DecisionEvent } from "@oathra/voice-kit";
import { OpenAILiveAgent } from "./live.js";

const scoped = "10月3日の19時に2名で予約を取ってほしい。\n\n【任せる範囲】\nその場で決めてよい：時間は第一希望から2時間以内\nしない：支払い・カード番号を伝える、AIであることを隠す";
const flush = () => new Promise((r) => setTimeout(r, 30));
async function session(instruction: string, fn: (c: { send: (v: object) => void; received: any[]; decisions: DecisionEvent[] }) => Promise<void>) {
  const server = new WebSocketServer({ port: 0 }); await new Promise<void>((r) => server.once("listening", r)); let peer: WebSocket;
  const received: any[] = [], decisions: DecisionEvent[] = [];
  server.on("connection", (socket) => { peer = socket; socket.on("message", (raw) => { const v = JSON.parse(raw.toString()); received.push(v); if (v.type === "session.start") socket.send(JSON.stringify({ type: "session.started" })); }); });
  const contract = definePhoneRequest(preparePhoneRequest({ phone: "+819012345678", name: "焼肉 たけ", instruction }));
  const agent = new OpenAILiveAgent({ contract, apiKey: "local-protocol-only", url: `ws://127.0.0.1:${(server.address() as { port: number }).port}`, onDecision: (e) => decisions.push(e) });
  try { await agent.connect({ sendAudio: () => {}, clearAudio: () => {}, emit: () => {}, now: () => 0 }); await fn({ send: (v) => peer!.send(JSON.stringify(v)), received, decisions }); }
  finally { agent.close(); for (const socket of server.clients) socket.terminate(); await new Promise<void>((r) => server.close(() => r())); }
}
const tools = (c: { received: any[] }) => [...(c.received[0].session.delegation?.responses?.tools ?? []), ...(c.received[0].session.tools ?? [])] as any[];
const call = (id: string, args: object) => ({ type: "response.event", event: { type: "response.output_item.done", item: { type: "function_call", name: "record_decision", call_id: id, arguments: JSON.stringify(args) } } });

it("offers record_decision only with a scope to decide in, reports each decision, and asks for no new response", async () => {
  await session("近況を聞いて", async (c) => { expect(tools(c).some((t) => t.name === "record_decision")).toBe(false); });
  await session(scoped, async (c) => {
    expect(tools(c).some((t) => t.name === "record_decision")).toBe(true);
    c.send(call("a", { decision: "19時が満席なので20時半にしました", within: "時間は第一希望から2時間以内" })); await flush();
    expect(c.decisions).toEqual([{ type: "decision.made", decision: "19時が満席なので20時半にしました", within: "時間は第一希望から2時間以内" }]);
    const output = c.received.find((v) => v.type === "response.item.create" && v.item?.call_id === "a");
    expect(JSON.parse(output.item.output).ok).toBe(true);
    expect(c.received.some((v) => v.type === "response.create" && String(v.event_id ?? "").includes("_a"))).toBe(false);
    c.send(call("b", { decision: "" })); await flush();
    expect(c.decisions).toHaveLength(1);
  });
});
