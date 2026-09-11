/**
 * Arena server — a dependency-free HTTP + SSE server so `npx oathra demo`
 * needs no build step and no framework.
 *
 * API
 *   GET  /api/scenarios                 list scenarios
 *   GET  /api/brains                    list brain names
 *   POST /api/calls                     { scenarioId, brain?, mode?: "watch"|"play", speed?, calleeName? } -> { callId }
 *   GET  /api/calls                     recent calls (id, scenario, status)
 *   GET  /api/calls/:id                 { status, events, outcome?, score? }
 *   GET  /api/calls/:id/events          SSE: every CallEvent so far, then live; "done" at the end
 *   POST /api/calls/:id/reply           { text }   (play mode: human callee speaks)
 *   POST /api/calls/:id/hangup          end the call
 *   GET  /api/replays                   saved calls on disk
 *   GET  /api/replays/:id               a saved call (events, result, metrics)
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { BrainProvider, CallEvent } from "@oathra/core";
import { runScenario, scoreRun, type OathraScore } from "@oathra/eval";
import { defaultCallsDir, listCalls, loadCall, saveCall } from "@oathra/replay";
import type { CallOutcome } from "@oathra/runtime";
import { loadScenarioDir, type Scenario } from "@oathra/scenario";
import { HumanCharacter } from "@oathra/simulator";

export type ArenaOptions = {
  scenariosDir: string;
  brains: Record<string, () => BrainProvider>;
  port?: number;
  host?: string;
  publicDir?: string;
  callsDir?: string;
  /** Persist finished calls to disk (default true). */
  save?: boolean;
};

type LiveCall = {
  id: string;
  scenario: Scenario;
  brain: string;
  mode: "watch" | "play";
  status: "running" | "done" | "error";
  events: CallEvent[];
  listeners: Set<(e: CallEvent | { type: "done" }) => void>;
  human?: HumanCharacter;
  outcome?: CallOutcome;
  score?: OathraScore;
  cancel?: () => void;
  startedAt: number;
};

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  return JSON.parse(text) as Record<string, unknown>;
}

function publicScenario(s: Scenario) {
  return {
    id: s.id,
    title: s.title,
    description: s.description ?? "",
    difficulty: s.difficulty,
    language: s.language,
    domain: s.domain,
    tags: s.tags,
    brief: s.mission.brief ?? "",
    objective: s.mission.objective,
    require: s.mission.require,
    constraints: s.mission.constraints,
    permissions: s.mission.permissions,
    input: s.mission.input,
    callee: { name: s.callee.persona.name, avatar: s.callee.persona.avatar ?? null },
  };
}

export type ArenaServer = { server: Server; url: string; close: () => Promise<void> };

