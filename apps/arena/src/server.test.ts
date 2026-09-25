import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScriptedAgent } from "@oathra/simulator";
import { createArenaServer } from "./server.js";

const root = mkdtempSync(join(tmpdir(), "oathra-arena-"));
const callsDir = join(root, "calls"), publicDir = join(root, "public");
mkdirSync(publicDir, { recursive: true });
writeFileSync(join(publicDir, "index.html"), "<!doctype html><title>arena</title>");
writeFileSync(join(publicDir, "app.js"), "console.log('arena')");
writeFileSync(join(root, "secret.txt"), "outside the public directory");

const server = createArenaServer({ scenariosDir: resolve(import.meta.dirname, "../../../scenarios"), brains: { scripted: () => new ScriptedAgent() }, publicDir, callsDir });
let base = "";
beforeAll(async () => { await new Promise<void>((r) => server.listen(0, "127.0.0.1", r)); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; });
afterAll(async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); rmSync(root, { recursive: true, force: true }); });

const get = (path: string) => fetch(base + path);
const post = (path: string, body?: unknown) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? "" : JSON.stringify(body) });

describe("Arena API", () => {
  it("lists playable scenarios with the mission only; the callee's script and ground truth stay on the server", async () => {
    const scenarios = (await (await get("/api/scenarios")).json()) as Array<Record<string, unknown>>;
    const ids = scenarios.map((s) => s.id);
    expect(ids).toContain("restaurant-reservation");
    expect(ids).toContain("false-completion-trap");
    const one = scenarios.find((s) => s.id === "restaurant-reservation")!;
    expect(one).toMatchObject({ language: "ja", require: { confirmed: true } });
    // Only what the player may see of the other side: a name and an avatar. No greeting script, knowledge, win condition or seed.
    expect(Object.keys(one.callee as object).sort()).toEqual(["avatar", "name"]);
    for (const hidden of ["knowledge", "win", "score", "seed", "greeting"]) expect(JSON.stringify(one), hidden).not.toContain(`"${hidden}"`);
    expect(await (await get("/api/brains")).json()).toEqual(["scripted"]);
  });

  it("rejects an unknown scenario or brain without starting a call", async () => {
    expect((await post("/api/calls", { scenarioId: "nope" })).status).toBe(404);
    expect((await post("/api/calls", { scenarioId: "restaurant-reservation", brain: "nope" })).status).toBeGreaterThanOrEqual(400);
    expect(await (await get("/api/calls")).json()).toEqual([]);
    expect((await get("/api/calls/call_missing")).status).toBe(404);
  });

  it("play mode: a person answers and hangs up; nothing is booked, and the finished call is saved for replay", async () => {
    const started = await post("/api/calls", { scenarioId: "restaurant-reservation", mode: "play", calleeName: "あなた" });
    expect(started.status).toBe(201);
    const { callId, mode } = (await started.json()) as { callId: string; mode: string };
    expect(mode).toBe("play");

    expect((await post(`/api/calls/${callId}/reply`, { text: "   " })).status).toBe(400);
    expect((await post(`/api/calls/${callId}/reply`, {})).status).toBe(400);
    // The Arena runs at the pace of real speech, so the test keeps the call as short as a call can be.
    expect((await post(`/api/calls/${callId}/hangup`)).status).toBe(200);

    // The event stream replays what happened and then says it is done.
    const stream = await (await get(`/api/calls/${callId}/events`)).text();
    expect(stream).toContain("event: call\n");
    expect(stream.trimEnd().endsWith('event: done\ndata: {"type":"done"}')).toBe(true);

    const call = (await (await get(`/api/calls/${callId}`)).json()) as { status: string; result: { status: string; complete: boolean; fields: Record<string, unknown> }; score: { falseCompletion: boolean } };
    expect(call.status).toBe("done");
    expect(call.result.complete).toBe(false);
    expect(call.result.fields.confirmed).toBeUndefined();
    expect(call.score.falseCompletion).toBe(false);

    const replays = (await (await get("/api/replays")).json()) as Array<{ id: string; status: string }>;
    expect(replays).toContainEqual(expect.objectContaining({ id: callId, status: call.result.status }));
    const replay = (await (await get(`/api/replays/${callId}`)).json()) as { callId: string; events: unknown[] };
    expect(replay.callId).toBe(callId);
    expect(replay.events.length).toBeGreaterThan(0);
  }, 90_000);

  it("reply is refused on a call nobody is answering", async () => {
    const { callId } = (await (await post("/api/calls", { scenarioId: "restaurant-reservation", mode: "watch" })).json()) as { callId: string };
    expect((await post(`/api/calls/${callId}/reply`, { text: "はい" })).status).toBe(400);
    expect((await post(`/api/calls/${callId}/hangup`)).status).toBe(200);
  });

  it("serves only files inside the public directory", async () => {
    const index = await get("/");
    expect([index.status, index.headers.get("content-type")]).toEqual([200, "text/html; charset=utf-8"]);
    expect((await get("/app.js")).headers.get("content-type")).toMatch(/javascript/);
    for (const path of ["/../secret.txt", "/..%2Fsecret.txt", "/%2e%2e/secret.txt", "/missing.css"]) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
      expect(await res.text()).not.toContain("outside the public directory");
    }
    expect((await get("/api/replays/..%2F..%2Fsecret")).status).toBe(404);
  });

  it("answers malformed JSON with an error instead of crashing", async () => {
    const res = await fetch(base + "/api/calls", { method: "POST", body: "{not json" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await get("/api/brains")).status).toBe(200);
  });

  it("enforces local-only host by default and rejects non-local host", async () => {
    const u = new URL(base);
    const { status, body } = await new Promise<{ status: number; body: string }>((res, rej) => {
      const { request } = import("node:http") as unknown as typeof import("node:http");
      const req = (import.meta.dirname ? (globalThis as any).process : null);
      import("node:http").then(({ request: reqFn }) => {
        const client = reqFn({ hostname: u.hostname, port: u.port, path: "/api/brains", headers: { Host: "remote.example.com" } }, (r) => {
          let str = "";
          r.on("data", (c) => str += c);
          r.on("end", () => res({ status: r.statusCode ?? 500, body: str }));
        });
        client.on("error", rej);
        client.end();
      });
    });
    expect(status).toBe(403);
    expect(JSON.parse(body).code).toBe("LOCAL_ONLY");
  });

  it("allowRemote refuses to start without a token", () => {
    expect(() => createArenaServer({ scenariosDir: resolve(import.meta.dirname, "../../../scenarios"), brains: { scripted: () => new ScriptedAgent() }, publicDir, callsDir, allowRemote: true })).toThrow(/remoteToken/);
  });

  it("allowRemote: every request needs the token; ?token= becomes a same-site cookie; origins must match", async () => {
    const token = "test-remote-token-123";
    const remoteServer = createArenaServer({ scenariosDir: resolve(import.meta.dirname, "../../../scenarios"), brains: { scripted: () => new ScriptedAgent() }, publicDir, callsDir, allowRemote: true, remoteToken: token });
    await new Promise<void>((r) => remoteServer.listen(0, "127.0.0.1", r));
    const remotePort = (remoteServer.address() as AddressInfo).port;
    const { request: reqFn } = await import("node:http");
    const call = (path: string, headers: Record<string, string>, method = "GET", body?: string) =>
      new Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }>((res, rej) => {
        const client = reqFn({ hostname: "127.0.0.1", port: remotePort, path, method, headers: { Host: "demo.oathra.ai", ...headers } }, (r) => {
          let str = "";
          r.on("data", (c) => str += c);
          r.on("end", () => res({ status: r.statusCode ?? 500, body: str, headers: r.headers }));
        });
        client.on("error", rej);
        if (body) client.write(body);
        client.end();
      });
    try {
      // No token: the API and the page are closed, even with a matching origin.
      expect((await call("/api/brains", { Origin: "https://demo.oathra.ai" })).status).toBe(401);
      expect(JSON.parse((await call("/api/brains", {})).body).code).toBe("REMOTE_TOKEN_REQUIRED");
      expect((await call("/", {})).status).toBe(401);
      // An origin-less POST (curl) cannot prepare or place a call.
      expect((await call("/api/phone/prepare", { "content-type": "application/json" }, "POST", "{}")).status).toBe(401);
      expect((await call("/api/contacts", { "content-type": "application/json" }, "POST", JSON.stringify({ name: "x" }))).status).toBe(401);
      // A wrong token is refused.
      expect((await call(`/?token=nope`, {})).status).toBe(403);
      // The printed URL sets the cookie and redirects to a clean path.
      const login = await call(`/?token=${token}`, {});
      expect(login.status).toBe(302);
      expect(login.headers.location).toBe("/");
      const cookie = String(login.headers["set-cookie"]);
      expect(cookie).toMatch(/oathra_remote=/);
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=Strict/);
      // The cookie (what the page's own fetches send) and a Bearer header both open the API.
      expect((await call("/api/brains", { Cookie: `oathra_remote=${token}`, Origin: "https://demo.oathra.ai" })).status).toBe(200);
      expect((await call("/api/brains", { Authorization: `Bearer ${token}` })).status).toBe(200);
      // A mismatched origin is still denied, token or not.
      const badRes = await call("/api/brains", { Cookie: `oathra_remote=${token}`, Origin: "https://attacker.com" });
      expect(badRes.status).toBe(403);
      expect(JSON.parse(badRes.body).code).toBe("ORIGIN_DENIED");
    } finally {
      remoteServer.closeAllConnections();
      await new Promise((r) => remoteServer.close(r));
    }
  });
});
