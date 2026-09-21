# Check completion before replacing your voice stack

**Oathra checks saved phone-agent transcripts against declared completion conditions.** The outbound agent's own statement is not evidence that the other party agreed. You can try the checker without migrating a carrier or voice model.

[Open the browser checker](https://forifor.github.io/oathra/en/check.html?utm_source=github&utm_medium=docs&utm_campaign=first_run) · [Integration guide](INTEGRATION.md) · [Source](https://github.com/FORIFOR/oathra) · [日本語](#日本語)

## Start without installing anything

1. Open the browser checker and load its provided recording. The public example is an existing model/simulator negotiation, **not a call to a real hotel**.
2. Run the check and inspect the field values and the utterances used as evidence. Compare the full transcript with a prefix before the callee confirms. The documented behavior is completion for the full record and an incomplete result for that prefix.
3. For your own examples, use synthetic or appropriately de-identified final transcripts. Input is processed in the tab; the public guide states there is no upload or automatic storage. Do not publish real call text, phone numbers, credentials or customer details in an issue.

This page is a first-run guide, not a newly executed test report. The browser interaction and CLI replay were not re-run while preparing it.

## Use the published SDK or CLI

Node.js 22+ is required. The verified release listing on 2026-09-21 identifies v0.1.18. The repository's installation guide warns that the npm registry version 0.1.0 does not contain this checker. Pin the GitHub release asset:

```bash
mkdir oathra-first-check
cd oathra-first-check
npm init -y
npm install https://github.com/FORIFOR/oathra/releases/download/v0.1.18/oathra-0.1.18.tgz
```

Prepare input using the [documented transcript schema](INTEGRATION.md#check-your-saved-final-transcripts), then run the installed binary directly:

```bash
./node_modules/.bin/oathra verify ./transcript-check.json > result.json
```

| Exit code | Meaning |
| --- | --- |
| `0` | The declared conversation-level completion conditions are met. |
| `2` | Valid input, but incomplete, failed or constraint-violating. |
| `1` | Invalid input or execution error. |

A nonzero exit code is not automatically a broken program. For a negative regression example, assert that the result is **2**, rather than counting an input error as a successful rejection.

## Know the boundary

- Required fields and their evidence are not a complete declaration of every business requirement. Check expected values and any additional constraints separately.
- `connection: completed` means a completed connection, not a completed booking. Pass the real carrier state and reliable caller/callee attribution in production.
- Conversation-level confirmation does not establish that a booking database contains the reservation. External records need separately authenticated adapters; Oathra does not ship universal booking-service access.
- Matching uses bounded Japanese/English rules. ASR errors, unsupported wording, corrections and cancellations need workflow-specific evaluation.
- Examples are demonstrations, not customer adoption, production readiness or real-call success-rate evidence.

## Useful next step

If this is useful, [star the repository](https://github.com/FORIFOR/oathra) to bookmark it. Stars are optional: no feature, support, giveaway or benefit is conditional on starring.

For a mismatch, [open an evidence issue](https://github.com/FORIFOR/oathra/issues/new?template=evidence.yml) with a short **synthetic** input, expected result, actual JSON/exit code, and version. A small reproducible counterexample is more useful than a generic endorsement.

---

## 日本語

### まず、完了判定だけ試してください

Oathraは、保存した文字起こしから、宣言した会話上の完了条件を検査します。**電話会社や音声モデルを乗り換える必要はありません。** AIの「できました」だけでは、相手が確約した証拠になりません。

[インストール不要のチェッカー](https://forifor.github.io/oathra/check.html?utm_source=github&utm_medium=docs&utm_campaign=first_run)で公開サンプルを読み込み、結果と根拠の発言を確認してください。サンプルはモデルとシミュレーターの交渉記録であり、実店舗への電話ではありません。

ローカル検査の手順は[日本語ガイド](INTEGRATION.ja.md)にあります。上記のv0.1.18配布物を使い、終了コード `0`（会話上の完了条件を満たした）、`2`（未完了など）、`1`（入力・実行エラー）を区別してください。この資料の作成時にCLI・ブラウザ操作を再実行したわけではありません。

相手の了承と予約台帳への登録は別です。希望条件との照合、音声認識の誤り、未対応の表現なども残ります。実通話や個人情報を公開Issueへ貼らないでください。

役に立ちそうなら[GitHubでStar](https://github.com/FORIFOR/oathra)をお願いします。任意です。利用の条件にはしません。判定が違う例は、短い架空の再現例で[Issue](https://github.com/FORIFOR/oathra/issues/new?template=evidence.yml)へお願いします。
