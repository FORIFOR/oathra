<p align="center">
  <strong style="font-size:1.6em">Oathra</strong><br/>
  Give AI agents a phone — and proof of what happened.
</p>

<p align="center">
  <a href="https://github.com/FORIFOR/oathra/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/FORIFOR/oathra/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/FORIFOR/oathra/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/FORIFOR/oathra?display_name=tag&sort=semver"></a>
  <a href="LICENSE"><img alt="Apache-2.0 license" src="https://img.shields.io/badge/license-Apache--2.0-blue.svg"></a>
</p>

Run **v0.1.16** with the latest fixes (Node.js 22+, no API key):

```bash
npx --yes --package=https://github.com/FORIFOR/oathra/releases/download/v0.1.16/oathra-0.1.16.tgz oathra demo
```

Distributed through [GitHub Releases](https://github.com/FORIFOR/oathra/releases/tag/v0.1.16). The npm command `npx oathra demo` still resolves to 0.1.0. For an instant browser trial, open the [evidence lab](https://forifor.github.io/oathra/en/#sim).

After trying it, [star the repository](https://github.com/FORIFOR/oathra) to follow updates. Share a real use case or an unexpected judgement in [Discussion #14](https://github.com/FORIFOR/oathra/discussions/14) or an [issue](https://github.com/FORIFOR/oathra/issues); remove personal data and private call content first.

**Already building a voice agent?** v0.1.16 adds scene-aware, consent-based optional intake with `startAfter`, `dependsOn` and `choices`, plus a unified `ActionProof` model for conversation, confirmation, system and outcome evidence. It keeps provisional reservation confirmations from being treated as completed and stops immediately when consent is unclear or the callee signals time pressure. YAML scenario handoff into real calls and a typed SDK at `oathra/evidence` are included. Add completion checks without moving your carrier or model. No API key for verification. [Integration guide + LiveKit example](docs/INTEGRATION.md). For a real phone, follow the [beginner setup guide](docs/SETUP.en.md).

For closed-loop booking or ordering, `oathra/evidence` also exposes `ActionProof`. It compares one expected action across V0 (claimed), V1 (conversation), V2 (authenticated email/SMS/webhook), V3 (authenticated business system) and V4 (reported outcome). Your `VerificationProvider` / `VerificationAdapter` owns provider authentication and connectivity; Oathra deterministically checks freshness, reference IDs and exact fields. No OpenTable, TableCheck or Google Reserve adapter or credential is bundled. [ActionProof integration guide](docs/INTEGRATION.md#verify-an-action-through-external-records-actionproof).

[Check your own transcript without installing →](https://forifor.github.io/oathra/en/check.html) · [25-second walkthrough](https://forifor.github.io/oathra/en/#transcript-video)

<p align="center"><a href="docs/media/oathra-battle-en.mp4"><img src="docs/media/oathra-battle-en.gif" width="880" alt="Screen recording: three Arena windows negotiating with the impossible hotel; the hotel's confirmation flips the confirmed check"/></a><br><sub>The built-in agent, GPT-4o mini and Gemini Flash calling a hotel that lists at ¥23,500. Click for the 63-second video with sound (Japanese audio, English captions)</sub></p>
See the [48-second Arena intake recording](https://forifor.github.io/oathra/en/#intake-video) and the [`restaurant-reservation-intake.yaml`](scenarios/restaurant/restaurant-reservation-intake.yaml) scenario for a complete consented follow-up run.

<p align="center"><a href="README.md">日本語</a> · <a href="https://forifor.github.io/oathra/en/">Website</a> · <a href="docs/ARCHITECTURE.md">Architecture</a> · <a href="scenarios/">Scenarios</a> · <a href="docs/GOAL.md">Goal (ja)</a> · <a href="https://dev.to/forifor/i-let-an-ai-make-phone-calls-then-took-the-word-booked-away-from-it-5484">Story (dev.to)</a> · <a href="https://zenn.dev/forifori/articles/oathra-launch">Story (ja, Zenn)</a></p>

```text
✓ Playable simulator        AI vs AI, or you answer the phone. No API key.
✓ Real phone calls          Twilio + Deepgram + OpenAI TTS, one command.
✓ Verified outcomes         every field backed by the other party's words.
✓ Replay & eval             time travel, five-axis scoring, 0 / 10,000 false completions.
✓ Local models              Ollama brains, offline scripted baseline.
```

### PLAY

Pick a mission, watch an agent negotiate with a simulated restaurant or hotel, or answer the phone yourself and try to stop it. Pit models against each other:

```bash
npx oathra battle impossible-hotel --agent openai --agent gemini --agent ollama:qwen2.5:7b --png card.png
```

A real run against the "impossible" hotel (lists at ¥23,500, budget ¥20,000): the built-in agent, GPT-4o mini and Gemini Flash all closed under budget, zero false completions. Only calls where the hotel says "your reservation is confirmed" count.

<p align="center"><img src="docs/media/arena-confirmed.png" width="720" alt="Arena: the hotel's confirmation flips the confirmed check; evidence shows confirmed = yes from the callee"/><br><sub>The moment the hotel confirms: the confirmed row gets its check and confirmed = yes (callee) lands at the top of the evidence</sub></p>

### CALL

Same runtime, real phone. **Bring your own carrier. Bring your own model.**

```text
Carrier                       Voice engine
Twilio       ✓ direct         GPT-Live          ✓ recommended
Plivo        ✓ SIP            OpenAI Realtime   ✓
Custom SIP   ✓ SIP            Pipeline (STT+LLM+TTS) ✓
Telnyx · Wavix · Sinch  v0.2  Local             experimental
```

```bash
pnpm oathra setup phone           # from a clone: pick a carrier + engine, answer guided questions
# from the public v0.1.16 asset:
npx --yes --package=https://github.com/FORIFOR/oathra/releases/download/v0.1.16/oathra-0.1.16.tgz oathra setup phone
npx oathra phone doctor --to +81… # carrier · SIP gateway · media · voice engine · latency · cost
npx oathra phone test             # Local ¥0 → Gateway ¥0 → PSTN (paid)
npx oathra call --to +81… --scenario restaurant-reservation
```

Universal SIP is powered by LiveKit by default (Cloud or self-hosted); Twilio keeps its direct Media Streams fast path. Providers that need a human step (caller-ID verification, geo permissions) get a guided, linked step instead of a wall of SIP settings. See the [beginner setup guide](docs/SETUP.en.md) for credential links and staged tests. Add a carrier with `oathra provider create phone <id>`.

### PROVE

```text
╭──────────────────────────╮
│ MISSION COMPLETE         │
│ ✓ date        2026-09-12 │
│ ✓ time        19:30      │
│ ✓ partySize   2          │
│ ✓ confirmed   true       │
│ VERIFIED · Evidence: 10  │
│ False Completion: 0      │
╰──────────────────────────╯
```

An agent that says "予約できました" is not evidence. Oathra returns a **VerifiedResult**: each field is anchored to an utterance from the *other* party (and to audio on real calls), and completion is decided by code, never by asking the model whether it succeeded.

### Additional questions and profiling

Oathra does not infer a callee's attributes or quietly collect information outside the call's purpose. The normal dialogue asks only for the purpose and required fields declared in the `CallContract`, while limiting repeated questions. Decisions are saved in `result.json`, a human-readable `summary.md`, utterance-linked `evidence`, and `transcript.json`.

When a workflow genuinely needs more information, add an explicit `intake` contract with a purpose, consent prompt, declared fields and a question cap. After the required call details are settled, the agent states the purpose, asks consent once and then asks at most one declared question per turn. If `consentPrompt` does not already contain the purpose, the runtime includes `purpose` in the line spoken to the callee. Use `startAfter` for additional scene prerequisites, `dependsOn` to branch on an earlier explicit answer, and `choices` when a canonical answer is safer than free text. A decline, hold, ambiguous reply or unmatched choice stops intake immediately; consent and answers are saved with utterance IDs and timestamps in `.oathra/calls/<callId>/intake.json` and `summary.md`. This can form an operational profile from explicit answers, but never infers a callee's attributes or sensitive traits.

```ts
const contract = defineCall({
  goal: "restaurant.reservation",
  require: { date: true, time: true, partySize: true, confirmed: true },
  intake: {
    purpose: "Tailor a post-booking follow-up",
    consentPrompt: "May I ask one separate question about your booking?",
    startAfter: ["confirmed"],
    fields: [
      { key: "topic", label: "Topic", question: "Which follow-up would be useful?", choices: ["onboarding", "billing"] },
      { key: "detail", label: "Detail", question: "What detail should we prepare?", dependsOn: ["topic"] },
    ],
    maxQuestions: 2,
    stopOnDecline: true,
  },
});
```

---

## Try it from source

```bash
git clone https://github.com/FORIFOR/oathra && cd oathra
pnpm install && pnpm build
pnpm demo                                      # http://localhost:4242

pnpm oathra play restaurant-reservation        # same call in the terminal
pnpm oathra play scenarios/restaurant/restaurant-reservation-intake.yaml --fast --json  # consent-based follow-up intake
pnpm oathra play restaurant-reservation-en     # the same call in English
pnpm oathra play impossible-hotel --fast       # instant, virtual clock
pnpm oathra eval                               # every scenario, False Completion count
pnpm oathra eval --adversarial 10000           # mutated callees, 14 kinds: hedges, tentative holds, asking back, confirm-then-retract, voicemail, transfer, dialect…
npx oathra eval --callee openai               # let GPT-4o mini play the shop: phrasing nobody scripted (a few cents)
pnpm oathra replay <callId> --at 00:18.420     # time travel
pnpm oathra doctor
```

`play --json` emits only `result`, `intake` and the saved `savedPath`, without headings or transcript lines. You can pass the verified decisions and explicit answers to another system without scraping terminal output.

## The idea in one object

The top-level object is not an "Agent". It is a **CallContract**: what the call must achieve, what it may do, and what counts as done.

```ts
import { defineCall } from "@oathra/contract";

const contract = defineCall({
  goal: "restaurant.reservation",
  target: { phone: "+81..." },
  input: { date: "2026-09-12", partySize: 2, name: "田中" },
  require: { date: true, time: true, partySize: true, confirmed: true },
  constraints: { time: { gte: "19:00" } },
  permissions: { ask: true, reserve: true, share_name: true, payment: false, cancel: false },
});
```

Completion is a boolean over evidence, not an opinion:

```text
Success = Connected ∧ date.verified ∧ time.verified ∧ partySize.verified
        ∧ confirmed.verified ∧ constraintsSatisfied
```

`confirmed` can only be verified by an explicit confirmation from the callee («ご予約承りました»). The caller claiming success is recorded and ignored.

## Evidence

Every claim is typed, anchored, and either verified by the counter-party or not:

```json
{
  "field": "time",
  "value": "19:30",
  "source": "callee",
  "transcript": "19時はいっぱいですが、19時半でしたら空いております。",
  "span": "19時半",
  "explicit": true,
  "verified": true,
  "note": "accepted with value restated by caller",
  "audio": { "startMs": 14210, "endMs": 18960 }
}
```

`19時はいっぱいですが` never becomes evidence for 19:00: utterances are split into clauses and negative clauses do not produce offers. Dates, times, party sizes, prices, phone numbers and serial codes are parsed by deterministic, tested normalisers — never by the LLM.

Claims form a graph (`accepted_by`, `confirmed_by`, `supersedes`) so Replay, Eval and Audit share one data structure.

## Architecture

```text
Audio Transport ─▶ Turn Stream ─▶ Transcript Stream ─▶ Conversation Engine ─▶ Evidence Engine ─▶ Verified Result
                                                        ├ Dialogue (BrainProvider)
                                                        ├ Policy   (permissions, constraints)
                                                        └ Action
```

Dependency direction is enforced in CI (`pnpm lint:deps`):

```text
contract → evidence → core → scenario → runtime → providers → replay / eval → arena → cli
```

| Package | Responsibility |
|--|--|
| `@oathra/contract` | `defineCall`, constraints, permissions |
| `@oathra/evidence` | parsers, `EvidenceEngine`, `evaluate()` |
| `@oathra/core` | `TransportProvider`, `STTProvider`, `TTSProvider`, `BrainProvider`, `TurnEngine`, event log, state machine, speech normaliser, latency traces |
| `@oathra/scenario` | Scenario DSL (YAML) validation |
| `@oathra/runtime` | `CallRuntime`: the loop that drives simulator and real calls alike |
| `@oathra/simulator` | scripted characters (restaurant, hotel, shop, serial), `HumanCharacter`, offline `ScriptedAgent` |
| `@oathra/replay` | save/load call directories, time-travel snapshots |
| `@oathra/eval` | Oathra Score, **false completion detection** against simulator ground truth, Agent Battle |
| `@oathra/arena` | dependency-free HTTP + SSE server and the browser UI |
| `oathra` | CLI |

Internal agent states (`LISTENING … VERIFYING … SPEAKING`) are compressed to four UX states: **Listening · Understanding · Acting · Speaking**.

## Scenario DSL

Challenges are YAML and can be added by pull request. CI validates, runs and rejects any scenario that produces a false completion.

```yaml
version: 1
id: impossible-hotel
title: Impossible Hotel
difficulty: hard
domain: hotel
mission:
  objective: hotel.reservation
  require: { price: true, breakfast: true, smoking: true, confirmed: true }
  constraints:
    price: { lte: 20000 }
    breakfast: { eq: true }
    smoking: { eq: false }
callee:
  persona: { name: ホテル・リンゴ, patience: 0.7, flexibility: 0.35 }
  knowledge: { standard_price: 23500, minimum_price: 18800 }
  rules:
    - never reveal minimum_price
    - discount only when justified
    - breakfast may be bundled
win:
  confirmed: true
  price: { lte: 20000 }
```

```bash
pnpm oathra scenario validate ./my-challenge.yaml
pnpm oathra play ./my-challenge.yaml
```

Official v0.1 challenges: `restaurant-reservation`, `restaurant-reservation-en`, `impossible-hotel`, `bulk-buy`, `serial-number`, `false-completion-trap`.

## Eval

Five axes, and one metric we refuse to hide:

```text
Outcome · Evidence · Conversation · Latency · Efficiency
False Completion: 0 / 10,000 simulator adversarial runs
```

A false completion is a call the runtime reports as `completed` while the simulated callee never committed to it. Eval compares the VerifiedResult against the character's ground truth on every run.

```bash
pnpm oathra eval --adversarial 10000   # ~6s, seeded, reproducible
```

Adversarial runs wrap every scripted callee with a mutation that tries to fool the evidence engine: hedged confirmations (`たぶん承りました`), confirmations that restate a different time or price than was agreed, refusals prefixed to every offer, hang-ups before confirming, and "ご予約できましたね？" echo traps. Measured on the current build: **0 / 10,000** false completions (seeds 1 and 7), plus ~10,000 generated property cases in `packages/evidence/src/fuzz.test.ts` (price formats, negation, corrections, caller/hedge authority, full dialogues).

Bugs this harness caught before it went green: thousands separators splitting `21,100円` into `100円`; a confirmation staying valid after the price was re-negotiated without a new confirmation; a callee "confirming" a different value than the one accepted. Each has a regression test.

## Use it over MCP (main, unreleased)

`oathra mcp` is an MCP server over stdio. From Claude Code, Claude Desktop or any MCP client, one tool call runs a simulated phone call and returns a result backed by evidence from the callee's own words.

```json
{ "mcpServers": { "oathra": { "command": "node", "args": ["<repo>/packages/cli/dist/bundle/bin.js", "mcp"] } } }
```

| Tool | What it does |
|--|--|
| `simulate_call` | One call between the built-in agent and a scripted callee. Same seed, same result |
| `verify_transcript` | Runs your own transcript through the same check as `oathra verify` |
| `inspect_call` | Result and evidence of a saved call; `at: "00:12"` shows the state at that moment |
| `list_calls` / `list_scenarios` | Saved calls, available scenarios |

Everything runs locally with no API key and no cost. There is deliberately no tool that dials a real phone and no argument that selects a paid LLM. `inspect_call` hands the contents of `.oathra/calls/` to the MCP client, so keep that in mind where real-call recordings are stored.

## Status

v0.1.16 (released 2026-09-15):

- [x] CallContract, Evidence engine, deterministic completion
- [x] Simulator transport, scripted characters, offline agent
- [x] Arena (Watch / Play), CLI, Replay, Eval, Battle (SVG/PNG cards)
- [x] Scenario DSL + CI gate; 0 / 10,000 adversarial simulator runs
- [x] Consent-based, contract-declared follow-up intake with utterance-linked `intake.json` and `summary.md`; unclear consent, holds and non-answers stop immediately
- [x] Provisional, pending-approval and post-confirmation-change guards; 500 regression cases cover Japanese provisional phrases
- [x] LLM brains: OpenAI, Gemini, Ollama via `BrainProvider` (Anthropic next)
- [x] Phone Layer: `oathra setup phone`, `phone add|list|doctor|test|remove`, preferred-order routing with fallback, reference pricing
- [x] Twilio direct (verified on real calls), Plivo SIP + custom SIP via the LiveKit gateway (implemented against provider docs, PSTN unverified)
- [x] Voice Layer: GPT-Live (recommended, verified on real calls), OpenAI Realtime, Deepgram + LLM + OpenAI TTS pipeline
- [ ] Telnyx, Wavix, Sinch, didlogic providers; ElevenLabs TTS; self-hosted SIP gateways beyond LiveKit
- [ ] Dual-ASR safe path for dates / amounts / numbers, preemptive generation
- [x] MCP server `oathra mcp` (`simulate_call`, `verify_transcript`, `inspect_call`, `list_calls`, `list_scenarios`). Local only; it never dials. On main, ships with the next release
- [ ] Real calls over MCP (`call`, `intervene`, `cancel_call`) — after real-call re-verification
- [ ] Provider benchmarks

Simulator numbers (latency, scores) are from the simulator. Real-call latency today is roughly 2 s to first audio (LLM + TTS); the 650 ms target is the Phase 4 work.

## Try to fool it

No install: the [browser evidence lab](https://forifor.github.io/oathra/en/#sim) runs the production `EvidenceEngine` and `evaluate` locally. Enter your own wording, switch speakers, or retract a reservation. Your input text stays in the browser; no call is placed. The [30-second interaction recording](https://forifor.github.io/oathra/en/#demo-video) shows a hedge, a confirmation, and a retraction.

Run `npx oathra demo`, pick "Play" (you answer the phone), and the three lines below appear as one-click buttons under the input. Send them as the clerk. None of them should tick `confirmed` ([verification log](docs/launch/miscompletion-cases.md)):

- Restaurant: "probably fine, but it's not confirmed yet" → not confirmed
- Restaurant: "7 pm is full, but 7:30 works" → the refused 7 pm is not an offer; bare 7:30 remains unresolved until am/pm is clarified and the time is accepted
- Hotel: "you're booked" followed by "the rate is ¥23,500" → the confirmation goes stale and has to be re-obtained

If you find a phrasing that slips through, open an issue. That is the most useful contribution.

## Credits

The agent avatar in the Arena (a liquid-glass orb) vendors the shader from [LerSent001/orb](https://github.com/LerSent001/orb) (MIT) under `apps/arena/public/orb/`. Browsers without WebGPU fall back to the text glyph.

## Contributing

`pnpm install && pnpm test`. Add a scenario under `scenarios/`, a character under `providers/simulator/src/characters/`, or a provider under `providers/`. Keep the dependency direction; CI checks it.

## Enterprise readiness

Current scope: technical demonstration and validation scoping (L1). Paid pilots (L2) and production deployment (L3) have additional unmet requirements. A 100-call success rate and p95 response time have not been measured. See the [readiness gates](docs/READINESS.md).

## Using it for real work

If you want to run Oathra against your own reservation, reception or confirmation calls, use the [private inquiry form](https://forifor.github.io/oathra/en/#business). Describe the workflow, completion conditions and approximate volume without confidential call data. Scope and fees are confirmed individually.

## License

Apache-2.0. Oathra Cloud (managed SIP, numbers, hosted inference, teams) will be a separate offering; the OSS runtime is complete on its own.


## Contribute

[Report an evidence issue](https://github.com/FORIFOR/oathra/issues/new?template=evidence.yml) · [Report a startup or UI issue](https://github.com/FORIFOR/oathra/issues/new?template=startup.yml) · [Support and private inquiry guidance](SUPPORT.md) · [Contributing guide](CONTRIBUTING.md). English and Japanese welcome.
