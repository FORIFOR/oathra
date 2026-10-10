// Finds and buys a Twilio number for an agent, already pointed at this gateway for calls and SMS.
//   node --env-file=<env> apps/gateway/number-setup.mjs [--country JP] [--type local|mobile|toll-free] [--contains 50]
//        lists numbers that can be bought (no change, no charge)
//   node --env-file=<env> apps/gateway/number-setup.mjs --buy +815012345678 [--bundle BU...] [--address AD...] --yes
//        buys that number (monthly charge on the Twilio account) and sets its voice and SMS webhooks
// Japanese and many other numbers need an approved regulatory bundle (--bundle) and address (--address) on the Twilio account.
// To use the new number, set TWILIO_PHONE_NUMBER (calls, SMS) and OATHRA_MESSAGING_CHANNEL_ENABLED=true, then restart.
import { pathToFileURL } from "node:url";

const TYPES = { local: "Local", mobile: "Mobile", "toll-free": "TollFree" };
const arg = (argv, name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };

export async function numberSetup(argv, env, fetchImpl = fetch, log = console.log) {
  const sid = env.TWILIO_ACCOUNT_SID, base = (env.OATHRA_PUBLIC_URL ?? "").replace(/\/$/, "");
  if (!sid || !env.TWILIO_AUTH_TOKEN) return { code: 2, error: "BLOCKED: TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required" };
  const auth = "Basic " + Buffer.from(`${sid}:${env.TWILIO_AUTH_TOKEN}`).toString("base64"), api = `https://api.twilio.com/2010-04-01/Accounts/${sid}`;
  const buy = arg(argv, "--buy");
  if (!buy) {
    const country = (arg(argv, "--country") ?? "JP").toUpperCase(), type = TYPES[arg(argv, "--type") ?? "local"];
    if (!/^[A-Z]{2}$/.test(country) || !type) return { code: 2, error: "BLOCKED: --country is a two-letter code and --type is local, mobile or toll-free" };
    const query = new URLSearchParams({ VoiceEnabled: "true", PageSize: "20" });
    if (arg(argv, "--contains")) query.set("Contains", arg(argv, "--contains"));
    if (argv.includes("--sms")) query.set("SmsEnabled", "true");
    const r = await fetchImpl(`${api}/AvailablePhoneNumbers/${country}/${type}.json?${query}`, { headers: { authorization: auth } });
    const data = await r.json();
    if (!r.ok) return { code: 1, error: `FAILED: ${r.status} ${data.message ?? ""}` };
    const numbers = (data.available_phone_numbers ?? []).map(n => ({ number: n.phone_number, locality: n.locality || n.region || "", sms: !!n.capabilities?.SMS, voice: !!n.capabilities?.voice, address: n.address_requirements }));
    for (const n of numbers) log(`${n.number}  voice:${n.voice ? "yes" : "no"} sms:${n.sms ? "yes" : "no"}  address:${n.address}  ${n.locality}`);
    log(numbers.length ? "no change made; buy one with --buy <number> --yes" : "no numbers found; try another --type or --contains");
    return { code: 0, numbers };
  }
  if (!/^\+[1-9]\d{7,14}$/.test(buy)) return { code: 2, error: "BLOCKED: --buy takes an E.164 number such as +815012345678" };
  if (!/^https:\/\/[^\s/]+$/.test(base)) return { code: 2, error: "BLOCKED: OATHRA_PUBLIC_URL must be an https origin so the number can reach this gateway" };
  if (!argv.includes("--yes")) return { code: 2, error: "BLOCKED: buying a number adds a monthly charge to the Twilio account; add --yes to confirm" };
  const body = new URLSearchParams({ PhoneNumber: buy, VoiceUrl: `${base}/hooks/twilio/voice`, VoiceMethod: "POST", SmsUrl: `${base}/hooks/channels/twilio-messaging`, SmsMethod: "POST" });
  for (const [flag, field, pattern] of [["--bundle", "BundleSid", /^BU[0-9a-f]{32}$/], ["--address", "AddressSid", /^AD[0-9a-f]{32}$/]]) {
    const value = arg(argv, flag);
    if (value === undefined) continue;
    if (!pattern.test(value)) return { code: 2, error: `BLOCKED: ${flag} is not a Twilio ${field}` };
    body.set(field, value);
  }
  const r = await fetchImpl(`${api}/IncomingPhoneNumbers.json`, { method: "POST", headers: { authorization: auth, "content-type": "application/x-www-form-urlencoded" }, body });
  const bought = await r.json();
  if (!r.ok) return { code: 1, error: `FAILED: ${r.status} ${bought.message ?? ""}` };
  log("bought:", bought.phone_number, "| voice:", bought.voice_url, "| sms:", bought.sms_url);
  log(`next: set TWILIO_PHONE_NUMBER=${bought.phone_number} and OATHRA_MESSAGING_CHANNEL_ENABLED=true, then restart the gateway`);
  return { code: 0, bought: { sid: bought.sid, number: bought.phone_number } };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const result = await numberSetup(process.argv.slice(2), process.env);
  if (result.error) console.error(result.error);
  process.exit(result.code);
}
