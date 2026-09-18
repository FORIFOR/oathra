/**
 * `oathra mcp` — a Model Context Protocol server over stdio.
 *
 * Everything here is local, free and deterministic: simulated calls, transcript
 * checks and saved-call inspection. Placing a real phone call is deliberately
 * not exposed as a tool; that stays an explicit `oathra call` by a human.
 *
 * The protocol surface is small (initialize, ping, tools/list, tools/call), so
 * it is implemented directly instead of adding a dependency to the bundled CLI.
 */
import { createInterface } from "node:readline";
import { runScenario } from "@oathra/eval";
import { defaultCallsDir, listCalls, loadCall, saveCall, snapshotAt } from "@oathra/replay";
import { loadScenarioDir, type Scenario } from "@oathra/scenario";
import { resolveBrain } from "./brains.js";
import { scenariosDir } from "./paths.js";
import { verifyTranscript } from "./transcript.js";

const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

type JsonRpcId = string | number | null;
type JsonRpcRequest = { jsonrpc?: string; id?: JsonRpcId; method?: unknown; params?: unknown };
type JsonRpcResponse = { jsonrpc: "2.0"; id: JsonRpcId; result: unknown } | { jsonrpc: "2.0"; id: JsonRpcId; error: { code: number; message: string } };

export type McpDeps = {
  version: string;
  scenarios: () => Scenario[];
  callsDir: string;
};

type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>, deps: McpDeps) => Promise<unknown> | unknown;
};

const CALL_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

function callId(args: Record<string, unknown>): string {
  const id = args.callId;
  // loadCall also accepts a directory path; an MCP client only ever gets ids.
  if (typeof id !== "string" || !CALL_ID_RE.test(id)) throw new Error("callId must be an id returned by simulate_call or list_calls");
  return id;
}

function parseAt(at: unknown): number {
  if (typeof at === "number" && Number.isFinite(at) && at >= 0) return at;
  const m = typeof at === "string" ? /^(\d+):(\d+)(?:\.(\d+))?$/.exec(at) : null;
  if (!m) throw new Error('at must be milliseconds or "mm:ss.mmm"');
  return Number(m[1]) * 60000 + Number(m[2]) * 1000 + Number((m[3] ?? "0").padEnd(3, "0"));
}

