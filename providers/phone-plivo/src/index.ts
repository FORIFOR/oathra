/**
 * @oathra/phone-plivo — Plivo as a carrier through the SIP gateway.
 *
 * Provisioning (automated where Plivo's API allows it):
 *   1. verify credentials            GET  /v1/Account/{authId}/
 *   2. find a voice caller ID        GET  /v1/Account/{authId}/Number/
 *      (user_action if the account owns none)
 *   3. Zentrunk credential + trunk   POST /v1/Account/{authId}/Zentrunk/Credential/
 *                                    POST /v1/Account/{authId}/Zentrunk/Trunk/
 *                                    GET  /v1/Account/{authId}/Zentrunk/Trunk/{trunkId}/  → trunk_domain
 *   4. register the trunk with the gateway (LiveKit outbound trunk, transport tcp)
 *
 * Field names follow LiveKit's Plivo guide (credential_uuid, trunk_id,
 * trunk_domain, secure). UNVERIFIED against a live Plivo account in this build:
 * the exact success codes of the Zentrunk endpoints and whether `secure: true`
 * requires TLS (5061) on the gateway side.
 */
import { randomBytes } from "node:crypto";
import {
  check,
  definePhoneProvider,
  referenceRate,
  reportReady,
  section,
  skipped,
  type CarrierTransport,
  type DoctorCheck,
  type PhoneProvider,
  type ProviderContext,
  type ProvisionInput,
  type ProvisionResult,
  type ProvisionStep,
} from "@oathra/phone";
import { requireGateway, SipCarrierTransport } from "@oathra/phone-sip";

export type PlivoConfig = { callerId?: string; trunkId?: string; plivoTrunkId?: string; trunkDomain?: string; gateway?: string };

export type PlivoDeps = { fetchImpl?: typeof fetch; baseUrl?: string; random?: () => string };

type Json = Record<string, unknown>;

function basic(authId: string, token: string): string {
  return `Basic ${Buffer.from(`${authId}:${token}`).toString("base64")}`;
}

export function normalizeE164(n: string): string {
  const d = n.replace(/[^\d+]/g, "");
  return d.startsWith("+") ? d : `+${d}`;
}

function randomAlnum(n: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = randomBytes(n);
  let s = "";
  for (let i = 0; i < n; i++) s += chars[bytes[i]! % chars.length];
  return s;
}

