/**
 * Twilio as an Oathra PhoneProvider: guided provisioning, doctor, pricing,
 * and the Direct (Media Streams) transport.
 */
import { check, definePhoneProvider, referenceRate, reportReady, section, skipped, type DoctorCheck, type DoctorReport, type PhoneProvider, type ProvisionInput, type ProvisionResult, type ProvisionStep, type ProviderContext } from "@oathra/phone";
import { TwilioDirectTransport } from "./transport.js";

const API = "https://api.twilio.com/2010-04-01";
const VOICE_API = "https://voice.twilio.com/v1";
const GEO_CONSOLE = "https://console.twilio.com/us1/develop/voice/settings/geo-permissions";

type Fetch = typeof fetch;

function auth(sid: string, token: string): string {
  return `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`;
}

async function getJson(fetchImpl: Fetch, url: string, sid: string, token: string): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const res = await fetchImpl(url, { headers: { authorization: auth(sid, token) } });
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    /* non-JSON */
  }
  return { ok: res.ok, status: res.status, body };
}

type NumberInfo = { phone_number: string; capabilities?: { voice?: boolean } };

async function listNumbers(fetchImpl: Fetch, sid: string, token: string): Promise<NumberInfo[]> {
  const r = await getJson(fetchImpl, `${API}/Accounts/${sid}/IncomingPhoneNumbers.json?PageSize=50`, sid, token);
  if (!r.ok) throw new Error(`Twilio ${r.status}: ${String(r.body.message ?? "cannot list numbers")}`);
  return (r.body.incoming_phone_numbers as NumberInfo[] | undefined) ?? [];
}

async function japanEnabled(fetchImpl: Fetch, sid: string, token: string): Promise<boolean> {
  const r = await getJson(fetchImpl, `${VOICE_API}/DialingPermissions/Countries/JP`, sid, token);
  return r.ok && r.body.low_risk_numbers_enabled === true;
}

/** Creds from env (set by setup) or from answers (during setup, before .env is written). */
function creds(env: NodeJS.ProcessEnv, answers: Record<string, string> = {}): { sid: string; token: string } {
  const sid = answers.accountSid ?? env.TWILIO_ACCOUNT_SID ?? "";
  const token = answers.authToken ?? env.TWILIO_AUTH_TOKEN ?? "";
  if (!sid || !token) throw new Error("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required");
  return { sid, token };
}

export type TwilioProviderDeps = { fetchImpl?: Fetch };