export const TOOLS: Tool[] = [
  {
    name: "list_scenarios",
    description: "List the built-in phone scenarios (restaurant booking, hotel negotiation, …) that simulate_call can run. Local, no API key.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: (_args, deps) =>
      deps.scenarios().map((s) => ({ id: s.id, title: s.title, difficulty: s.difficulty, language: s.language, domain: s.domain, brief: s.mission.brief ?? s.description })),
  },
  {
    name: "simulate_call",
    description:
      "Run one simulated phone call between the built-in agent and a scripted callee, and return the verified result. Completion is decided by evidence from the callee's own words, never by the agent's claim. SIMULATION ONLY: no real phone is dialled, no API key or cost. Deterministic for a given seed.",
    inputSchema: {
      type: "object",
      properties: {
        scenario: { type: "string", description: "Scenario id from list_scenarios. Default: restaurant-reservation" },
        seed: { type: "integer", description: "Random seed for the scripted callee" },
        save: { type: "boolean", description: "Save the recording under .oathra/calls so inspect_call can read it. Default: true" },
      },
      additionalProperties: false,
    },
    run: async (args, deps) => {
      const want = typeof args.scenario === "string" ? args.scenario : "restaurant-reservation";
      const all = deps.scenarios();
      const scenario = all.find((s) => s.id === want);
      if (!scenario) throw new Error(`Scenario "${want}" not found. Available: ${all.map((s) => s.id).join(", ")}`);
      const seed = typeof args.seed === "number" && Number.isInteger(args.seed) ? args.seed : scenario.seed;
      // Scripted brain only: an MCP client must not be able to spend the user's LLM credits.
      const run = await runScenario(scenario, { brain: resolveBrain("scripted"), pace: "fast", ...(seed !== undefined ? { seed } : {}) });
      const saved = args.save === false ? undefined : saveCall(run.outcome, deps.callsDir);
      const { result, metrics, transcript, intake, endReason } = run.outcome;
      return {
        simulated: true,
        callId: run.outcome.callId,
        scenario: scenario.id,
        status: result.status,
        complete: result.complete,
        fields: result.fields,
        missing: result.missing,
        constraints: result.constraints,
        confidence: result.confidence,
        calleeTruth: run.truth ?? null,
        falseCompletion: run.score.falseCompletion,
        score: run.score.overall,
        endReason,
        turns: metrics.turns,
        transcript: transcript.map((t) => ({ id: t.id, source: t.source, text: t.text })),
        evidence: result.evidence.map((e) => ({ field: e.field, value: e.value, verified: e.verified, source: e.source, utteranceId: e.utteranceId, quote: e.span })),
        intake: { status: intake.status, answers: intake.answers.map((a) => ({ key: a.key, value: a.value, utteranceId: a.utteranceId })) },
        ...(saved ? { savedPath: saved } : {}),
      };
    },
  },
  {
    name: "verify_transcript",
    description:
      "Check a finished call transcript against a contract with the deterministic evidence engine. Input is the same JSON as `oathra verify`: { contract, referenceDate (YYYY-MM-DD), connection, utterances: [{ id, source: caller|callee, text, t }] }. Nothing is uploaded, saved or dialled.",
    inputSchema: {
      type: "object",
      properties: {
        contract: { type: "object", description: "CallContract: goal, language, require, constraints" },
        referenceDate: { type: "string", description: "YYYY-MM-DD used to resolve relative dates such as 明日 / tomorrow" },
        connection: { type: "string", enum: ["idle", "dialing", "active", "completed", "failed"] },
        utterances: { type: "array", items: { type: "object" }, description: "Final transcripts in conversation order" },
      },
      required: ["contract", "referenceDate", "connection", "utterances"],
    },
    run: (args) => {
      const r = verifyTranscript(args);
      return { status: r.status, complete: r.complete, fields: r.fields, missing: r.missing, constraints: r.constraints, confidence: r.confidence, evidence: r.evidence };
    },
  },
  {
    name: "list_calls",
    description: "List saved call recordings (simulated or real) in this project's .oathra/calls, newest last.",
    inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false },
    run: (args, deps) => {
      const limit = typeof args.limit === "number" && args.limit >= 1 ? Math.min(100, Math.floor(args.limit)) : 20;
      return listCalls(deps.callsDir)
        .slice(-limit)
        .map((id) => {
          try {
            const rec = loadCall(id, deps.callsDir);
            const started = rec.events.find((e) => e.type === "call.started");
            return { callId: id, scenario: started?.type === "call.started" ? started.scenario ?? null : null, transport: started?.type === "call.started" ? started.transport : null, status: rec.result.status, durationMs: rec.metrics.durationMs };
          } catch {
            return { callId: id, unreadable: true };
          }
        });
    },
  },
  {
    name: "inspect_call",
    description: 'Read a saved call: verified result, transcript and the evidence behind each field. Pass `at` (milliseconds or "mm:ss") to see what was verified and pending at that moment of the call.',
    inputSchema: {
      type: "object",
      properties: { callId: { type: "string" }, at: { type: ["string", "number"], description: 'Optional point in time, e.g. "00:12" or 12000' } },
      required: ["callId"],
      additionalProperties: false,
    },
    run: (args, deps) => {
      const rec = loadCall(callId(args), deps.callsDir);
      if (args.at !== undefined) {
        const snap = snapshotAt(rec.events, parseAt(args.at));
        return { callId: rec.callId, at: snap.t, agentState: snap.agentState, transcript: snap.transcript.map((t) => ({ id: t.id, source: t.source, text: t.text })), verified: snap.verified, pending: snap.pending };
      }
      const started = rec.events.find((e) => e.type === "call.started");
      return {
        callId: rec.callId,
        transport: started?.type === "call.started" ? started.transport : null,
        status: rec.result.status,
        complete: rec.result.complete,
        fields: rec.result.fields,
        missing: rec.result.missing,
        metrics: rec.metrics,
        transcript: rec.transcript.map((t) => ({ id: t.id, source: t.source, text: t.text, t: t.t })),
        evidence: rec.result.evidence.map((e) => ({ field: e.field, value: e.value, verified: e.verified, source: e.source, utteranceId: e.utteranceId, quote: e.span })),
      };
    },
  },
];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Handle one JSON-RPC message. Returns undefined for notifications. */
export async function handleMcpMessage(message: unknown, deps: McpDeps): Promise<JsonRpcResponse | undefined> {
  if (!isObject(message) || message.jsonrpc !== "2.0" || typeof (message as JsonRpcRequest).method !== "string") {
    return { jsonrpc: "2.0", id: isObject(message) && (typeof message.id === "string" || typeof message.id === "number") ? message.id : null, error: { code: -32600, message: "Invalid Request" } };
  }
  const req = message as JsonRpcRequest & { method: string };
  if (req.id === undefined || req.id === null) return undefined; // notification (e.g. notifications/initialized)
  const id = req.id;
  const params = isObject(req.params) ? req.params : {};
  const ok = (result: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id, result });

  switch (req.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      return ok({
        protocolVersion: SUPPORTED_PROTOCOLS.includes(asked) ? asked : SUPPORTED_PROTOCOLS[0],
        capabilities: { tools: {} },
        serverInfo: { name: "oathra", version: deps.version },
        instructions: "Oathra checks phone-call outcomes against evidence from the callee's own words. These tools are local and simulated; no real phone call is placed.",
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return { jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown tool: ${String(params.name)}` } };
      try {
        const value = await tool.run(isObject(params.arguments) ? params.arguments : {}, deps);
        return ok({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: Array.isArray(value) ? { items: value } : value, isError: false });
      } catch (e) {
        // Tool failures are results the model can read and correct, not protocol errors.
        return ok({ content: [{ type: "text", text: (e as Error).message }], isError: true });
      }
    }
    default:
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${req.method}` } };
  }
}

export async function serveMcpStdio(version: string): Promise<void> {
  const out = process.stdout;
  const write = (r: JsonRpcResponse) => out.write(`${JSON.stringify(r)}\n`);
  // stdout carries the protocol; anything a library prints must not corrupt it.
  console.log = (...args: unknown[]) => console.error(...args);
  const deps: McpDeps = { version, scenarios: () => loadScenarioDir(scenariosDir()), callsDir: defaultCallsDir() };

  let chain: Promise<void> = Promise.resolve();
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    chain = chain.then(async () => {
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
        return;
      }
      const response = await handleMcpMessage(message, deps);
      if (response) write(response);
    });
  });
  await new Promise<void>((res) => rl.on("close", res));
  await chain;
}