export function createPlivoProvider(deps: PlivoDeps = {}): PhoneProvider {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const base = deps.baseUrl ?? "https://api.plivo.com/v1/Account";
  const random = deps.random ?? (() => randomAlnum(12));

  const api = async (authId: string, token: string, path: string, init: { method?: string; body?: Json } = {}): Promise<{ status: number; json: Json }> => {
    const res = await fetchImpl(`${base}/${authId}/${path}`, {
      method: init.method ?? "GET",
      headers: { authorization: basic(authId, token), "content-type": "application/json", accept: "application/json" },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(15000),
    });
    let json: Json = {};
    try {
      json = (await res.json()) as Json;
    } catch {
      /* non-JSON */
    }
    return { status: res.status, json };
  };

  const listVoiceNumbers = async (authId: string, token: string): Promise<string[]> => {
    const r = await api(authId, token, "Number/?limit=20");
    if (r.status !== 200) throw new Error(`Plivo numbers: HTTP ${r.status} ${String(r.json.error ?? "")}`);
    const objects = (r.json.objects as Json[] | undefined) ?? [];
    return objects.filter((o) => o.voice_enabled !== false).map((o) => normalizeE164(String(o.number)));
  };

  return definePhoneProvider({
    id: "plivo",
    label: "Plivo",
    capabilities: { sip: true, outbound: true, inbound: true },
    requires: ["PLIVO_AUTH_ID", "PLIVO_AUTH_TOKEN"],
    questions: [
      { key: "authId", label: "Plivo Auth ID", envKey: "PLIVO_AUTH_ID", placeholder: "MA••••••••" },
      { key: "authToken", label: "Plivo Auth Token", secret: true, envKey: "PLIVO_AUTH_TOKEN" },
      { key: "callerId", label: "Caller ID (a Plivo number you own, E.164)", envKey: "PLIVO_CALLER_ID", optional: true },
    ],

    async provision(input: ProvisionInput) {
      const authId = input.answers.authId ?? input.env.PLIVO_AUTH_ID ?? "";
      const token = input.answers.authToken ?? input.env.PLIVO_AUTH_TOKEN ?? "";
      let callerId = input.answers.callerId ? normalizeE164(input.answers.callerId) : "";
      let plivoTrunkId = "";
      let trunkDomain = "";
      let gatewayTrunkId = "";
      const username = `oathra${random().slice(0, 8)}`;
      const password = `${random().slice(0, 12)}!`;

      const steps: ProvisionStep[] = [
        {
          type: "automatic",
          id: "auth",
          title: "Verify credentials",
          run: async () => {
            if (!authId || !token) return { ok: false, detail: "PLIVO_AUTH_ID / PLIVO_AUTH_TOKEN missing" };
            const r = await api(authId, token, "");
            return r.status === 200 ? { ok: true, detail: String(r.json.name ?? authId) } : { ok: false, detail: `HTTP ${r.status} ${String(r.json.error ?? "")}` };
          },
        },
        {
          type: "automatic",
          id: "caller-id",
          title: "Find caller ID",
          run: async () => {
            const numbers = await listVoiceNumbers(authId, token);
            if (callerId && numbers.includes(callerId)) return { ok: true, detail: callerId };
            if (callerId && !numbers.includes(callerId)) return { ok: false, detail: `${callerId} is not a voice number on this account` };
            if (numbers[0]) {
              callerId = numbers[0];
              return { ok: true, detail: `${callerId}${numbers.length > 1 ? ` (+${numbers.length - 1} more; pass --caller-id to choose)` : ""}` };
            }
            return { ok: false, detail: "no voice-enabled number on the account" };
          },
        },
        {
          type: "user_action",
          id: "buy-number",
          title: "Buy or verify a caller ID",
          reason: "Plivo requires a number you own (or a verified caller ID) to place outbound calls.",
          url: "https://console.plivo.com/phone-numbers/",
          verify: async () => {
            const numbers = await listVoiceNumbers(authId, token).catch((): string[] => []);
            if (!numbers[0]) return false;
            if (!callerId) callerId = numbers[0];
            return numbers.includes(callerId);
          },
        },
        {
          type: "automatic",
          id: "zentrunk",
          title: "Create outbound SIP trunk (Zentrunk)",
          run: async () => {
            const cred = await api(authId, token, "Zentrunk/Credential/", { method: "POST", body: { name: "Oathra outbound credential", username, password } });
            if (cred.status >= 300 || !cred.json.credential_uuid) return { ok: false, detail: `credential: HTTP ${cred.status} ${String(cred.json.error ?? JSON.stringify(cred.json)).slice(0, 120)}` };
            const trunk = await api(authId, token, "Zentrunk/Trunk/", { method: "POST", body: { name: "oathra", trunk_direction: "outbound", credential_uuid: cred.json.credential_uuid, secure: true } });
            if (trunk.status >= 300 || !trunk.json.trunk_id) return { ok: false, detail: `trunk: HTTP ${trunk.status} ${String(trunk.json.error ?? JSON.stringify(trunk.json)).slice(0, 120)}` };
            plivoTrunkId = String(trunk.json.trunk_id);
            const info = await api(authId, token, `Zentrunk/Trunk/${plivoTrunkId}/`);
            trunkDomain = String(info.json.trunk_domain ?? `${plivoTrunkId}.zt.plivo.com`);
            return { ok: true, detail: trunkDomain };
          },
        },
        {
          type: "automatic",
          id: "gateway",
          title: "Register trunk with the SIP gateway",
          run: async () => {
            const gw = requireGateway(input);
            const r = await gw.ensureTrunk({ address: trunkDomain, transport: "tcp", username, password, numbers: callerId ? [callerId] : [], provider: "plivo" });
            gatewayTrunkId = r.trunkId;
            return { ok: true, detail: `${r.created ? "created" : "reused"} ${r.trunkId} on ${gw.label}` };
          },
        },
      ];

      return {
        steps,
        finish: async (): Promise<ProvisionResult> => ({
          config: { callerId, trunkId: gatewayTrunkId, plivoTrunkId, trunkDomain, gateway: input.gateway?.id ?? "livekit" },
          envKeys: ["PLIVO_AUTH_ID", "PLIVO_AUTH_TOKEN"],
          notes: ["Plivo outbound calls to Japan mobiles are billed at Plivo's published rate (~$0.14/min); check your account for the exact rate."],
        }),
      };
    },

    transport(ctx: ProviderContext): CarrierTransport {
      const cfg = ctx.config as PlivoConfig;
      if (!cfg.trunkId) throw new Error("Plivo is not provisioned (oathra phone add plivo)");
      return new SipCarrierTransport("plivo", requireGateway(ctx), cfg.trunkId, cfg.callerId);
    },

    async doctor(ctx: ProviderContext, opts) {
      const cfg = ctx.config as PlivoConfig;
      const authId = ctx.env.PLIVO_AUTH_ID ?? "";
      const token = ctx.env.PLIVO_AUTH_TOKEN ?? "";
      const carrier: DoctorCheck[] = [];
      if (!authId || !token) carrier.push(check("Plivo authenticated", false, { fix: "Set PLIVO_AUTH_ID and PLIVO_AUTH_TOKEN in .env" }));
      else {
        try {
          const r = await api(authId, token, "");
          carrier.push(check("Plivo authenticated", r.status === 200, { detail: r.status === 200 ? String(r.json.name ?? authId) : `HTTP ${r.status}` }));
          if (r.status === 200) {
            const numbers = await listVoiceNumbers(authId, token).catch((): string[] => []);
            const ok = Boolean(cfg.callerId && numbers.includes(cfg.callerId));
            carrier.push(check("Caller ID owned", ok, { detail: cfg.callerId ?? "missing", ...(ok ? {} : { fix: "oathra phone add plivo" }) }));
          }
        } catch (e) {
          carrier.push(check("Plivo authenticated", false, { detail: (e as Error).message }));
        }
      }
      const gatewayChecks = ctx.gateway ? await ctx.gateway.check() : [check("SIP gateway", false, { fix: "Set LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET" })];
      if (ctx.gateway && cfg.trunkId) {
        const trunks = await ctx.gateway.listTrunks().catch(() => []);
        gatewayChecks.push(check("Outbound trunk", trunks.some((t) => t.trunkId === cfg.trunkId), { detail: `${cfg.trunkId} → ${cfg.trunkDomain ?? "?"}`, fix: "oathra phone add plivo" }));
      } else gatewayChecks.push(check("Outbound trunk", false, { fix: "oathra phone add plivo" }));
      const rate = opts.destination ? referenceRate("plivo", opts.destination) : undefined;
      return reportReady({
        sections: [section("Carrier", carrier), section("SIP Gateway", gatewayChecks), section("Media", [skipped("Audio send / receive", "run `oathra phone test` for a live check")])],
        latency: [],
        ...(rate ? { cost: rate } : {}),
      });
    },

    pricing(destination: string) {
      return referenceRate("plivo", destination);
    },
  });
}

export const plivo: PhoneProvider = createPlivoProvider();
export default plivo;
