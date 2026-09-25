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
import { timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PHONE_PURPOSE_TEMPLATES, PhoneRequestSchema } from "@oathra/contract";
import type { BrainProvider, CallEvent } from "@oathra/core";
import { runScenario, scoreRun, type OathraScore } from "@oathra/eval";
import { defaultCallsDir, listCalls, loadCall, renderCallSummary, saveCall } from "@oathra/replay";
import type { CallOutcome } from "@oathra/runtime";
import { loadScenarioDir, type Scenario } from "@oathra/scenario";
import { ContactStore, ContactError } from "./contacts.js";
import { PhoneService, PhoneServiceError, type PhoneDialer } from "./phone-service.js";
import { HumanCharacter } from "@oathra/simulator";

export type ArenaOptions = {
  scenariosDir: string;
  brains: Record<string, () => BrainProvider>;
  port?: number;
  host?: string;
  publicDir?: string;
  callsDir?: string;
  /** Local contact storage; defaults to a sibling of callsDir. */
  contactsDir?: string;
  /** Optional real telephone adapter. No dialer means preparing only. */
  phoneDialer?: PhoneDialer;
  phoneHistoryDir?: string;
  /** Persist finished calls to disk (default true). */
  save?: boolean;
  /** Allow remote access (from LAN, VPN, or reverse proxy / tunnel). Default false. Requires `remoteToken`. */
  allowRemote?: boolean;
  /**
   * Shared secret for remote access. Every request must carry it (cookie set by `GET /?token=…`, or
   * `Authorization: Bearer …`); without it the phone dialer, contacts and call history would be public.
   */
  remoteToken?: string;
};

const REMOTE_COOKIE = "oathra_remote";
const MAX_BODY_BYTES = 256 * 1024;

function cookieValue(req: IncomingMessage, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function tokenMatches(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

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
  persistence: "pending" | "saved" | "failed" | "disabled";
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

class InvalidInputError extends Error {}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new InvalidInputError("request body too large");
    chunks.push(c as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  let body: unknown;
  try { body = JSON.parse(text); }
  catch { throw new InvalidInputError("invalid JSON"); }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new InvalidInputError("JSON object required");
  }
  return body as Record<string, unknown>;
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
    ...(s.mission.intake
      ? {
          intake: {
            purpose: s.mission.intake.purpose,
            consentPrompt: s.mission.intake.consentPrompt,
            maxQuestions: s.mission.intake.maxQuestions,
            stopOnDecline: s.mission.intake.stopOnDecline,
            ...(s.mission.intake.startAfter?.length ? { startAfter: s.mission.intake.startAfter } : {}),
            fields: s.mission.intake.fields,
          },
        }
      : {}),
    callee: { name: s.callee.persona.name, avatar: s.callee.persona.avatar ?? null },
  };
}

export type ArenaServer = { server: Server; url: string; close: () => Promise<void> };

