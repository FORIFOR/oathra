import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CallContract } from "@oathra/contract";
import type { VerifiedResult } from "@oathra/evidence";
import { EventLog, type CallEvent, type Turn, type TurnTrace } from "@oathra/core";
import type { CallMetrics, CallOutcome } from "@oathra/runtime";

export type CallRecording = {
  callId: string;
  contract: CallContract;
  events: CallEvent[];
  result: VerifiedResult;
  metrics: CallMetrics;
  transcript: Turn[];
  traces: TurnTrace[];
};

export function defaultCallsDir(cwd = process.cwd()): string {
  return resolve(cwd, ".oathra", "calls");
}

/**
 * Persist a call as a directory:
 *   <dir>/<callId>/events.jsonl · contract.json · result.json · metrics.json · transcript.json
 * Audio (caller.opus / callee.opus / mixed.opus) is added by audio transports.
 */
export function saveCall(outcome: CallOutcome, dir = defaultCallsDir()): string {
  const target = join(dir, outcome.callId);
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "events.jsonl"), outcome.events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  writeFileSync(join(target, "contract.json"), JSON.stringify(outcome.contract, null, 2));
  writeFileSync(join(target, "result.json"), JSON.stringify(outcome.result, null, 2));
  writeFileSync(join(target, "metrics.json"), JSON.stringify(outcome.metrics, null, 2));
  writeFileSync(join(target, "transcript.json"), JSON.stringify(outcome.transcript, null, 2));
  writeFileSync(join(target, "traces.json"), JSON.stringify(outcome.traces, null, 2));
  return target;
}

export function loadCall(pathOrId: string, dir = defaultCallsDir()): CallRecording {
  const target = existsSync(join(pathOrId, "events.jsonl")) ? pathOrId : join(dir, pathOrId);
  const read = <T>(name: string): T => JSON.parse(readFileSync(join(target, name), "utf8")) as T;
  const events = EventLog.fromJSONL(readFileSync(join(target, "events.jsonl"), "utf8"));
  const started = events.find((e) => e.type === "call.started");
  return {
    callId: started && started.type === "call.started" ? started.callId : pathOrId,
    contract: read<CallContract>("contract.json"),
    events,
    result: read<VerifiedResult>("result.json"),
    metrics: read<CallMetrics>("metrics.json"),
    transcript: existsSync(join(target, "transcript.json")) ? read<Turn[]>("transcript.json") : transcriptFromEvents(events),
    traces: existsSync(join(target, "traces.json")) ? read<TurnTrace[]>("traces.json") : events.flatMap((e) => (e.type === "turn.trace" ? [e.trace] : [])),
  };
}

export function listCalls(dir = defaultCallsDir()): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((d) => existsSync(join(dir, d, "events.jsonl")))
    .sort();
}

export function transcriptFromEvents(events: CallEvent[]): Turn[] {
  return events.flatMap((e) =>
    e.type === "transcript.final" ? [{ id: e.turnId, source: e.source, text: e.text, t: e.endMs }] : [],
  );
}

/** Reconstruct the state of the call at a point in time (time-travel). */
export type Snapshot = {
  t: number;
  agentState: string;
  ux: string;
  transcript: Turn[];
  verified: Record<string, unknown>;
  pending: Record<string, unknown>;
  lastTrace?: TurnTrace;
};

export function snapshotAt(events: CallEvent[], t: number): Snapshot {
  const snap: Snapshot = { t, agentState: "IDLE", ux: "idle", transcript: [], verified: {}, pending: {} };
  for (const e of events) {
    if (e.t > t) break;
    switch (e.type) {
      case "state.changed":
        snap.agentState = e.to;
        snap.ux = e.ux;
        break;
      case "transcript.final":
        snap.transcript.push({ id: e.turnId, source: e.source, text: e.text, t: e.endMs });
        break;
      case "evidence.created":
        if (!e.evidence.verified) snap.pending[e.evidence.field] = e.evidence.value;
        else snap.verified[e.evidence.field] = e.evidence.value;
        break;
      case "evidence.verified":
        snap.verified[e.evidence.field] = e.evidence.value;
        delete snap.pending[e.evidence.field];
        break;
      case "turn.trace":
        snap.lastTrace = e.trace;
        break;
      default:
        break;
    }
  }
  return snap;
}

/** Human-readable timeline, one line per notable event. */
export function renderTimeline(events: CallEvent[]): string[] {
  const ms = (t: number) => `${String(Math.floor(t / 60000)).padStart(2, "0")}:${String(Math.floor((t % 60000) / 1000)).padStart(2, "0")}.${String(t % 1000).padStart(3, "0")}`;
  const lines: string[] = [];
  for (const e of events) {
    switch (e.type) {
      case "call.started": lines.push(`${ms(e.t)}  call.started      ${e.transport} / ${e.brain}`); break;
      case "call.connected": lines.push(`${ms(e.t)}  connected         ${e.callee ?? ""}`); break;
      case "transcript.final": lines.push(`${ms(e.t)}  ${e.source === "caller" ? "agent " : "callee"}            ${e.text}`); break;
      case "evidence.created": lines.push(`${ms(e.t)}  evidence          ${e.evidence.field} = ${JSON.stringify(e.evidence.value)} (${e.evidence.source}${e.evidence.verified ? ", verified" : ""})`); break;
      case "evidence.verified": lines.push(`${ms(e.t)}  verified          ${e.evidence.field} = ${JSON.stringify(e.evidence.value)}`); break;
      case "state.changed": lines.push(`${ms(e.t)}  state             ${e.from} → ${e.to}`); break;
      case "turn.trace": lines.push(`${ms(e.t)}  ttfa              ${e.trace.ttfaMs ?? "?"} ms`); break;
      case "permission.requested": lines.push(`${ms(e.t)}  permission?       ${e.action}: ${e.detail}`); break;
      case "permission.decided": lines.push(`${ms(e.t)}  permission        ${e.action} ${e.approved ? "approved" : "denied"} by ${e.by}`); break;
      case "call.ended": lines.push(`${ms(e.t)}  call.ended        ${e.reason}`); break;
      case "result": lines.push(`${ms(e.t)}  result            ${e.result.status}`); break;
      case "error": lines.push(`${ms(e.t)}  error             ${e.message}`); break;
      default: break;
    }
  }
  return lines;
}
