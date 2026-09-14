# Check an existing voice agent's transcripts

[Check your own transcript in the browser](https://forifor.github.io/oathra/en/check.html). No installation or API key. Load the existing model/simulator negotiation or paste your own check JSON. Input stays in the tab; no upload or automatic storage.

Oathra v0.1.15 can check reservation evidence without replacing your carrier, voice model or agent framework. It also guards against provisional, pending-approval and confirmation-needed phrases being treated as completed reservations. Consent-based follow-up intake stops when the callee signals time pressure. It runs locally. Verification makes no API calls and needs no API key. [日本語](INTEGRATION.ja.md)

## Install the released SDK and CLI

Node.js 22+:

```bash
npm install https://github.com/FORIFOR/oathra/releases/download/v0.1.15/oathra-0.1.15.tgz
```

Use the GitHub asset: the npm registry still serves 0.1.0, which does not include this SDK or command. Both `oathra` and `oathra/evidence` export `EvidenceEngine`, `defineCall`, `evaluate` and `verifyTranscript`, with TypeScript declarations. The SDK entry does not load CLI, carrier or model clients.

## Consent-based optional intake

If a workflow needs an explicit answer for a post-booking follow-up, add `CallContract.intake`. Declare the `purpose`, a `consentPrompt`, the field keys and exact questions, and `maxQuestions` (up to eight). Oathra states the purpose and asks for consent once after the required call details are settled, then asks one declared field per turn. If `consentPrompt` does not already contain the purpose, the runtime includes `purpose` in the line spoken to the callee. Use `startAfter` for additional mission prerequisites, `dependsOn` to branch on an earlier explicit answer, and `choices` when a canonical answer is safer than free text. A decline, hold, ambiguous reply or unmatched choice stops intake immediately; it never infers a profile or sensitive traits.

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
    maxQuestions: 1,
    stopOnDecline: true,
  },
});
```

After consent, answers are stored in `.oathra/calls/<callId>/intake.json` and `summary.md` with the field, answer, utterance ID and timestamp. The consent decision itself is also recorded with provenance, so an operational profile and decision memo can be audited later. Without `intake`, no optional questions are generated.

`stopOnDecline` is still accepted for older contracts, but a refusal, hold or ambiguous reply always ends optional intake. A contract cannot turn repeated questions back on.

## Verify an action through external records (ActionProof)

A callee saying “your reservation is confirmed” is V1 conversation proof. The transcript alone cannot prove that the venue's ledger accepted the booking. `@oathra/evidence` now exposes `ActionProof`, which compares one expected action with conversation evidence, authenticated notifications and authenticated system records.

```ts
import {
  conversationObservation,
  evaluateActionProof,
  type ActionExpectation,
} from "@oathra/evidence";

const expected: ActionExpectation = {
  action: "restaurant.reservation",
  fields: { date: "2026-09-20", time: "19:30", partySize: 2 },
};

// Build V1 from verifyTranscript() output. The agent's own words are not proof.
const conversation = conversationObservation(expected, transcriptResult);

// `confirmation` is normalized by an authenticated VerificationProvider /
// VerificationAdapter for an email, SMS or webhook.
const proof = evaluateActionProof(expected, [conversation, confirmation], {
  now: new Date(),
});
```

The levels are `claimed` (V0, unverified), `conversation` (V1), `confirmation` (V2), `system` (V3) and `outcome` (V4). V2+ observations must be authenticated by the provider (`sourceVerified: true`), carry a stable `referenceId`, contain every expected field, and use valid ISO-8601 timestamps. Expired or future records and field conflicts are rejected; a valid lower-level observation remains available when a higher-level record fails validation.

External integrations implement this contract. Authentication, signature checks, PII handling and retries stay in the provider; Oathra performs the deterministic comparison on the returned observation.

Your host application implements `VerificationProvider.verify(expected, context)` and returns a `ProofObservation` from the authenticated connection. Return `sourceVerified: false` when authentication fails. A concrete provider implementation depends on the service contract, signature scheme and retention requirements, so none is included in this repository.

This release does not ship OpenTable, TableCheck or Google Reserve adapters, credentials or network calls. [OpenTable's developer documentation](https://dev.opentable.com/) describes partner access for its Sync / Booking APIs, and [Google Reserve's Booking Server readiness steps](https://developers.google.com/actions-center/verticals/reservations/e2e/integration-steps/booking-server-ready) must be completed before a production adapter. Do not treat visual scraping, unsigned forwarded messages or an agent's self-report as V2/V3 proof.

Email, SMS and webhook payloads can contain personal data. Define purpose, consent, retention and deletion in the host application, and keep credentials, full message bodies and customer data out of `metadata` and logs. V4 (a visit, payment or other business outcome) is a separate, explicit `outcome` observation from an operator or business system; a phone call cannot prove it by itself.

For YAML-managed scenarios, place the same block under `mission.intake`. `oathra play ./my-scenario.yaml` and `oathra call --scenario ./my-scenario.yaml --to +1...` then share the same contract and stop rules, so a local check can be carried into a real call without rewriting the intake settings.

```yaml
mission:
  objective: restaurant.reservation
  require: { date: true, time: true, partySize: true, confirmed: true }
  intake:
    purpose: Tailor a post-booking follow-up
    consentPrompt: May I ask one separate question about your booking?
    fields:
      - { key: role, label: Role, question: What is your role? }
    maxQuestions: 1
    stopOnDecline: true