export function createArenaServer(opts: ArenaOptions): Server {
  const remoteToken = opts.allowRemote ? opts.remoteToken : undefined;
  if (opts.allowRemote && !remoteToken) throw new Error("allowRemote requires remoteToken: without it the phone dialer, contacts and call history would be public");
  const publicDir = opts.publicDir ?? resolve(fileURLToPath(new URL("../public/", import.meta.url)));
  const callsDir = opts.callsDir ?? defaultCallsDir();
  const contacts = new ContactStore(opts.contactsDir ?? join(dirname(callsDir), "contacts"), callsDir);
  const phone = new PhoneService(opts.phoneHistoryDir ?? join(dirname(callsDir), "phone-history"), callsDir, opts.phoneDialer);
  const scenarios = loadScenarioDir(opts.scenariosDir).filter((s) => s.domain !== "generic"); // generic = real-call only
  const live = new Map<string, LiveCall>();
  const requests = new Map<string, { fingerprint: string; call: LiveCall }>();
  const persist = (call: LiveCall) => {
    if (!call.outcome || opts.save === false) return;
    try { saveCall(call.outcome, callsDir); call.persistence = "saved"; }
    catch { call.persistence = "failed"; }
  };

  const startCall = (scenario: Scenario, brainName: string, mode: "watch" | "play", speed: number, calleeName?: string): LiveCall => {
    const brainFactory = opts.brains[brainName];
    if (!brainFactory) throw new Error(`unknown brain "${brainName}"`);
    const brain = brainFactory();
    const id = `call_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const call: LiveCall = { id, scenario, brain: brainName, mode, status: "running", events: [], listeners: new Set(), startedAt: Date.now(), persistence: opts.save === false ? "disabled" : "pending" };
    if (mode === "play") {
      call.human = new HumanCharacter(calleeName ?? scenario.callee.persona.name, scenario.callee.greeting);
    }
    live.set(id, call);
    const broadcast = (e: CallEvent | { type: "done" }) => {
      for (const l of call.listeners) l(e);
    };
    const controller = new AbortController();
    call.cancel = () => controller.abort();
    void runScenario(scenario, {
      signal: controller.signal,
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
        persist(call);
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

      // Reject browser cross-origin access and DNS rebinding. This is a local tool by default.
      const host = req.headers.host ?? "";
      if (!opts.allowRemote) {
        if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) return json(res, 403, { error: "local host required", code: "LOCAL_ONLY" });
        if (req.headers.origin && req.headers.origin !== `http://${host}`) return json(res, 403, { error: "same origin required", code: "ORIGIN_DENIED" });
      } else {
        if (req.headers.origin) {
          try {
            const originHost = new URL(req.headers.origin).host;
            if (originHost !== host) return json(res, 403, { error: "same origin required", code: "ORIGIN_DENIED" });
          } catch {
            return json(res, 403, { error: "invalid origin", code: "ORIGIN_DENIED" });
          }
        }
        // Remote access is token-gated: the URL is the key. `GET /?token=…` turns it into a same-site cookie so
        // the page's own fetches and EventSource carry it; anything else needs the cookie or a Bearer header.
        const token = remoteToken!;
        const queryToken = url.searchParams.get("token");
        if (queryToken !== null && method === "GET" && path === "/") {
          if (!tokenMatches(queryToken, token)) return json(res, 403, { error: "invalid access token", code: "REMOTE_TOKEN_INVALID" });
          const secure = (req.headers["x-forwarded-proto"] ?? "").toString().split(",")[0]?.trim() === "https";
          res.writeHead(302, {
            location: "/",
            "cache-control": "no-store",
            "set-cookie": `${REMOTE_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${7 * 24 * 3600}${secure ? "; Secure" : ""}`,
          });
          return res.end();
        }
        const bearer = /^Bearer\s+(.+)$/i.exec((req.headers.authorization ?? "").toString())?.[1]?.trim();
        if (!tokenMatches(cookieValue(req, REMOTE_COOKIE), token) && !tokenMatches(bearer, token)) {
          if (method === "GET" && path === "/") {
            res.writeHead(401, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
            return res.end("<!doctype html><meta charset=\"utf-8\"><title>Oathra</title><p style=\"font: 16px system-ui; margin: 2em\">このサーバーはリモートアクセス用のトークンで保護されています。<code>oathra demo</code> の起動時に表示された、<code>?token=</code> 付きのURLで開いてください。<br>This server is protected by an access token. Open the URL printed by <code>oathra demo</code>, which includes <code>?token=</code>.</p>");
          }
          return json(res, 401, { error: "remote access token required", code: "REMOTE_TOKEN_REQUIRED" });
        }
      }

      if (path === "/api/contacts" && method === "GET") return json(res, 200, contacts.list());
      if (path === "/api/contacts" && method === "POST") return json(res, 201, { contact: contacts.save(await readBody(req)) });
      const contactRoute = /^\/api\/contacts\/([^/]+)$/.exec(path);
      if (contactRoute && method === "GET") return json(res, 200, contacts.detail(contactRoute[1]!));
      if (contactRoute && method === "PUT") return json(res, 200, { contact: contacts.save(await readBody(req), contactRoute[1]!) });

      if (path === "/api/phone/templates" && method === "GET") return json(res, 200, PHONE_PURPOSE_TEMPLATES);
      if (path === "/api/phone/status" && method === "GET") return json(res, 200, await phone.status());
      if (path === "/api/phone/history" && method === "GET") return json(res, 200, phone.list());
      if (path === "/api/phone/calls" && method === "POST") {
        const body = await readBody(req);
        if (typeof body.reviewId !== "string" || Object.keys(body).some(key => key !== "reviewId" && key !== "approved")) throw new InvalidInputError("reviewId and approved required; edit the request before review");
        const record = await phone.start(body.reviewId, body.approved);
        return json(res, 200, { record, callId: record.id });
      }
      const phoneRoute = /^\/api\/phone\/calls\/([^/]+)(?:\/(hangup|acknowledge))?$/.exec(path);
      if (phoneRoute && !phoneRoute[2] && method === "GET") return json(res, 200, phone.get(phoneRoute[1]!));
      if (phoneRoute && phoneRoute[2] === "acknowledge" && method === "POST") return json(res, 200, phone.acknowledge(phoneRoute[1]!, (await readBody(req)).confirmedEnded));
      if (phoneRoute && phoneRoute[2] === "hangup" && method === "POST") return json(res, 200, phone.hangup(phoneRoute[1]!));
      if (path === "/api/phone/prepare" && method === "POST") {
        const body = await readBody(req);
        const parsed = PhoneRequestSchema.safeParse({ ...body, schemaVersion: 1, kind: "oathra.phone-request" });
        if (!parsed.success) throw new InvalidInputError("invalid phone request");
        const request = parsed.data;
        const review = await phone.prepare(request);
        return json(res, 200, { request, state: "draft", execution: opts.phoneDialer ? "web" : "cli-only", reviewId: review.id, readiness: review.readiness, expiresAt: review.expiresAt });
      }
      if (path === "/api/scenarios" && method === "GET") return json(res, 200, scenarios.map(publicScenario));
      if (path === "/api/brains" && method === "GET") return json(res, 200, Object.keys(opts.brains));

      if (path === "/api/calls" && method === "POST") {
        const body = await readBody(req);
        if (typeof body.scenarioId !== "string" || !body.scenarioId.trim()) throw new InvalidInputError("scenarioId required");
        if (body.brain !== undefined && typeof body.brain !== "string") throw new InvalidInputError("brain must be a string");
        if (body.speed !== undefined && (typeof body.speed !== "number" || !Number.isFinite(body.speed) || body.speed <= 0)) throw new InvalidInputError("speed must be a finite positive number");
        if (body.calleeName !== undefined && typeof body.calleeName !== "string") throw new InvalidInputError("calleeName must be a string");
        const scenario = scenarios.find((s) => s.id === body.scenarioId);
        if (!scenario) return json(res, 404, { error: "scenario not found" });
        const brain = typeof body.brain === "string" ? body.brain : Object.keys(opts.brains)[0] ?? "scripted";
        if (!Object.hasOwn(opts.brains, brain)) return json(res, 400, { error: "unknown brain", code: "INVALID_INPUT" });
        if (body.mode !== undefined && body.mode !== "play" && body.mode !== "watch") return json(res, 400, { error: "unknown mode", code: "INVALID_INPUT" });
        const mode = body.mode === "play" ? "play" : "watch";
        const speed = typeof body.speed === "number" ? body.speed : 1;
        const calleeName = typeof body.calleeName === "string" ? body.calleeName : undefined;
        const key = req.headers["idempotency-key"];
        if (key !== undefined && (typeof key !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(key))) return json(res, 400, { error: "invalid idempotency key", code: "INVALID_INPUT" });
        const fingerprint = JSON.stringify([scenario.id, brain, mode, speed, calleeName]);
        const previous = typeof key === "string" ? requests.get(key) : undefined;
        if (previous && previous.fingerprint !== fingerprint) return json(res, 409, { error: "key already used for another request", code: "KEY_CONFLICT" });
        const call = previous?.call ?? startCall(scenario, brain, mode, speed, calleeName);
        if (typeof key === "string" && !previous) requests.set(key, { fingerprint, call });
        return json(res, 201, { callId: call.id, mode, brain, scenario: publicScenario(scenario) });
      }
      const requestKey = /^\/api\/requests\/([A-Za-z0-9_-]{8,128})$/.exec(path);
      if (requestKey && method === "GET") {
        const known = requests.get(requestKey[1]!);
        return known ? json(res, 200, { callId: known.call.id }) : json(res, 404, { error: "request not known in this process", code: "REQUEST_UNKNOWN" });
      }
      if (path === "/api/calls" && method === "GET") {
        return json(res, 200, [...live.values()].map((c) => ({ id: c.id, scenario: c.scenario.id, brain: c.brain, mode: c.mode, status: c.status, startedAt: c.startedAt })));
      }

      const m = /^\/api\/calls\/([^/]+)(?:\/(events|reply|hangup|save|artifact))?$/.exec(path);
      if (m) {
        const call = live.get(m[1]!);
        if (!call) return json(res, 404, { error: "call not found" });
        const sub = m[2];
        if (!sub && method === "GET") {
          return json(res, 200, {
            id: call.id,
            status: call.status,
            persistence: call.persistence,
            mode: call.mode,
            brain: call.brain,
            scenario: publicScenario(call.scenario),
            events: call.events,
            ...(call.outcome ? { result: call.outcome.result, metrics: call.outcome.metrics, transcript: call.outcome.transcript, endReason: call.outcome.endReason } : {}),
            ...(call.outcome ? { intake: call.outcome.intake } : {}),
            ...(call.score ? { score: call.score } : {}),
          });
        }
        if (sub === "save" && method === "POST") {
          if (!call.outcome) return json(res, 409, { error: "result not ready", code: "NOT_READY" });
          persist(call);
          return json(res, call.persistence === "failed" ? 503 : 200, { persistence: call.persistence });
        }
        if (sub === "artifact" && method === "GET") {
          if (!call.outcome) return json(res, 409, { error: "result not ready", code: "NOT_READY" });
          res.setHeader("content-disposition", `attachment; filename="${call.id}.json"`);
          return json(res, 200, { schemaVersion: 1, transport: "simulator", ...call.outcome, summary: renderCallSummary(call.outcome) });
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
          if (call.status !== "running") return json(res, 409, { error: "call has ended", code: "CALL_ENDED" });
          if (!call.human) return json(res, 400, { error: "not a play-mode call" });
          if (typeof body.text !== "string" || !body.text.trim()) throw new InvalidInputError("text required");
          call.human.reply(body.text.trim());
          return json(res, 200, { ok: true });
        }
        if (sub === "hangup" && method === "POST") {
          if (call.status === "running") call.cancel?.();
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
      const r = /^\/api\/replays\/([^/]+)(?:\/(artifact))?$/.exec(path);
      if (r && method === "GET") {
        try {
          const c = loadCall(r[1]!, callsDir);
          if (r[2] === "artifact") {
            const ended = c.events.findLast(e => e.type === "call.ended");
            const outcome = { ...c, endReason: ended?.type === "call.ended" ? ended.reason : "error", intake: c.intake ?? { status: "disabled", fields: [], answers: [], declined: [], askedQuestions: 0, maxQuestions: 0 } } as CallOutcome;
            res.setHeader("content-disposition", `attachment; filename="${c.callId}.json"`);
            const started = c.events.find(e => e.type === "call.started");
            return json(res, 200, { schemaVersion: 1, transport: started?.type === "call.started" ? started.transport : "unknown", ...outcome, summary: renderCallSummary(outcome) });
          }
          return json(res, 200, c);
        } catch {
          return json(res, 404, { error: "replay not found" });
        }
      }

      // Static files
      if (method === "GET" || method === "HEAD") {
        const rel = path === "/" ? "/index.html" : normalize(path);
        const file = join(publicDir, rel);
        if (file.startsWith(publicDir) && existsSync(file) && statSync(file).isFile()) {
          res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
          if (method === "HEAD") res.end();
          else res.end(readFileSync(file));
          return;
        }
      }
      json(res, 404, { error: "not found" });
    } catch (err) {
      if (err instanceof PhoneServiceError) return json(res, err.status, { error: err.message, code: err.code });
      if (err instanceof ContactError) return json(res, err.status, { error: err.message, code: err.code, ...(err.issues ? { issues: err.issues } : {}) });
      json(res, err instanceof InvalidInputError ? 400 : 500, { error: (err as Error).message, code: err instanceof InvalidInputError ? "INVALID_INPUT" : "INTERNAL_ERROR" });
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