/** Build the provider; `deps.fetchImpl` is injectable for tests. */
export function createTwilioProvider(deps: TwilioProviderDeps = {}): PhoneProvider {
  const fetchImpl: Fetch = deps.fetchImpl ?? fetch;

  return definePhoneProvider({
    id: "twilio",
    label: "Twilio",
    capabilities: { direct: true, sip: true, outbound: true, inbound: true, sms: true },
    requires: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"],
    questions: [
      { key: "accountSid", label: "Twilio Account SID", envKey: "TWILIO_ACCOUNT_SID", placeholder: "AC…" },
      { key: "authToken", label: "Auth Token", secret: true, envKey: "TWILIO_AUTH_TOKEN" },
      { key: "phoneNumber", label: "Phone number (E.164, leave empty to pick the first voice number)", envKey: "TWILIO_PHONE_NUMBER", optional: true, placeholder: "+1…" },
    ],

    async provision(input: ProvisionInput) {
      const { sid, token } = creds(input.env, input.answers);
      const state: { from?: string; jpEnabled?: boolean } = {};

      const verifyCreds: ProvisionStep = {
        type: "automatic",
        id: "credentials",
        title: "Verify credentials",
        run: async () => {
          const r = await getJson(fetchImpl, `${API}/Accounts/${sid}.json`, sid, token);
          if (!r.ok) return { ok: false, detail: `Twilio ${r.status}: ${String(r.body.message ?? "authentication failed")}` };
          const status = String(r.body.status ?? "unknown");
          if (status !== "active") return { ok: false, detail: `account status is "${status}" (activate or upgrade the account in the Twilio console)` };
          return { ok: true, detail: `account ${String(r.body.friendly_name ?? sid)} · ${String(r.body.type ?? "")}` };
        },
      };

      const findNumber: ProvisionStep = {
        type: "automatic",
        id: "number",
        title: "Find a voice-capable number",
        run: async () => {
          const numbers = await listNumbers(fetchImpl, sid, token);
          const wanted = input.answers.phoneNumber?.trim();
          const pick = wanted ? numbers.find((n) => n.phone_number === wanted) : numbers.find((n) => n.capabilities?.voice);
          if (!pick) {
            return {
              ok: false,
              detail: wanted ? `${wanted} is not on this account` : "no voice-capable number on this account — buy one at https://console.twilio.com/us1/develop/phone-numbers/manage/search",
            };
          }
          if (!pick.capabilities?.voice) return { ok: false, detail: `${pick.phone_number} has no voice capability` };
          state.from = pick.phone_number;
          return { ok: true, detail: pick.phone_number };
        },
      };

      const jpCheck: ProvisionStep = {
        type: "automatic",
        id: "geo-jp",
        title: "Check outbound permission for Japan",
        run: async () => {
          state.jpEnabled = await japanEnabled(fetchImpl, sid, token);
          return state.jpEnabled ? { ok: true, detail: "calls to Japan enabled" } : { ok: false, detail: "calls to Japan are disabled" };
        },
      };

      const jpAction: ProvisionStep = {
        type: "user_action",
        id: "geo-jp-enable",
        title: "Enable calls to Japan",
        reason: "Twilio blocks international destinations until enabled",
        url: GEO_CONSOLE,
        verify: async () => {
          state.jpEnabled = await japanEnabled(fetchImpl, sid, token);
          return state.jpEnabled;
        },
      };

      const mediaStreams: ProvisionStep = {
        type: "automatic",
        id: "media-streams",
        title: "Media Streams",
        run: async () => ({ ok: true, detail: "configured per call via TwiML; a public wss:// URL (ngrok) is needed at call time" }),
      };

      // The geo check decides whether the guided step is needed; expose both so
      // setup can skip the user action when the automatic check already passed.
      const steps: ProvisionStep[] = [verifyCreds, findNumber, jpCheck, jpAction, mediaStreams];

      return {
        steps,
        async finish(): Promise<ProvisionResult> {
          if (!state.from) throw new Error("provisioning did not settle on a phone number");
          return {
            config: { from: state.from, path: "direct" },
            envKeys: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"],
            notes: [
              "Twilio Media Streams need a public wss:// URL reaching this machine; `oathra call` starts ngrok automatically.",
              ...(state.jpEnabled === false ? [`Calls to Japan are still disabled: ${GEO_CONSOLE}`] : []),
            ],
          };
        },
      };
    },

    /**
     * The CLI injects the tunnel URL as `ctx.config.publicWsUrl` (or sets
     * OATHRA_PUBLIC_WS_URL) before calling this; `port` may also be set.
     */
    transport(ctx: ProviderContext) {
      const { sid, token } = creds(ctx.env);
      const from = (ctx.config.from as string | undefined) ?? ctx.env.TWILIO_PHONE_NUMBER;
      if (!from) throw new Error("TWILIO_PHONE_NUMBER is not set (oathra phone add twilio)");
      const publicWsUrl = (ctx.config.publicWsUrl as string | undefined) ?? ctx.env.OATHRA_PUBLIC_WS_URL;
      if (!publicWsUrl) throw new Error("no public wss:// URL for Twilio Media Streams (start a tunnel or set OATHRA_PUBLIC_WS_URL)");
      const port = typeof ctx.config.port === "number" ? ctx.config.port : undefined;
      return new TwilioDirectTransport({ accountSid: sid, authToken: token, from, publicWsUrl, ...(port !== undefined ? { port } : {}), fetchImpl });
    },

    async doctor(ctx: ProviderContext, opts): Promise<DoctorReport> {
      const carrier: DoctorCheck[] = [];
      const network: DoctorReport["latency"] = [];
      let sid = "";
      let token = "";
      try {
        ({ sid, token } = creds(ctx.env));
        carrier.push(check("Twilio credentials present", true));
      } catch (e) {
        carrier.push(check("Twilio credentials present", false, { detail: (e as Error).message, fix: "oathra phone add twilio" }));
      }
      if (sid && token) {
        const t0 = Date.now();
        const acct = await getJson(fetchImpl, `${API}/Accounts/${sid}.json`, sid, token).catch(() => ({ ok: false, status: 0, body: {} as Record<string, unknown> }));
        network.push({ hop: "Oathra → api.twilio.com", ms: Date.now() - t0 });
        if (!acct.ok) carrier.push(check("Twilio authenticated", false, { detail: `HTTP ${acct.status} ${String(acct.body.message ?? "")}`.trim(), fix: "check TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN" }));
        else {
          carrier.push(check("Twilio authenticated", true, { detail: String(acct.body.friendly_name ?? sid) }));
          const status = String(acct.body.status ?? "unknown");
          carrier.push(check("Account active", status === "active", { detail: status, ...(status !== "active" ? { fix: "activate / upgrade the account in the Twilio console" } : {}) }));
          const from = (ctx.config.from as string | undefined) ?? ctx.env.TWILIO_PHONE_NUMBER;
          try {
            const numbers = await listNumbers(fetchImpl, sid, token);
            const mine = from ? numbers.find((n) => n.phone_number === from) : undefined;
            carrier.push(
              from
                ? check(`Caller ID ${from} owned`, Boolean(mine), { ...(mine ? {} : { fix: "set TWILIO_PHONE_NUMBER to a number on this account" }) })
                : check("Caller ID configured", false, { fix: "oathra phone add twilio" }),
            );
            if (mine) carrier.push(check("Voice capability", mine.capabilities?.voice === true));
          } catch (e) {
            carrier.push(check("Numbers readable", false, { detail: (e as Error).message }));
          }
          if (opts.destination?.startsWith("+81")) {
            const jp = await japanEnabled(fetchImpl, sid, token);
            carrier.push(check("Outbound to Japan enabled", jp, { ...(jp ? {} : { fix: `enable Japan at ${GEO_CONSOLE}` }) }));
          }
        }
      }
      const publicWs = (ctx.config.publicWsUrl as string | undefined) ?? ctx.env.OATHRA_PUBLIC_WS_URL;
      const media: DoctorCheck[] = [
        publicWs ? check("Public wss:// URL", true, { detail: publicWs }) : skipped("Public wss:// URL", "started per call (ngrok) or set OATHRA_PUBLIC_WS_URL"),
        skipped("Audio receive / send", "requires a live call — run `oathra phone test`"),
      ];
      const sections = [section("Carrier", carrier), section("Media", media)];
      const rate = opts.destination ? referenceRate("twilio", opts.destination) : undefined;
      return reportReady({ sections, latency: network, ...(rate ? { cost: rate } : {}) });
    },

    pricing(destination: string) {
      return referenceRate("twilio", destination);
    },
  });
}

/** Default provider bound to the global fetch. */
export const twilio: PhoneProvider = createTwilioProvider();