```

## Check your saved final transcripts

Prepare a JSON document with these fields, using your own recorded utterances:

| Field | Content |
| --- | --- |
| `contract` | Your CallContract, with `language` (`ja` or `en`), `goal`, at least one true `require` field, and any `constraints` |
| `referenceDate` | Actual call-local calendar date, `YYYY-MM-DD`; anchors “tomorrow” and month/day expressions |
| `connection` | Actual `idle`, `dialing`, `active`, `completed` or `failed` state; do not infer it from an LLM summary |
| `utterances` | Chronological array of `{ id, source, text, t }`; `source` is `caller` (outbound agent) or `callee` (other party), `t` is call-relative milliseconds |

Optional utterance fields are `language`, `audio: { startMs, endMs }` and `asr: { primary, secondary? }` (0–1). Use unique IDs and final transcripts only. Do not include interim ASR updates or text the agent planned but never spoke. The checker rejects duplicate IDs, reversed timestamps, invalid dates and empty requirements.

```bash
npx oathra verify ./transcript-check.json > result.json
# stdin is also supported:
cat ./transcript-check.json | npx oathra verify -
```

Exit codes: **0** = completion conditions met; **2** = valid input but incomplete, failed or constraints violated; **1** = invalid input or an execution error. JSON includes `fields`, `missing`, `constraints`, and utterance-linked `evidence`. It contains transcript text: keep output where you intend to store your call records.

The same input works in your application:

```js
import { readFileSync } from 'node:fs';
import { verifyTranscript } from 'oathra/evidence';

const input = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const result = verifyTranscript(input);
console.log(JSON.stringify(result, null, 2));
```

## Replay the existing public recording

From a source checkout after `pnpm install && pnpm build`:

```bash
node scripts/export-recorded-check.mjs > /tmp/oathra-check.json
node packages/cli/dist/bin.js verify /tmp/oathra-check.json
```

This reads the existing [GPT-4o mini negotiation record](../site/data/call-gpt4o-mini.json), preserving its utterances and timing. The hotel was a simulator, not a real hotel or PSTN call. The replay reproduces the recorded ¥19,900 booking; its actual prefix before the hotel's confirmation remains incomplete. This verifies replay behavior, not real-call reliability.

## LiveKit Agents

[The integration function](../examples/livekit-evidence.ts) attaches to an existing outbound `AgentSession`, observes committed conversation items, and exposes a local result. Import it into your own agent after installing `oathra` and your LiveKit dependencies. One binding represents one call; detach it on cleanup. Assistant maps to caller; user maps to callee. This mapping is for outbound agents, not arbitrary inbound sessions or conference rooms.

The example uses the official [conversation item event](https://docs.livekit.io/reference/agents/events/#conversation_item_added). LiveKit distinguishes final chat history from live transcription updates and [may truncate synchronized speech on interruption](https://docs.livekit.io/agents/multimodality/text/). The adapter conservatively requires review after an interrupted item and will not return completed for that call. Pass the actual carrier state to `result(connection)`; closing a session alone does not prove a successful call.

This adapter is type-checked against `@livekit/agents@1.8.1`. A live session, transcript delivery, interruptions and PSTN behavior have **not** been validated in this release. Framework-independent checking is validated against the existing recording above.

## Limits and feedback

This is a rule-based Japanese/English evidence checker for supported fields, not a general semantic judge. It does not verify whether a reservation exists in the venue's backend. ASR mistakes and unsupported phrasing can change its result; missing ASR confidence is not a measured accuracy score.

English bare times such as “7:30” now remain unresolved, even after “7 pm” earlier in the conversation. Ask for an explicit am/pm or unambiguous 24-hour time and confirm it again. This conservative fix avoids silently verifying 07:30; it does not implement conversational meridiem inference. Timezone conversion is not performed.

[Report an actual mismatch](https://github.com/FORIFOR/oathra/issues/new?template=evidence.yml) with the version, expected result and redacted transcript sequence. Please remove names, phone numbers and private business data before sharing publicly. If this is useful, [star the repository](https://github.com/FORIFOR/oathra) to find it again as it develops. [Private implementation inquiries](https://forifor.github.io/oathra/en/#business) are separate from public bug reports.
