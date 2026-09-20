// Controlled protocol events are limited to reproducing interruption races in the core adapter.
// No phone/provider credentials; every local socket and timer is removed after each test.
import { expect, it, vi } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { defineCall } from "@oathra/contract";
import type { SessionEvent } from "@oathra/core";
import { OpenAIRealtimeAgent } from "./index.js";

async function session(fn: (ctx: {agent: OpenAIRealtimeAgent; send: (value: object) => void; received: Record<string, unknown>[]; events: SessionEvent[]; audio: number[]; clears: () => number}) => Promise<void>, phone = false) {
  const server = new WebSocketServer({port: 0});
  await new Promise<void>(resolve => server.once("listening", resolve));
  let peer: WebSocket | undefined, cleared = 0;
  const received: Record<string, unknown>[] = [], events: SessionEvent[] = [], audio: number[] = [];
  server.on("connection", socket => { peer = socket; socket.on("message", raw => {
    const value = JSON.parse(raw.toString()); received.push(value);
    if (value.type === "session.update") socket.send(JSON.stringify({type: "session.updated"}));
  }); });
  const port = (server.address() as {port: number}).port;
  const agent = new OpenAIRealtimeAgent({contract: defineCall({goal: phone ? "phone.message" : "connection.check", language: "ja"}), apiKey: "local-protocol-only", url: `ws://127.0.0.1:${port}`});
  const started = Date.now();
  try {
    await agent.connect({sendAudio: bytes => audio.push(bytes.length), clearAudio: () => { cleared++; }, emit: event => events.push(event), now: () => Date.now() - started});
    await fn({agent, send: value => peer!.send(JSON.stringify(value)), received, events, audio, clears: () => cleared});
  } finally { agent.close(); for (const socket of server.clients) socket.terminate(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
const audio = (id: string, bytes = 8000) => ({type: "response.output_audio.delta", response_id: id, item_id: `item_${id}`, delta: Buffer.alloc(bytes, 0xff).toString("base64")});
const transcript = (id: string, text: string) => ({type: "response.output_audio_transcript.done", response_id: id, item_id: `item_${id}`, transcript: text});
const done = (id: string) => ({type: "response.done", response: {id, status: "completed"}});
const flush = () => new Promise(resolve => setTimeout(resolve, 30));

it("interrupting completed generation clears playback without cancelling a finished response", () => session(async c => {
  c.send({type: "response.created", response: {id: "a"}}); c.send(audio("a")); c.send(transcript("a", "接続確認")); c.send(done("a"));
  await vi.waitFor(() => expect(c.audio).toHaveLength(1)); await flush();
  c.agent.interrupt(); await flush();
  expect(c.received.filter(m => m.type === "response.cancel")).toHaveLength(0);
  expect(c.received.filter(m => m.type === "conversation.item.truncate")).toHaveLength(1);
  expect(c.clears()).toBe(1);
  expect(c.events.some(e => e.type === "agent.speech" && e.interrupted)).toBe(true);
}));

it("manual interruption before the first audio cancels only the known response once", () => session(async c => {
  c.send({type: "response.created", response: {id: "a"}}); await flush();
  c.agent.interrupt(); c.agent.interrupt(); await flush();
  expect(c.received.filter(m => m.type === "response.cancel")).toEqual([{type: "response.cancel", response_id: "a"}]);
  c.send(audio("a")); await flush(); expect(c.audio).toHaveLength(0);
}));

it("VAD cancellation and late events cannot clear or overwrite the next response", () => session(async c => {
  c.send({type: "response.created", response: {id: "a"}}); c.send(audio("a", 1600)); c.send(transcript("a", "前の発話")); c.send(done("a"));
  await vi.waitFor(() => expect(c.audio).toHaveLength(1));
  c.send({type: "input_audio_buffer.speech_started"});
  c.send({type: "response.created", response: {id: "b"}}); c.send(audio("b", 8000)); c.send(transcript("b", "次の発話"));
  c.send(audio("a")); c.send(transcript("a", "遅れて到着した古い発話")); c.send(done("a"));
  await new Promise(resolve => setTimeout(resolve, 300));
  expect(c.audio).toEqual([1600, 8000]); expect(c.clears()).toBe(1);
  expect(c.received.filter(m => m.type === "response.cancel")).toHaveLength(0);
  expect(c.events.some(e => e.type === "interruption")).toBe(false);
  expect(c.events.filter(e => e.type === "agent.speech")).toHaveLength(1);
  c.send(done("b"));
  await vi.waitFor(() => expect(c.events.filter(e => e.type === "agent.speech")).toHaveLength(2), {timeout: 2000});
  expect(c.events.filter(e => e.type === "agent.speech").at(-1)).toMatchObject({text: "次の発話", interrupted: false});
}));

it("only the known inactive-cancel race is recoverable and provider messages remain private", () => session(async c => {
  c.send({type: "error", error: {code: "response_cancel_not_active", message: "private-provider-text"}});
  c.send({type: "error", error: {code: "invalid_api_key", message: "private-provider-text"}});
  c.send({type: "response.done", response: {id: "failed", status: "failed", status_details: {error: {code: "insufficient_quota", message: "private-provider-text"}}}});
  await vi.waitFor(() => expect(c.events.filter(e => e.type === "error")).toHaveLength(3));
  expect(c.events).toEqual([
    {type: "error", code: "realtime_response_cancel_not_active", message: "Realtime: response_cancel_not_active", fatal: false},
    {type: "error", code: "realtime_invalid_api_key", message: "Realtime: invalid_api_key", fatal: true},
    {type: "error", code: "realtime_insufficient_quota", message: "Realtime: insufficient_quota", fatal: true},
  ]);
  expect(JSON.stringify(c.events)).not.toContain("private-provider-text");
}));

it("closing the adapter removes pending playback and hangup callbacks", () => session(async c => {
  c.send({type: "response.created", response: {id: "a"}}); c.send(audio("a", 1600)); c.send(transcript("a", "終了確認"));
  c.send({type: "response.function_call_arguments.done", response_id: "a", name: "end_call", call_id: "end", arguments: '{"reason":"done"}'}); c.send(done("a"));
  await vi.waitFor(() => expect(c.audio).toHaveLength(1));
  c.agent.close(); const count=c.events.length; await new Promise(resolve => setTimeout(resolve, 550));
  expect(c.events).toHaveLength(count);
}));

it("connected silent media requests one proactive phone greeting",()=>session(async c=>{
 c.agent.pushAudio(new Uint8Array(160));c.agent.pushAudio(new Uint8Array(160));await flush();
 expect(c.received.filter(m=>m.type==="response.create")).toHaveLength(1);
 expect(JSON.stringify(c.received)).toContain("Do not wait for the recipient");
},true));
it("a bare phone end_call generates an audible goodbye before hangup",()=>session(async c=>{
 c.send({type:"response.created",response:{id:"end-tool"}});
 c.send({type:"response.function_call_arguments.done",response_id:"end-tool",name:"end_call",call_id:"end",arguments:'{"reason":"goodbye"}'});c.send(done("end-tool"));await flush();
 expect(c.events.some(e=>e.type==="hangup")).toBe(false);expect(JSON.stringify(c.received)).toContain("終了の挨拶");
 c.send({type:"response.created",response:{id:"farewell"}});c.send(audio("farewell",4000));c.send(transcript("farewell","またね、バイバイ！"));c.send(done("farewell"));await flush();
 expect(c.events.some(e=>e.type==="hangup")).toBe(false);
 await vi.waitFor(()=>expect(c.events.filter(e=>e.type==="hangup")).toHaveLength(1),{timeout:1800});
 expect(c.events.findIndex(e=>e.type==="agent.speech")).toBeLessThan(c.events.findIndex(e=>e.type==="hangup"));
},true));

it("recipient speech invalidates a farewell whose creation acknowledgement arrives late",()=>session(async c=>{
 c.send({type:"response.created",response:{id:"end-tool"}});c.send({type:"response.function_call_arguments.done",response_id:"end-tool",name:"end_call",call_id:"end",arguments:'{"reason":"bye"}'});c.send(done("end-tool"));await flush();
 const request=c.received.find(m=>m.type==="response.create") as {response:{metadata:object}};expect(request).toBeDefined();
 c.send({type:"input_audio_buffer.speech_started"});c.send({type:"response.created",response:{id:"late-bye",metadata:request.response.metadata}});c.send(audio("late-bye"));c.send(done("late-bye"));await flush();
 expect(c.audio).toHaveLength(0);expect(c.events.some(e=>e.type==="hangup")).toBe(false);expect(c.received).toContainEqual({type:"response.cancel",response_id:"late-bye"});
},true));

it("finishes queued non-goodbye audio before requesting the final farewell",()=>session(async c=>{
 c.send({type:"response.created",response:{id:"thanks"}});c.send(audio("thanks",4000));c.send(transcript("thanks","話してくれてありがとう。"));
 c.send({type:"response.function_call_arguments.done",response_id:"thanks",name:"end_call",call_id:"end",arguments:'{"reason":"done"}'});c.send(done("thanks"));await flush();
 expect(c.received.filter(m=>m.type==="response.create")).toHaveLength(0);
 await vi.waitFor(()=>expect(c.received.filter(m=>m.type==="response.create")).toHaveLength(1),{timeout:1200});
 expect(c.events.some(e=>e.type==="agent.speech"&&e.text.includes("ありがとう"))).toBe(true);
 expect(c.events.some(e=>e.type==="hangup")).toBe(false);
 c.send({type:"response.created",response:{id:"bye"}});c.send(audio("bye",4000));c.send(transcript("bye","またね、バイバイ"));c.send(done("bye"));await flush();expect(c.events.some(e=>e.type==="hangup")).toBe(false);
 await vi.waitFor(()=>expect(c.events.filter(e=>e.type==="hangup")).toHaveLength(1),{timeout:1800});expect(c.events.filter(e=>e.type==="agent.speech")).toHaveLength(2);
},true));
