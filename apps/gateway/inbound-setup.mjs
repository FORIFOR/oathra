// Points the Twilio number at this gateway for incoming calls, or shows what would change.
//   node --env-file=<env> apps/gateway/inbound-setup.mjs            show the current and the intended webhook (no change)
//   node --env-file=<env> apps/gateway/inbound-setup.mjs --apply    set the number's voice webhook to <public url>/hooks/twilio/voice
//   node --env-file=<env> apps/gateway/inbound-setup.mjs --restore <url>   put a previous webhook back
// The public URL of a quick tunnel changes on every restart; run this again after it does.
const env = process.env, sid = env.TWILIO_ACCOUNT_SID, number = env.TWILIO_PHONE_NUMBER, base = (env.OATHRA_PUBLIC_URL ?? "").replace(/\/$/, "");
if (!sid || !env.TWILIO_AUTH_TOKEN || !number) { console.error("BLOCKED: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER are required"); process.exit(2); }
const auth = "Basic " + Buffer.from(`${sid}:${env.TWILIO_AUTH_TOKEN}`).toString("base64"), api = `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers`;
const list = await (await fetch(`${api}.json?PhoneNumber=${encodeURIComponent(number)}`, { headers: { authorization: auth } })).json();
const found = list.incoming_phone_numbers?.[0];
if (!found) { console.error("BLOCKED: this account does not own the configured number"); process.exit(2); }
const restore = process.argv.includes("--restore") ? process.argv[process.argv.indexOf("--restore") + 1] : null;
const target = restore ?? `${base}/hooks/twilio/voice`;
console.log("number ends in:", found.phone_number.slice(-4));
console.log("current voice webhook:", found.voice_url || "(none)", found.voice_method);
console.log("intended voice webhook:", target, "POST");
if (!process.argv.includes("--apply") && !restore) { console.log("no change made; add --apply to set it"); process.exit(0); }
if (!/^https:\/\/[^\s]+$/.test(target) && !restore) { console.error("BLOCKED: OATHRA_PUBLIC_URL must be an https URL"); process.exit(2); }
const r = await fetch(`${api}/${found.sid}.json`, { method: "POST", headers: { authorization: auth, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ VoiceUrl: target, VoiceMethod: restore ? found.voice_method || "POST" : "POST" }) });
const updated = await r.json();
if (!r.ok) { console.error("FAILED:", r.status, updated.message ?? ""); process.exit(1); }
console.log("set:", updated.voice_url, updated.voice_method, "| to undo: --restore", JSON.stringify(found.voice_url || ""));
