import { describe, expect, it } from "vitest";
import type { SipGateway } from "@oathra/phone";
import { createPlivoProvider, normalizeE164 } from "./index.js";

type Call = { url: string; method: string; body?: unknown };

function fakePlivo(opts: { numbers: string[] }): { fetchImpl: typeof fetch; calls: Call[]; addNumber(n: string): void } {
  const calls: Call[] = [];
  const numbers = [...opts.numbers];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: u, method, body });
    const auth = (init?.headers as Record<string, string>)?.authorization ?? "";
    if (!auth.startsWith("Basic ")) return new Response("{}", { status: 401 });
    if (/\/Account\/MA1\/$/.test(u)) return Response.json({ name: "Oathra Test", api_id: "x" });
    if (/\/Number\//.test(u)) return Response.json({ objects: numbers.map((n) => ({ number: n.replace("+", ""), voice_enabled: true })) });
    if (/\/Zentrunk\/Credential\/$/.test(u) && method === "POST") return Response.json({ credential_uuid: "cred-1" }, { status: 201 });
    if (/\/Zentrunk\/Trunk\/$/.test(u) && method === "POST") return Response.json({ trunk_id: "TR1" }, { status: 201 });
    if (/\/Zentrunk\/Trunk\/TR1\/$/.test(u)) return Response.json({ trunk_id: "TR1", trunk_domain: "TR1.zt.plivo.com" });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, calls, addNumber: (n) => numbers.push(n) };
}

function fakeGateway(): SipGateway & { ensured: unknown[] } {
  const ensured: unknown[] = [];
  return {
    id: "livekit",
    label: "Fake LiveKit",
    requires: [],
    ensured,
    async ensureTrunk(t) {
      ensured.push(t);
      return { trunkId: "ST_lk", created: true };
    },
    async listTrunks() {
      return ensured.length ? [{ trunkId: "ST_lk", address: "TR1.zt.plivo.com", numbers: ["+815012345678"] }] : [];
    },
    async removeTrunk() {},
    async dial() {
      throw new Error("no media");
    },
    async check() {
      return [{ label: "LiveKit connected", ok: true }];
    },
  };
}

const env = { PLIVO_AUTH_ID: "MA1", PLIVO_AUTH_TOKEN: "tok" };

describe("plivo provider", () => {
  it("normalises numbers", () => {
    expect(normalizeE164("815012345678")).toBe("+815012345678");
    expect(normalizeE164("+81 50-1234-5678")).toBe("+815012345678");
  });

  it("provisions end to end with a mocked API and gateway", async () => {
    const api = fakePlivo({ numbers: ["+815012345678"] });
    const gw = fakeGateway();
    const p = createPlivoProvider({ fetchImpl: api.fetchImpl, random: () => "abcdefghijkl" });
    const plan = await p.provision({ answers: { authId: "MA1", authToken: "tok" }, env: {}, gateway: gw });
    const results: Record<string, boolean> = {};
    for (const s of plan.steps) {
      if (s.type === "automatic") results[s.id] = (await s.run()).ok;
      else results[s.id] = await s.verify();
    }
    expect(results).toEqual({ auth: true, "caller-id": true, "buy-number": true, zentrunk: true, gateway: true });
    const r = await plan.finish();
    expect(r.config).toMatchObject({ callerId: "+815012345678", trunkId: "ST_lk", plivoTrunkId: "TR1", trunkDomain: "TR1.zt.plivo.com", gateway: "livekit" });
    expect(r.envKeys).toEqual(["PLIVO_AUTH_ID", "PLIVO_AUTH_TOKEN"]);
    const trunkCall = api.calls.find((c) => /Zentrunk\/Trunk\/$/.test(c.url));
    expect(trunkCall?.body).toMatchObject({ trunk_direction: "outbound", credential_uuid: "cred-1", secure: true });
    expect(gw.ensured[0]).toMatchObject({ address: "TR1.zt.plivo.com", transport: "tcp", username: "oathraabcdefgh", numbers: ["+815012345678"], provider: "plivo" });
    // secrets never land in the config file
    expect(JSON.stringify(r.config)).not.toContain("tok");
    expect(JSON.stringify(r.config)).not.toContain("abcdefghijkl!");
  });

  it("asks the human to buy a number when the account owns none, then verifies", async () => {
    const api = fakePlivo({ numbers: [] });
    const p = createPlivoProvider({ fetchImpl: api.fetchImpl });
    const plan = await p.provision({ answers: {}, env, gateway: fakeGateway() });
    const find = plan.steps.find((s) => s.id === "caller-id");
    expect(find?.type === "automatic" && (await find.run()).ok).toBe(false);
    const buy = plan.steps.find((s) => s.id === "buy-number");
    expect(buy?.type).toBe("user_action");
    expect(buy?.type === "user_action" && (await buy.verify())).toBe(false);
    api.addNumber("+815099999999");
    expect(buy?.type === "user_action" && (await buy.verify())).toBe(true);
  });

  it("fails auth cleanly", async () => {
    const api = fakePlivo({ numbers: [] });
    const p = createPlivoProvider({ fetchImpl: api.fetchImpl });
    const plan = await p.provision({ answers: { authId: "MA1", authToken: "" }, env: {}, gateway: fakeGateway() });
    const auth = plan.steps[0];
    expect(auth?.type === "automatic" && (await auth.run()).ok).toBe(false);
  });

  it("doctor and pricing", async () => {
    const api = fakePlivo({ numbers: ["+815012345678"] });
    const gw = fakeGateway();
    await gw.ensureTrunk({ address: "TR1.zt.plivo.com", numbers: ["+815012345678"], provider: "plivo" });
    const p = createPlivoProvider({ fetchImpl: api.fetchImpl });
    const rep = await p.doctor({ config: { callerId: "+815012345678", trunkId: "ST_lk", trunkDomain: "TR1.zt.plivo.com" }, env, gateway: gw }, { destination: "+819012345678" });
    expect(rep.ready).toBe(true);
    expect(rep.cost?.ratePerMin).toBe(0.1398);
    expect(p.pricing?.("+81312345678")?.ratePerMin).toBe(0.0385);
    const noKeys = await p.doctor({ config: {}, env: {}, gateway: gw }, {});
    expect(noKeys.ready).toBe(false);
  });
});
