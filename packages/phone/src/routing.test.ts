import { describe, expect, it } from "vitest";
import { PhoneConfigSchema } from "./config.js";
import { classifyDestination, referenceRate } from "./pricing.js";
import { PhoneRegistry, PhoneRouter } from "./registry.js";
import type { CarrierTransport, PhoneProvider } from "./types.js";

const provider = (id: string, requires: string[], opts: { throws?: boolean } = {}): PhoneProvider =>
  ({
    id,
    label: id,
    capabilities: { sip: true, outbound: true, inbound: false },
    requires,
    questions: [],
    transport: () => {
      if (opts.throws) throw new Error("gateway missing");
      return { providerId: id, path: "direct", describe: () => id, dial: async () => Promise.reject(new Error("not dialled in tests")) } satisfies CarrierTransport;
    },
    pricing: (destination: string) => referenceRate(id, destination),
  }) as unknown as PhoneProvider;

const config = (providers: string[], order: string[] = []) =>
  PhoneConfigSchema.parse({ providers: Object.fromEntries(providers.map((p) => [p, {}])), routing: { providers: order } });

describe("PhoneRouter", () => {
  const registry = new PhoneRegistry().addProvider(provider("twilio", ["TWILIO_AUTH_TOKEN"])).addProvider(provider("plivo", ["PLIVO_AUTH_TOKEN"]));
  const env = { TWILIO_AUTH_TOKEN: "x", PLIVO_AUTH_TOKEN: "y" };

  it("follows the configured order and falls back to config order when none is set", () => {
    expect(new PhoneRouter(registry, config(["twilio", "plivo"], ["plivo", "twilio"]), env).candidates().map((r) => r.provider.id)).toEqual(["plivo", "twilio"]);
    expect(new PhoneRouter(registry, config(["twilio", "plivo"]), env).candidates().map((r) => r.provider.id)).toEqual(["twilio", "plivo"]);
  });

  it("skips providers that are unconfigured, missing credentials, or unusable here", () => {
    expect(new PhoneRouter(registry, config(["twilio", "plivo"]), { TWILIO_AUTH_TOKEN: "x" }).candidates().map((r) => r.provider.id)).toEqual(["twilio"]);
    expect(new PhoneRouter(registry, config(["plivo"], ["twilio", "plivo"]), env).candidates().map((r) => r.provider.id)).toEqual(["plivo"]);

    const broken = new PhoneRegistry().addProvider(provider("sip", [], { throws: true })).addProvider(provider("twilio", []));
    expect(new PhoneRouter(broken, config(["sip", "twilio"]), {}).candidates().map((r) => r.provider.id)).toEqual(["twilio"]);
  });

  it("moves the preferred provider first, keeps the rest as fallback, and attaches list prices", () => {
    const routes = new PhoneRouter(registry, config(["twilio", "plivo"]), env).resolve({ destination: "+819012345678", prefer: "plivo" });
    expect(routes.map((r) => r.provider.id)).toEqual(["plivo", "twilio"]);
    expect(routes[0]!.rate).toMatchObject({ provider: "plivo", ratePerMin: 0.1398, currency: "USD" });
  });

  it("fails loudly when the preferred provider is not available", () => {
    const router = new PhoneRouter(registry, config(["twilio"]), env);
    expect(() => router.resolve({ destination: "+819012345678", prefer: "plivo" })).toThrow(/oathra phone add plivo/);
  });
});

describe("pricing", () => {
  it("classifies Japanese mobile and landline numbers", () => {
    expect(classifyDestination("+819012345678")).toEqual({ country: "JP", kind: "mobile" });
    expect(classifyDestination("+81312345678")).toEqual({ country: "JP", kind: "landline" });
    expect(classifyDestination("+14155550100")).toEqual({ country: "US", kind: "unknown" });
  });

  it("returns a list price only where one is published", () => {
    expect(referenceRate("twilio", "+819012345678")?.ratePerMin).toBe(0.185);
    expect(referenceRate("twilio", "+81312345678")?.ratePerMin).toBe(0.052);
    expect(referenceRate("twilio", "+4915112345678")).toBeUndefined();
    expect(referenceRate("unknown-carrier", "+819012345678")).toBeUndefined();
  });
});
