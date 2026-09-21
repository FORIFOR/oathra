import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { preparePhoneRequest } from "@oathra/contract";
import { PhoneService, type PhoneCallRecord } from "./phone-service.js";
import { startArena, type ArenaServer } from "./server.js";

// Boundary input only, never submitted to any telephone adapter/provider.
// All persistence/HTTP checks use real local storage/server; no successful call is simulated.
const input = { phone: "+81312345678", name: "ローカル入力検証", instruction: "入力・承認境界と保存の検証。電話は発信しない。" };
const root = mkdtempSync(join(tmpdir(), "oathra-phone-service-"));
let arena: ArenaServer;
beforeAll(async () => { arena = await startArena({ scenariosDir: resolve(import.meta.dirname, "../../../scenarios"), brains: {}, callsDir: join(root, "calls"), port: 0 }); });
afterAll(async () => { arena.server.closeAllConnections(); await arena.close(); rmSync(root, { recursive: true, force: true }); });
const http = (path: string, method = "GET", body?: unknown, headers = {}) => fetch(arena.url + path, { method, headers: { "Content-Type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

it("prepares a durable private draft, refuses approval without adapter, preserves the legacy handoff", async () => {
  expect((await (await http("/api/phone/status")).json()).ready).toBe(false);
  const templates = await (await http("/api/phone/templates")).json();
  expect(templates.length).toBeGreaterThan(3);
  expect(await (await http("/api/phone/history")).json()).toEqual([]);
  const prepared = await http("/api/phone/prepare", "POST", input);
  expect(prepared.status).toBe(200);
  const review = await prepared.json();
  expect(review).toMatchObject({ state: "draft", execution: "cli-only", request: preparePhoneRequest(input), readiness: { ready: false } });
  const file = join(root, "phone-history", `${review.reviewId}.json`);
  expect(statSync(file).mode & 0o777).toBe(0o600);
  expect(JSON.parse(readFileSync(file, "utf8")).state).toBe("draft");
  expect((await http("/api/phone/calls", "POST", { reviewId: review.reviewId })).status).toBe(400);
  const denied = await http("/api/phone/calls", "POST", { reviewId: review.reviewId, approved: true });
  expect(denied.status).toBe(409);
  expect((await denied.json()).code).toBe("PHONE_NOT_READY");
  expect((await http("/api/phone/calls", "POST", { reviewId: review.reviewId, approved: true, phone: input.phone })).status).toBe(400);
  expect((await http("/api/phone/calls", "POST", { reviewId: review.reviewId, approved: true }, { Origin: "https://example.com" })).status).toBe(403);
  const detail = await (await http(`/api/phone/calls/${review.reviewId}`)).json();
  expect(detail.state).toBe("draft");
  expect((await new PhoneService(join(root, "phone-history"), join(root, "calls")).get(review.reviewId)).request).toEqual(review.request);
  expect(await (await http("/api/calls")).json()).toEqual([]);
});

it("rejects an expired review and does not erase a corrupted history file", async () => {
  const dir = join(root, "expiry");
  const service = new PhoneService(dir, join(root, "calls"));
  const review = await service.prepare(preparePhoneRequest(input));
  const path = join(dir, `${review.id}.json`);
  review.expiresAt = new Date(0).toISOString();
  writeFileSync(path, JSON.stringify(review));
  await expect(service.start(review.id, true)).rejects.toMatchObject({ code: "PHONE_REVIEW_EXPIRED" });
  writeFileSync(path, "{incomplete");
  expect(() => service.list()).toThrow("電話履歴を保存・読み込みできません");
  expect(readFileSync(path, "utf8")).toBe("{incomplete");
});

it("fails closed when saving is impossible; interrupted durable claims can never be reissued", async () => {
  const path = join(root, "not-a-directory");
  writeFileSync(path, "existing file");
  await expect(new PhoneService(path, join(root, "calls")).prepare(preparePhoneRequest(input))).rejects.toMatchObject({ code: "PHONE_STORAGE_ERROR" });
  const dir = join(root, "recovery");
  const service = new PhoneService(dir, join(root, "calls"));
  const review = await service.prepare(preparePhoneRequest(input));
  // Crash-state boundary: no dialer runs; mutate the durable approval state to model process loss.
  const interrupted: PhoneCallRecord = { ...review, state: "starting" };
  writeFileSync(join(dir, `${review.id}.json`), JSON.stringify(interrupted));
  const restored = new PhoneService(dir, join(root, "calls"));
  expect(restored.get(review.id).state).toBe("unknown");
  expect((await restored.start(review.id, true)).state).toBe("unknown");
  expect(restored.hangup(review.id).state).toBe("unknown");
  expect(restored.list()).toHaveLength(1);
});

it("blocks a different review until unknown termination is explicitly acknowledged, without rewriting it as success", async () => {
  const dir = join(root, "serial");
  const service = new PhoneService(dir, join(root, "calls"));
  const first = await service.prepare(preparePhoneRequest(input));
  const second = await service.prepare(preparePhoneRequest(input));
  writeFileSync(join(dir, `${first.id}.json`), JSON.stringify({ ...first, state: "starting", ownerPid: process.pid }));
  await expect(service.start(second.id, true)).rejects.toMatchObject({ code: "PHONE_CALL_ACTIVE" });
  writeFileSync(join(dir, `${first.id}.json`), JSON.stringify({ ...first, state: "starting" }));
  await expect(service.start(second.id, true)).rejects.toMatchObject({ code: "PHONE_CALL_ACTIVE" });
  expect(() => service.acknowledge(first.id, false)).toThrow("通信事業者で通話終了を確認してください");
  const acknowledged = service.acknowledge(first.id, true);
  expect(acknowledged.state).toBe("unknown");
  expect(acknowledged.resolvedAt).toBeTruthy();
  await expect(service.start(second.id, true)).rejects.toMatchObject({ code: "PHONE_NOT_READY" });
  expect((await service.start(first.id, true)).state).toBe("unknown");
  expect(() => service.acknowledge(second.id, true)).toThrow("結果未確認の履歴のみ");
});

it("recovers from a lock left by a dead process, keeps a fresh one, and frees a finished call from memory", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oathra-phone-lock-")), lock = join(dir, ".approval-lock");
  const readiness = { ready: true, issues: [], provider: "local", engine: "local", recording: false, disclosure: "local boundary" };
  let finish: (() => void) | undefined;
  // A dialer that only waits: no carrier, no audio, no provider request.
  const service = new PhoneService(dir, join(dir, "calls"), { inspect: () => readiness, execute: () => new Promise((_, reject) => { finish = () => reject(new Error("local boundary ended")); }) });
  try {
    const first = await service.prepare(preparePhoneRequest(input));
    mkdirSync(lock);
    // Another process is inside the short approval section right now: refuse, do not steal its lock.
    await expect(service.start(first.id, true)).rejects.toMatchObject({ code: "PHONE_APPROVAL_BUSY" });
    expect(service.get(first.id).state).toBe("draft");
    // The same lock two minutes old was left by a process that died; it must not block calls forever.
    const old = new Date(Date.now() - 120_000);
    utimesSync(lock, old, old);
    expect((await service.start(first.id, true)).state).toBe("starting");
    expect(existsSync(lock)).toBe(false);
    const internals = service as unknown as { active: Map<string, unknown> };
    expect(internals.active.has(first.id)).toBe(true);
    finish!();
    await new Promise((resolve) => setTimeout(resolve, 50));
    // The outcome is on disk, so the finished call no longer lives in memory; it still reads back.
    expect(internals.active.has(first.id)).toBe(false);
    expect(service.get(first.id).state).toBe("unknown");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
