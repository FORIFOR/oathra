# Beginner setup

Oathra is easiest to try in two stages: verify the evidence rules without an API key, then add a voice engine and a phone carrier only when you need a real call. This guide keeps the stages separate so a missing carrier credential cannot hide a problem in the evidence checker.

## 1. Verify the behavior without an API key

The browser [evidence lab](https://forifor.github.io/oathra/en/check.html) needs no install, account or API key. Text entered there is processed in the browser and no phone call is placed.

For the local simulator, use Node.js 22 or newer:

```bash
node --version  # v22 or newer
pnpm --version  # 10.12.2 or newer
```

If `pnpm` is not installed, install it once with npm:

```bash
npm install --global pnpm@10.12.2
```

If you do not want to clone the repository, skip this section and use the GitHub Release `npx` command below.

```bash
git clone https://github.com/FORIFOR/oathra.git
cd oathra
pnpm install
pnpm build
pnpm oathra demo
```

`demo`, `play` and `eval` use the built-in simulator and run without provider credentials.

## 2. Choose credentials for a real phone

The shortest real-call path is **Twilio + GPT-Live**. Twilio connects directly to Oathra. Plivo and Custom SIP use a LiveKit SIP gateway as well.

| Purpose | Environment variables | Where to get them |
| --- | --- | --- |
| GPT-Live / OpenAI Realtime | `OPENAI_API_KEY` | [OpenAI API keys](https://platform.openai.com/api-keys) |
| Pipeline speech recognition | `DEEPGRAM_API_KEY` | [Deepgram Console](https://console.deepgram.com/) |
| Twilio calling | `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | [Twilio Console](https://console.twilio.com/) |
| Twilio caller ID | `TWILIO_PHONE_NUMBER` | [Twilio phone numbers](https://console.twilio.com/us1/develop/phone-numbers/manage/search) |
| Plivo calling | `PLIVO_AUTH_ID` / `PLIVO_AUTH_TOKEN` | [Plivo Console](https://console.plivo.com/) |
| Plivo / Custom SIP gateway | `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | [LiveKit Cloud](https://cloud.livekit.io/) |

Keep keys in the project `.env`, never in the repository:

```bash
cp .env.example .env
```

The setup wizard can create or update this file for you. Existing shell variables take precedence over `.env`.

## 3. Run the guided setup

From a clone:

```bash
pnpm oathra setup phone
```

For the public release package, use the v0.1.4 GitHub asset explicitly:

```bash
npx --yes --package=https://github.com/FORIFOR/oathra/releases/download/v0.1.4/oathra-0.1.4.tgz oathra setup phone
```

The wizard:

1. asks which voice engine you want and prints the matching credential URL;
2. saves entered values to `.env` and masks secrets in a terminal;
3. asks for the carrier credentials, reusing values already in `.env`;
4. opens a linked carrier-console step for caller-ID verification, number purchase or geo permissions and checks until it is complete;
5. offers a local test before any paid PSTN call.

Plivo and Custom SIP also prompt for the three LiveKit values before the carrier questions. Secrets are never written to `.oathra/phone.yaml`.

## 4. Test in stages before calling a phone

Run diagnosis and the free telephony stages first:

```bash
pnpm oathra doctor
pnpm oathra phone list
pnpm oathra phone doctor --to +819012345678
pnpm oathra phone test --level local
pnpm oathra phone test --level gateway
```

`local` uses synthesized audio and no carrier charge, but it does use the selected model API (and Deepgram for the Pipeline engine). `gateway` is available when the configured LiveKit gateway supports loopback. Only the final PSTN stage places a paid call:

```bash
pnpm oathra phone test --level pstn --to +819012345678
pnpm oathra call --to +819012345678 --scenario restaurant-reservation
```

Carrier, voice-model and speech-recognition charges are separate. Confirm test-number ownership and the destination country permissions first.

## 5. Fix the common setup errors

- `OPENAI_API_KEY is not set`: rerun `oathra setup phone` or add the key to `.env`.
- `SIP providers need a SIP gateway`: check `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`.
- No Twilio number found: buy a voice-capable number and set `TWILIO_PHONE_NUMBER` in E.164 form, such as `+81...`.
- A red item in `phone doctor`: follow its printed `fix` command or console URL, then run the doctor again.
- Changes to `.env` are not visible: start a new shell and rerun the command. Existing shell variables win over `.env` values.

When reporting a problem, include the command, the red check and the provider name. Do not paste secret values or call transcripts.

## What is and is not verified

Twilio direct calling and the GPT-Live engine have been exercised in development calls. Plivo and Custom SIP are implemented through LiveKit but their PSTN path is not yet verified. The evidence checker validates transcript claims; it does not inspect a carrier's reservation ledger. See the [readiness gates](READINESS.md) before using the project for a production workflow.
