import { describe, expect, it } from "vitest";
import { createTwilioProvider } from "./provider.js";

/** Mock Twilio REST: account, numbers, JP geo permission (toggleable). */
function mockTwilio(state: { active?: boolean; jp?: boolean; numbers?: Array<{ phone_number: string; voice: boolean }> }) {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (/\/Accounts\/AC1\.json$/.test(url)) return json({ sid: "AC1", friendly_name: "Test", type: "Full", status: state.active === false ? "suspended" : "active" });
    if (/IncomingPhoneNumbers\.json/.test(url)) return json({ incoming_phone_numbers: (state.numbers ?? [{ phone_number: "+19470000000", voice: true }]).map((n) => ({ phone_number: n.phone_number, capabilities: { voice: n.voice } })) });
    if (/DialingPermissions\/Countries\/JP/.test(url)) return json({ iso_code: "JP", low_risk_numbers_enabled: state.jp !== false });
    return json({ message: "not found" }, 404);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const env = { TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "tok", TWILIO_PHONE_NUMBER: "+19470000000" } as NodeJS.ProcessEnv;

describe("twilio provider — provision", () => {
  it("runs all automatic steps when the account is ready", async () => {
    const { fetchImpl } = mockTwilio({ jp: true });
    const p = createTwilioProvider({ fetchImpl });
    const plan = await p.provision({ answers: { accountSid: "AC1", authToken: "tok" }, env: {} as NodeJS.ProcessEnv });
    const results: Array<{ id: string; ok: boolean }> = [];
    for (const step of plan.steps) {
      if (step.type === "automatic") results.push({ id: step.id, ok: (await step.run()).ok });
      else results.push({ id: step.id, ok: await step.verify() });
    }
    expect(results).toEqual([
      { id: "credentials", ok: true },
      { id: "number", ok: true },
      { id: "geo-jp", ok: true },
      { id: "geo-jp-enable", ok: true },
      { id: "media-streams", ok: true },
    ]);
    const r = await plan.finish();
    expect(r.config).toEqual({ from: "+19470000000", path: "direct" });
    expect(r.envKeys).toContain("TWILIO_PHONE_NUMBER");
  });

  it("surfaces a guided step when Japan is disabled, and verify() flips when the human enables it", async () => {
    const state = { jp: false };
    const { fetchImpl } = mockTwilio(state);
    const p = createTwilioProvider({ fetchImpl });
    const plan = await p.provision({ answers: { accountSid: "AC1", authToken: "tok" }, env: {} as NodeJS.ProcessEnv });
    const geo = plan.steps.find((s) => s.id === "geo-jp");
    expect(geo?.type === "automatic" && (await geo.run()).ok).toBe(false);
    const action = plan.steps.find((s) => s.id === "geo-jp-enable");
    expect(action?.type).toBe("user_action");
    if (action?.type !== "user_action") throw new Error("expected user_action");
    expect(action.url).toContain("geo-permissions");
    expect(await action.verify()).toBe(false);
    state.jp = true;
    expect(await action.verify()).toBe(true);
  });

  it("fails credentials when the account is not active", async () => {
    const { fetchImpl } = mockTwilio({ active: false });
    const p = createTwilioProvider({ fetchImpl });
    const plan = await p.provision({ answers: { accountSid: "AC1", authToken: "tok" }, env: {} as NodeJS.ProcessEnv });
    const step = plan.steps[0]!;
    const r = step.type === "automatic" ? await step.run() : { ok: false };
    expect(r.ok).toBe(false);
  });

  it("respects an explicit phone number and rejects unknown ones", async () => {
    const { fetchImpl } = mockTwilio({ numbers: [{ phone_number: "+19470000000", voice: true }, { phone_number: "+19471111111", voice: true }] });
    const p = createTwilioProvider({ fetchImpl });
    const ok = await p.provision({ answers: { accountSid: "AC1", authToken: "tok", phoneNumber: "+19471111111" }, env: {} as NodeJS.ProcessEnv });
    for (const s of ok.steps) if (s.type === "automatic" && s.id === "number") expect((await s.run()).ok).toBe(true);
    const bad = await p.provision({ answers: { accountSid: "AC1", authToken: "tok", phoneNumber: "+15550000000" }, env: {} as NodeJS.ProcessEnv });
    for (const s of bad.steps) if (s.type === "automatic" && s.id === "number") expect((await s.run()).ok).toBe(false);
  });
});

describe("twilio provider — doctor, pricing, transport", () => {
  it("reports carrier checks, latency and cost for a Japanese mobile", async () => {
    const { fetchImpl } = mockTwilio({ jp: true });
    const p = createTwilioProvider({ fetchImpl });
    const report = await p.doctor({ config: { from: "+19470000000" }, env }, { destination: "+819012345678" });
    const carrier = report.sections.find((s) => s.name === "Carrier")!;
    expect(carrier.checks.every((c) => c.ok)).toBe(true);
    expect(carrier.checks.map((c) => c.label)).toContain("Outbound to Japan enabled");
    expect(report.latency[0]?.hop).toContain("api.twilio.com");
    expect(report.cost?.ratePerMin).toBe(0.185);
    expect(report.ready).toBe(true);
  });

  it("marks the caller ID missing when the number is not on the account", async () => {
    const { fetchImpl } = mockTwilio({});
    const p = createTwilioProvider({ fetchImpl });
    const report = await p.doctor({ config: { from: "+15550000000" }, env }, {});
    const c = report.sections[0]!.checks.find((x) => x.label.startsWith("Caller ID"))!;
    expect(c.ok).toBe(false);
    expect(report.ready).toBe(false);
  });

  it("builds the direct transport from config + env and requires a public URL", () => {
    const p = createTwilioProvider({ fetchImpl: mockTwilio({}).fetchImpl });
    expect(() => p.transport({ config: { from: "+19470000000" }, env })).toThrow(/public wss/);
    const t = p.transport({ config: { from: "+19470000000", publicWsUrl: "wss://x.ngrok.app", port: 4300 }, env });
    expect(t.providerId).toBe("twilio");
    expect(t.path).toBe("direct");
    expect(t.describe()).toContain("wss://x.ngrok.app");
    expect(p.pricing?.("+819012345678")?.ratePerMin).toBe(0.185);
    expect(p.pricing?.("+8131234567")?.ratePerMin).toBe(0.052);
  });
});