export function createArenaServer(opts: ArenaOptions): Server {
  const publicDir = opts.publicDir ?? resolve(fileURLToPath(new URL("../public/", import.meta.url)));
  const callsDir = opts.callsDir ?? defaultCallsDir();
  const scenarios = loadScenarioDir(opts.scenariosDir).filter((s) => s.domain !== "generic"); // generic = real-call only
  const live = new Map<string, LiveCall>();

  const startCall = (scenario: Scenario, brainName: string, mode: "watch" | "play", speed: number, calleeName?: string): LiveCall => {
    const brainFactory = opts.brains[brainName];
    if (!brainFactory) throw new Error(`unknown brain "${brainName}"`);
    const brain = brainFactory();
    const id = `call_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const call: LiveCall = { id, scenario, brain: brainName, mode, status: "running", events: [], listeners: new Set(), startedAt: Date.now() };
    if (mode === "play") {
      call.human = new HumanCharacter(calleeName ?? scenario.callee.persona.name, scenario.callee.greeting);
    }
    live.set(id, call);
    const broadcast = (e: CallEvent | { type: "done" }) => {
      for (const l of call.listeners) l(e);
    };
    void runScenario(scenario, {
      brain,
      pace: "realtime",
      callId: id,
      // A human answering the phone needs time to say hello before the agent opens.
      ...(call.human ? { openingTimeoutMs: 6000 } : {}),
      ...(call.human ? { character: call.human } : {}),
      onEvent: (e) => {
        call.events.push(e);
        broadcast(e);
      },
    })
      .then((run) => {
        // realtime pace with a speed multiplier is handled by the transport; speed is advisory here.
        void speed;
        call.outcome = run.outcome;
        call.score = mode === "play" ? scoreRun(scenario, run.outcome, undefined) : run.score;
        call.status = "done";
        if (opts.save !== false) {
          try {
            saveCall(run.outcome, callsDir);
          } catch {
            /* ignore persistence errors in demo */
          }
        }
        broadcast({ type: "done" });
      })
      .catch((err: Error) => {
        call.status = "error";
        const e = { seq: call.events.length, t: Date.now() - call.startedAt, type: "error", message: err.message, fatal: true } as CallEvent;
        call.events.push(e);
        broadcast(e);
        broadcast({ type: "done" });
      });
    return call;
  };

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;
      const method = req.method ?? "GET";

      if (path === "/api/scenarios" && method === "GET") return json(res, 200, scenarios.map(publicScenario));
      if (path === "/api/brains" && method === "GET") return json(res, 200, Object.keys(opts.brains));

      if (path === "/api/calls" && method === "POST") {
        const body = await readBody(req);
        const scenario = scenarios.find((s) => s.id === body.scenarioId);
        if (!scenario) return json(res, 404, { error: "scenario not found" });
        const brain = typeof body.brain === "string" ? body.brain : Object.keys(opts.brains)[0] ?? "scripted";
        const mode = body.mode === "play" ? "play" : "watch";
        const speed = typeof body.speed === "number" ? body.speed : 1;
        const calleeName = typeof body.calleeName === "string" ? body.calleeName : undefined;
        const call = startCall(scenario, brain, mode, speed, calleeName);
        return json(res, 201, { callId: call.id, mode, brain, scenario: publicScenario(scenario) });
      }
      if (path === "/api/calls" && method === "GET") {
        return json(res, 200, [...live.values()].map((c) => ({ id: c.id, scenario: c.scenario.id, brain: c.brain, mode: c.mode, status: c.status, startedAt: c.startedAt })));
      }

      const m = /^\/api\/calls\/([^/]+)(?:\/(events|reply|hangup))?$/.exec(path);
      if (m) {
        const call = live.get(m[1]!);
        if (!call) return json(res, 404, { error: "call not found" });
        const sub = m[2];
        if (!sub && method === "GET") {
          return json(res, 200, {
            id: call.id,
            status: call.status,
            mode: call.mode,
            brain: call.brain,
            scenario: publicScenario(call.scenario),
            events: call.events,
            ...(call.outcome ? { result: call.outcome.result, metrics: call.outcome.metrics, transcript: call.outcome.transcript, endReason: call.outcome.endReason } : {}),
            ...(call.score ? { score: call.score } : {}),
          });
        }
        if (sub === "events" && method === "GET") {
          res.writeHead(200, {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-store",
            connection: "keep-alive",
            "x-accel-buffering": "no",
          });
          const send = (e: CallEvent | { type: "done" }) => {
            res.write(`event: ${e.type === "done" ? "done" : "call"}\ndata: ${JSON.stringify(e)}\n\n`);
          };
          for (const e of call.events) send(e);
          if (call.status !== "running") {
            send({ type: "done" });
            res.end();
            return;
          }
          const listener = (e: CallEvent | { type: "done" }) => {
            send(e);
            if (e.type === "done") res.end();
          };
          call.listeners.add(listener);
          const ping = setInterval(() => res.write(": ping\n\n"), 15000);
          req.on("close", () => {
            clearInterval(ping);
            call.listeners.delete(listener);
          });
          return;
        }
        if (sub === "reply" && method === "POST") {
          const body = await readBody(req);
          if (!call.human) return json(res, 400, { error: "not a play-mode call" });
          if (typeof body.text !== "string" || !body.text.trim()) return json(res, 400, { error: "text required" });
          call.human.reply(body.text.trim());
          return json(res, 200, { ok: true });
        }
        if (sub === "hangup" && method === "POST") {
          if (call.human) call.human.hangup();
          else call.cancel?.();
          return json(res, 200, { ok: true });
        }
      }

      if (path === "/api/replays" && method === "GET") {
        return json(res, 200, listCalls(callsDir).map((id) => {
          try {
            const c = loadCall(id, callsDir);
            const started = c.events.find((e) => e.type === "call.started");
            return { id, scenario: started && started.type === "call.started" ? started.scenario ?? null : null, status: c.result.status, durationMs: c.metrics.durationMs };
          } catch {
            return { id, status: "unreadable" };
          }
        }));
      }
      const r = /^\/api\/replays\/([^/]+)$/.exec(path);
      if (r && method === "GET") {
        try {
          const c = loadCall(r[1]!, callsDir);
          return json(res, 200, c);
        } catch {
          return json(res, 404, { error: "replay not found" });
        }
      }

      // Static files
      if (method === "GET") {
        const rel = path === "/" ? "/index.html" : normalize(path);
        const file = join(publicDir, rel);
        if (file.startsWith(publicDir) && existsSync(file) && statSync(file).isFile()) {
          res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
          res.end(readFileSync(file));
          return;
        }
      }
      json(res, 404, { error: "not found" });
    } catch (err) {
      json(res, 500, { error: (err as Error).message });
    }
  });
}

export async function startArena(opts: ArenaOptions): Promise<ArenaServer> {
  const server = createArenaServer(opts);
  const host = opts.host ?? "127.0.0.1";
  const port = opts.port ?? 4242;
  await new Promise<void>((res, rej) => {
    server.once("error", rej);
    server.listen(port, host, () => res());
  });
  const addr = server.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : port;
  return {
    server,
    url: `http://${host === "0.0.0.0" ? "localhost" : host}:${actualPort}`,
    close: () => new Promise<void>((res) => server.close(() => res())),
  };
}
