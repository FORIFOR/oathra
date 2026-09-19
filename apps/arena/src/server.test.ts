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
});
