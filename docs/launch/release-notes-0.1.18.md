# Oathra v0.1.18

v0.1.18 makes "a meeting was agreed" an evidence-engine verdict, closes the agreement gaps that made that necessary, and brings the omnichannel gateway under the same rule.

## Appointment-style completion

Reservations complete when a shop says 「ご予約承りました」. A sales meeting is the other way round: the caller proposes a slot and a person commits to it. Contracts can now say so:

```ts
defineCall({ goal: "sales.meeting", require: { date: true, time: true, confirmed: true }, confirmation: "callee_acceptance" });
```

`confirmed` is then verified by the callee's clean commitment (「はい、9月25日の15時でお願いします」) once date and time are stated or settled. A bare 「はい」 answers only the caller turn right before it. A later refusal or hedge from the callee takes the commitment back. The default (`callee_statement`) is unchanged, and reservation results are identical to v0.1.17.

## What no longer counts as agreement

Found by probing the gateway and by a new fuzz, fixed in `packages/evidence` for every mode:

- Scheduling conflicts next to a polite word: 「承知しました。ただ9月25日の15時は別の会議が入っています」, 先約, 出張, dialect 「できまへん」.
- Deferrals: 「上司に聞いてから折り返します」, 持ち帰り, 「検討します」, 「それから判断します」.
- 「…でお願いします、と言いたいところですが」 and 「ただ…」 without a comma are contrasts.
- A callee asking to cancel is a retraction.
- 「問題ありません」 / 「問題ございません」 were being read as refusals; they are agreements again.

Before this, the first two groups verified the caller's proposed date and time. Reservations were protected only because `confirmed` is a separate field.

## Omnichannel gateway

`apps/gateway` (LINE, Slack, Telegram, Web and iOS as remote controls for an approved call, plus separately approved Gmail / Calendar / SMS / HubSpot follow-ups) landed on main after v0.1.17. Its meeting verdict was a gateway-local regex that reported five ordinary hedged replies as COMPLETED and put a contact who said 「それで結構です」 on the do-not-contact list. It now delegates to `evaluate()`; a slot needs both sides. The gateway requires the built engine and has no fallback to the old rules.

The gateway is implemented and tested offline only. No real LINE / Slack / Telegram / Google / HubSpot account and no live line has been verified; the default mode is the scripted simulator, and live mode needs an explicit policy flag. Outbound sales calling is regulated; check the rules that apply to you before turning it on. The gateway, SDKs and plugins are not part of the npm package.

## Verification

- `packages/evidence/src/appointment-fuzz.test.ts`: 10,000 seeded sales dialogues with ground truth, 18 kinds. 0 false completions; clean commitments complete > 99%.
- `appointment.test.ts`: 145 cases including an 8 × 14 agreement × spoiler matrix in both orders.
- `pnpm test`: 877 passed, 1 skipped credential-gated LiveKit test. Gateway `node --test`: 145 / 145.
- `oathra eval`: False Completion 0, same scores as v0.1.17. `oathra eval --adversarial 10000`: 0 / 10000, same 3262 completable runs.
- `pnpm lint:deps` now also enforces `sdk → nothing`, `plugins → sdk`, `gateway → sdk, plugins, built packages`.
- Site: the Evidence Clarity redesign is live; measured at 390 px (chips 48–68 px, nav 44 px, buttons 46–50 px, no horizontal scroll).
- Not verified: real telephony, real messaging accounts, ASR errors. The agreement rules are a bounded vocabulary, not a guarantee over all Japanese.

Readiness=USER_APPROVED_RELEASE · ManualSmoke=NOT_RUN_BY_ASSISTANT · UserOverride=YES · ReleaseRisk=ACCEPTED_BY_USER
