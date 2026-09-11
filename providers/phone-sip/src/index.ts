/**
 * @oathra/phone-sip — Custom SIP provider plus the generic SipCarrierTransport
 * every SIP-based provider (Plivo, Telnyx, …) reuses: the carrier only has to
 * describe its trunk; a SipGateway (LiveKit by default) carries the media.
 */
import { promises as dns } from "node:dns";
import { connect as tlsConnect } from "node:tls";
import {
  check,
  definePhoneProvider,
  reportReady,
  section,
  skipped,
  type CarrierMediaSession,
  type CarrierTransport,
  type DialOptions,
  type DoctorCheck,
  type PhoneProvider,
  type ProviderContext,
  type ProvisionInput,
  type ProvisionResult,
  type ProvisionStep,
  type SipGateway,
} from "@oathra/phone";

/** Any SIP trunk registered with a gateway, dialled through that gateway. */
export class SipCarrierTransport implements CarrierTransport {
  readonly path = "sip" as const;

  constructor(
    readonly providerId: string,
    private readonly gateway: SipGateway,
    private readonly trunkId: string,
    private readonly callerId?: string,
  ) {}

  dial(opts: DialOptions): Promise<CarrierMediaSession> {
    return this.gateway.dial(this.trunkId, { ...opts, ...(opts.callerId ? {} : this.callerId ? { callerId: this.callerId } : {}) });
  }

  describe(): string {
    return `${this.providerId} → ${this.gateway.label} (trunk ${this.trunkId})`;
  }
}

export type SipConfig = { address: string; transport?: "udp" | "tcp" | "tls"; username?: string; callerId?: string; trunkId?: string; gateway?: string };

export function requireGateway(ctx: { gateway?: SipGateway }): SipGateway {
  if (!ctx.gateway) throw new Error("A SIP gateway is required (LiveKit by default). Set LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET.");
  return ctx.gateway;
}

export function parseSipAddress(address: string): { host: string; port: number } {
  const m = /^(?:sips?:)?([A-Za-z0-9.-]+)(?::(\d+))?$/i.exec(address.trim());
  if (!m) throw new Error(`invalid SIP address "${address}" (expected host[:port])`);
  return { host: m[1]!, port: m[2] ? Number(m[2]) : 5060 };
}

export type SipProviderDeps = {
  lookup?: (host: string) => Promise<string>;
  tlsProbe?: (host: string, port: number) => Promise<number>;
};

async function defaultLookup(host: string): Promise<string> {
  const r = await dns.lookup(host);
  return r.address;
}

function defaultTlsProbe(host: string, port: number): Promise<number> {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    const sock = tlsConnect({ host, port, servername: host, timeout: 5000 }, () => {
      const ms = Date.now() - t0;
      sock.end();
      res(ms);
    });
    sock.on("error", rej);
    sock.on("timeout", () => {
      sock.destroy();
      rej(new Error("timeout"));
    });
  });
}

export function createSipProvider(deps: SipProviderDeps = {}): PhoneProvider {
  const lookup = deps.lookup ?? defaultLookup;
  const tlsProbe = deps.tlsProbe ?? defaultTlsProbe;

  return definePhoneProvider({
    id: "sip",
    label: "Custom SIP",
    capabilities: { sip: true, outbound: true, inbound: false },
    requires: [],
    questions: [
      { key: "address", label: "SIP endpoint (host[:port])", placeholder: "sip.example.com" },
      { key: "transport", label: "Transport (udp / tcp / tls)", placeholder: "udp", optional: true },
      { key: "username", label: "Username", optional: true },
      { key: "password", label: "Password", secret: true, envKey: "SIP_PASSWORD", optional: true },
      { key: "callerId", label: "Caller ID (E.164)", placeholder: "+81..." },
    ],

    async provision(input: ProvisionInput) {
      const a = input.answers;
      const { host } = parseSipAddress(a.address ?? "");
      const transport = (a.transport as SipConfig["transport"]) || "udp";
      let trunkId = "";
      const steps: ProvisionStep[] = [
        {
          type: "automatic",
          id: "dns",
          title: "Resolve SIP host",
          run: async () => {
            const ip = await lookup(host);
            return { ok: true, detail: `${host} → ${ip}` };
          },
        },
        {
          type: "automatic",
          id: "trunk",
          title: "Register trunk with the SIP gateway",
          run: async () => {
            const gw = requireGateway(input);
            const password = a.password ?? input.env.SIP_PASSWORD;
            const r = await gw.ensureTrunk({
              address: a.address!,
              transport,
              ...(a.username ? { username: a.username } : {}),
              ...(password ? { password } : {}),
              numbers: a.callerId ? [a.callerId] : [],
              provider: "sip",
            });
            trunkId = r.trunkId;
            return { ok: true, detail: `${r.created ? "created" : "reused"} ${r.trunkId} on ${gw.label}` };
          },
        },
      ];
      return {
        steps,
        finish: async (): Promise<ProvisionResult> => ({
          config: { address: a.address, transport, ...(a.username ? { username: a.username } : {}), callerId: a.callerId, trunkId, gateway: input.gateway?.id ?? "livekit" },
          envKeys: a.password ? ["SIP_PASSWORD"] : [],
        }),
      };
    },

    transport(ctx: ProviderContext): CarrierTransport {
      const cfg = ctx.config as SipConfig;
      if (!cfg.trunkId) throw new Error("Custom SIP is not provisioned (oathra phone add sip)");
      return new SipCarrierTransport("sip", requireGateway(ctx), cfg.trunkId, cfg.callerId);
    },

    async doctor(ctx: ProviderContext) {
      const cfg = ctx.config as SipConfig;
      const carrier: DoctorCheck[] = [];
      let host = "";
      let port = 5060;
      try {
        ({ host, port } = parseSipAddress(cfg.address ?? ""));
        const ip = await lookup(host);
        carrier.push(check("DNS", true, { detail: `${host} → ${ip}` }));
      } catch (e) {
        carrier.push(check("DNS", false, { detail: (e as Error).message, fix: "Check the SIP endpoint hostname" }));
      }
      if (cfg.transport === "tls" && host) {
        try {
          const ms = await tlsProbe(host, port === 5060 ? 5061 : port);
          carrier.push(check("TLS connection", true, { detail: `${ms} ms` }));
        } catch (e) {
          carrier.push(check("TLS connection", false, { detail: (e as Error).message }));
        }
      } else carrier.push(skipped("TLS connection", "transport is not tls"));
      carrier.push(check("Caller ID", Boolean(cfg.callerId), { detail: cfg.callerId ?? "missing", fix: "oathra phone add sip" }));
      const gatewayChecks = ctx.gateway ? await ctx.gateway.check() : [check("SIP gateway", false, { fix: "Set LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET" })];
      if (cfg.trunkId && ctx.gateway) {
        const trunks = await ctx.gateway.listTrunks().catch(() => []);
        const found = trunks.some((t) => t.trunkId === cfg.trunkId);
        gatewayChecks.push(check("Outbound trunk", found, { detail: cfg.trunkId, fix: "oathra phone add sip (re-provision)" }));
      } else gatewayChecks.push(check("Outbound trunk", false, { fix: "oathra phone add sip" }));
      return reportReady({
        sections: [section("Carrier", carrier), section("SIP Gateway", gatewayChecks), section("Media", [skipped("Audio send / receive", "run `oathra phone test` for a live check")])],
        latency: [],
      });
    },
  });
}

export const sip: PhoneProvider = createSipProvider();
export default sip;
