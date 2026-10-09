import { describe, expect, it } from "vitest";
import type { SipGateway } from "@oathra/phone";
import { PhoneTransport, type CarrierEvent, type CarrierMediaSession } from "@oathra/phone";
import { MULAW_8K, OutputQueue, type VoiceEngine, type VoiceOutput } from "@oathra/voice";
import { createSipProvider, parseSipAddress, SipCarrierTransport } from "./index.js";

function fakeGateway(): SipGateway & { trunks: Array<{ trunkId: string; address: string; numbers: string[] }>; dialed: string[] } {
  const trunks: Array<{ trunkId: string; address: string; numbers: string[] }> = [];
  const dialed: string[] = [];
  return {
    id: "fake",
    label: "Fake gateway",
    requires: [],
    trunks,
    dialed,
    async ensureTrunk(t) {
      const existing = trunks.find((x) => x.address === t.address);
      if (existing) return { trunkId: existing.trunkId, created: false };
      const trunkId = `ST_${trunks.length + 1}`;
      trunks.push({ trunkId, address: t.address, numbers: t.numbers });
      return { trunkId, created: true };
    },
    async listTrunks() {
      return trunks;
    },
    async removeTrunk(id) {
      const i = trunks.findIndex((t) => t.trunkId === id);
      if (i >= 0) trunks.splice(i, 1);
    },
    async dial(trunkId, opts) {
      dialed.push(`${trunkId}:${opts.to}:${opts.callerId ?? ""}`);
      throw new Error("no media in test");
    },
    async check() {
      return [{ label: "Fake gateway", ok: true }];
    },
  };
}

describe("custom SIP provider", () => {
  it("parses addresses", () => {
    expect(parseSipAddress("sip.example.com")).toEqual({ host: "sip.example.com", port: 5060 });
    expect(parseSipAddress("sips:edge.example.com:5061")).toEqual({ host: "edge.example.com", port: 5061 });
    expect(() => parseSipAddress("not a host")).toThrow();
  });

  it("provisions: DNS then trunk registration, keeping the password out of the config", async () => {
    const gw = fakeGateway();
    const p = createSipProvider({ lookup: async () => "203.0.113.10" });
    const plan = await p.provision({ answers: { address: "sip.example.com", username: "oathra", password: "s3cret!", callerId: "+81312345678", transport: "tls" }, env: {}, gateway: gw });
    expect(plan.steps.map((s) => s.id)).toEqual(["dns", "trunk"]);
    for (const s of plan.steps) {
      if (s.type === "automatic") expect((await s.run()).ok).toBe(true);
    }
    const r = await plan.finish();
    expect(r.config).toMatchObject({ address: "sip.example.com", trunkId: "ST_1", callerId: "+81312345678", transport: "tls", gateway: "fake" });
    expect(JSON.stringify(r.config)).not.toContain("s3cret");
    expect(r.envKeys).toEqual(["SIP_PASSWORD"]);
    expect(gw.trunks[0]?.numbers).toEqual(["+81312345678"]);
  });

  it("dials through the gateway with the configured caller id", async () => {
    const gw = fakeGateway();
    const t = new SipCarrierTransport("sip", gw, "ST_9", "+81312345678");
    await expect(t.dial({ to: "+819000000000", language: "ja", contract: {} as never })).rejects.toThrow("no media");
    expect(gw.dialed).toEqual(["ST_9:+819000000000:+81312345678"]);
  });

  it("doctor reports DNS, gateway and trunk presence", async () => {
    const gw = fakeGateway();
    await gw.ensureTrunk({ address: "sip.example.com", numbers: ["+81312345678"], provider: "sip" });
    const p = createSipProvider({ lookup: async () => "203.0.113.10" });
    const ok = await p.doctor({ config: { address: "sip.example.com", callerId: "+81312345678", trunkId: "ST_1" }, env: {}, gateway: gw }, {});
    expect(ok.ready).toBe(true);
    const bad = await p.doctor({ config: { address: "sip.example.com", callerId: "+81312345678", trunkId: "ST_404" }, env: {}, gateway: gw }, {});
    expect(bad.ready).toBe(false);
    expect(bad.sections[1]?.checks.find((c) => c.label === "Outbound trunk")?.ok).toBe(false);
  });
});

/** A runtime-brain engine that records what it is asked to say. */
function sayingEngine(): VoiceEngine & { said: string[] } {
  const said: string[] = [];
  const queue = new OutputQueue<VoiceOutput>();
  return {
    id: "fake-pipeline", label: "Fake pipeline", speaksItself: false, nativeAudio: MULAW_8K, requires: [], said,
    start: async () => ({
      output: queue,
      input() {},
      async speak(text: string) { said.push(text); return { startMs: 0, endMs: 1, interrupted: false }; },
      interrupt() {},
      async close() { queue.close(); },
      now: () => 0,
    }),
  };
}

function quietMedia(): CarrierMediaSession {
  const events = new OutputQueue<CarrierEvent>();
  return { audio: MULAW_8K, events, send() {}, clear() {}, async hangup() { events.close(); }, now: () => 0 };
}

describe("custom SIP: the notice", () => {
  it("the trunk does not announce the call, so the callee hears the transcript notice exactly once, from the bridge", async () => {
    const gw = fakeGateway();
    gw.dial = async () => quietMedia();
    const p = createSipProvider({ lookup: async () => "203.0.113.10" });
    const carrier = p.transport({ config: { address: "sip.example.com", trunkId: "ST_1", callerId: "+81312345678" }, env: {}, gateway: gw });
    expect(carrier.playsNotice).toBeFalsy();
    const engine = sayingEngine();
    const session = await new PhoneTransport(carrier, engine, { recordDir: "/tmp/rec" }).connect({ phone: "+819000000000" }, { language: "ja", contract: {} as never });
    await session.speak({ text: "もしもし。", language: "ja" });
    await session.speak({ text: "予約をお願いします。", language: "ja" });
    expect(engine.said).toEqual(["この通話は記録されています。もしもし。", "予約をお願いします。"]);
    await session.hangup();

    // Nothing kept (--no-save): nothing announced.
    const silent = sayingEngine();
    const unsaved = await new PhoneTransport(carrier, silent).connect({ phone: "+819000000000" }, { language: "ja", contract: {} as never });
    await unsaved.speak({ text: "もしもし。", language: "ja" });
    expect(silent.said).toEqual(["もしもし。"]);
    await unsaved.hangup();
  });
});
