import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadScenarioDir } from "@oathra/scenario";
import { handleMcpMessage, TOOLS, type McpDeps } from "./mcp.js";

const callsDir = mkdtempSync(join(tmpdir(), "oathra-mcp-"));
afterAll(() => rmSync(callsDir, { recursive: true, force: true }));

const scenarios = loadScenarioDir(resolve(import.meta.dirname, "../../../scenarios"));
const deps: McpDeps = { version: "0.0.0-test", scenarios: () => scenarios, callsDir };

let nextId = 1;
async function rpc(method: string, params?: unknown): Promise<any> {
  const r = await handleMcpMessage({ jsonrpc: "2.0", id: nextId++, method, ...(params !== undefined ? { params } : {}) }, deps);
  return r as any;
}
async function call(name: string, args: Record<string, unknown> = {}): Promise<{ isError: boolean; value: any; text: string }> {
  const r = await rpc("tools/call", { name, arguments: args });
  const text = r.result.content[0].text as string;
  return { isError: r.result.isError, text, value: r.result.isError ? undefined : JSON.parse(text) };
}

describe("MCP protocol", () => {
  it("negotiates a protocol version and advertises tools", async () => {
    const same = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    expect(same.result).toMatchObject({ protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "oathra", version: "0.0.0-test" } });
    const unknown = await rpc("initialize", { protocolVersion: "1999-01-01" });
    expect(unknown.result.protocolVersion).toBe("2025-06-18");
  });

  it("stays silent on notifications and answers ping", async () => {
    expect(await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, deps)).toBeUndefined();
    expect((await rpc("ping")).result).toEqual({});
  });

  it("rejects malformed requests, unknown methods and unknown tools with JSON-RPC errors", async () => {
    expect(await handleMcpMessage({ id: 1, method: "ping" }, deps)).toMatchObject({ id: 1, error: { code: -32600 } });
    expect(await handleMcpMessage("nonsense", deps)).toMatchObject({ id: null, error: { code: -32600 } });
    expect((await rpc("resources/list")).error.code).toBe(-32601);
    expect((await rpc("tools/call", { name: "launch_rocket" })).error.code).toBe(-32602);
  });

  it("lists tools with object input schemas", async () => {
    const { tools } = (await rpc("tools/list")).result;
    expect(tools.map((t: { name: string }) => t.name)).toEqual(["list_scenarios", "simulate_call", "verify_transcript", "list_calls", "inspect_call"]);
    for (const t of tools) expect(t.inputSchema.type).toBe("object");
  });

  it("offers no tool that can place a real call or pick a paid brain", () => {
    expect(TOOLS.map((t) => t.name).filter((n) => /^(call|dial|intervene|cancel)/.test(n))).toEqual([]);
    const simulate = TOOLS.find((t) => t.name === "simulate_call")!;
    expect(Object.keys((simulate.inputSchema.properties ?? {}) as object)).toEqual(["scenario", "seed", "save"]);
  });
});

describe("MCP tools", () => {
  it("lists the built-in scenarios", async () => {
    const { value } = await call("list_scenarios");
    expect(value.map((s: { id: string }) => s.id)).toContain("restaurant-reservation");
  });

  it("simulates a call in one tool call and returns evidence-backed fields", async () => {
    const { value } = await call("simulate_call", { scenario: "restaurant-reservation" });
    expect(value).toMatchObject({ simulated: true, status: "completed", complete: true, falseCompletion: false });
    expect(value.fields).toMatchObject({ confirmed: true });
    const ids = new Set(value.transcript.map((t: { id: string }) => t.id));
    const verified = value.evidence.filter((e: { verified: boolean }) => e.verified);
    expect(verified.length).toBeGreaterThan(0);
    // Every verified value points at an utterance that is actually in the transcript.
    for (const e of verified) expect(ids.has(e.utteranceId)).toBe(true);
  });

  it("is deterministic for a seed", async () => {
    const a = (await call("simulate_call", { scenario: "impossible-hotel", seed: 7, save: false })).value;
    const b = (await call("simulate_call", { scenario: "impossible-hotel", seed: 7, save: false })).value;
    expect(a.savedPath).toBeUndefined();
    expect(a.transcript.map((t: { text: string }) => t.text)).toEqual(b.transcript.map((t: { text: string }) => t.text));
    expect(a.fields).toEqual(b.fields);
  });

  it("reports the trap scenario as incomplete rather than done", async () => {
    const { value } = await call("simulate_call", { scenario: "false-completion-trap", save: false });
    expect(value.complete).toBe(false);
    expect(value.falseCompletion).toBe(false);
  });

  it("returns a readable tool error for an unknown scenario", async () => {
    const r = await call("simulate_call", { scenario: "nope" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/Available: .*restaurant-reservation/);
  });

  it("inspects a saved call, including a point in time", async () => {
    const { value: run } = await call("simulate_call", { scenario: "restaurant-reservation" });
    const listed = (await call("list_calls")).value;
    expect(listed.map((c: { callId: string }) => c.callId)).toContain(run.callId);

    const full = (await call("inspect_call", { callId: run.callId })).value;
    expect(full).toMatchObject({ callId: run.callId, status: "completed", transport: expect.stringMatching(/simulator/i) });

    const early = (await call("inspect_call", { callId: run.callId, at: "00:01" })).value;
    expect(early.verified.confirmed).toBeUndefined();
    expect(early.transcript.length).toBeLessThan(full.transcript.length);
  });

  it("only accepts call ids, never paths", async () => {
    for (const callId of ["../../etc", "/tmp/x", "a/b", ""]) {
      const r = await call("inspect_call", { callId });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/callId must be an id/);
    }
  });

  it("verifies a transcript: a hedge is not a confirmation", async () => {
    const base = {
      contract: { goal: "restaurant.reservation", language: "ja", require: { date: true, time: true, partySize: true, confirmed: true } },
      referenceDate: "2026-09-11",
      connection: "completed",
    };
    const ask = { id: "u1", source: "caller", text: "9月12日の19時に2名で予約をお願いします。", t: 1000 };
    const hedge = await call("verify_transcript", { ...base, utterances: [ask, { id: "u2", source: "callee", text: "たぶん大丈夫ですが、まだ確定ではありません。", t: 5000 }] });
    expect(hedge.value.complete).toBe(false);
    expect(hedge.value.missing).toContain("confirmed");

    const confirmed = await call("verify_transcript", { ...base, utterances: [ask, { id: "u2", source: "callee", text: "はい、9月12日の19時に2名様でご予約承りました。", t: 5000 }] });
    expect(confirmed.value).toMatchObject({ complete: true, status: "completed" });

    const bad = await call("verify_transcript", { ...base, utterances: [] });
    expect(bad.isError).toBe(true);
  });
});
