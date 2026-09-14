# 既存の音声AIに、完了判定だけを加える

[ブラウザで自分の文字起こしを検証する](https://forifor.github.io/oathra/check.html)。インストール・APIキー不要。公開済みのモデル／シミュレーター交渉ログも読み込めます。入力はタブ内で処理し、送信・自動保存しません。

Oathra v0.1.9では、電話会社・音声モデル・エージェント基盤を移行せず、保存済みの文字起こしを検査できます。判定はローカルで動き、API呼び出し・APIキーは不要です。[English / 詳細な入力仕様](INTEGRATION.md)

実電話まで試す場合は、API キーの取得先と段階テストをまとめた[初心者向けセットアップ](SETUP.ja.md)を先に確認してください。

## インストール

Node.js 22以上で実行します。

```bash
npm install https://github.com/FORIFOR/oathra/releases/download/v0.1.9/oathra-0.1.9.tgz
```

npmレジストリの0.1.0には今回のSDK・検査コマンドがありません。上記のGitHub配布版を使ってください。

## 自分の文字起こしを検査する

入力JSONには、実際の通話に対応する次の4項目を入れます。

| 項目 | 内容 |
| --- | --- |
| `contract` | `goal`、`language`（`ja` / `en`）、必須項目を指定する`require`、必要に応じて`constraints`を持つCallContract |
| `referenceDate` | 通話先の暦での通話日。`YYYY-MM-DD`形式。「明日」などの基準になります |
| `connection` | 実際の接続状態。`idle` / `dialing` / `active` / `completed` / `failed` |
| `utterances` | 発言順の`{ id, source, text, t }`配列。`source`は発信AIが`caller`、相手が`callee`。`t`は通話開始からのミリ秒 |

確定した文字起こしだけを渡します。発言IDは一意にし、途中のASR結果や、生成しただけで相手に再生されなかった発言は含めません。空の必須項目、発言IDの重複、時刻の逆転、存在しない日付はエラーになります。

```bash
npx oathra verify ./transcript-check.json > result.json
```

終了コードは、完了条件を満たせば`0`、未完了・接続失敗・条件違反なら`2`、入力エラーなら`1`です。JSONには確認済みの値、足りない項目、条件違反、根拠となる発言が入ります。出力にも文字起こしが含まれるため、通話記録と同じ場所で管理してください。

JavaScript / TypeScriptでは同じ入力を渡せます。

```js
import { readFileSync } from 'node:fs';
import { verifyTranscript } from 'oathra/evidence';

const input = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const result = verifyTranscript(input);
console.log(JSON.stringify(result, null, 2));
```

`EvidenceEngine`、`defineCall`、`evaluate`も型定義付きで読み込めます。発言を逐次処理する場合は、通話ごとにエンジンを作り、終了時に実際の接続状態を渡して評価します。

## 同意付きの追加聞き取り

予約後の案内などで相手の明示回答が必要な場合だけ、`CallContract.intake` を追加します。`purpose`、同意を得る `consentPrompt`、質問文とキーの配列、`maxQuestions`（最大8問）を必ず宣言してください。必要な予約情報が確定した後に同意を一度尋ね、同意後は1回に1項目だけ質問します。拒否、保留、曖昧な返答の場合はその場で停止し、推測やセンシティブ属性の収集は行いません。

```ts
const contract = defineCall({
  goal: "restaurant.reservation",
  require: { date: true, time: true, partySize: true, confirmed: true },
  intake: {
    purpose: "予約後の案内を適切にする",
    consentPrompt: "予約とは別に1点だけ伺ってもよろしいでしょうか？",
    fields: [{ key: "role", label: "ご担当", question: "ご担当を教えていただけますか？" }],
    maxQuestions: 1,
    stopOnDecline: true,
  },
});
```

同意後の回答は `.oathra/calls/<callId>/intake.json` と `summary.md` に、質問項目・回答・発話ID・時刻を含めて保存します。契約に `intake` がなければ、この追加質問は発生しません。

シナリオをYAMLで管理する場合は、同じブロックを `mission.intake` に置きます。`oathra play ./my-scenario.yaml` でローカル確認した設定を、そのまま `oathra call --scenario ./my-scenario.yaml --to +81...` の実電話へ渡せます。

```yaml
mission:
  objective: restaurant.reservation
  require: { date: true, time: true, partySize: true, confirmed: true }
  intake:
    purpose: 予約後の案内を適切にする
    consentPrompt: 予約とは別に1点だけ伺ってもよろしいでしょうか？
    fields:
      - { key: role, label: ご担当, question: ご担当を教えていただけますか？ }
    maxQuestions: 1
    stopOnDecline: true
```

## 公開済みの記録で動作を見る

ソースを取得して`pnpm install && pnpm build`を実行後：

```bash
node scripts/export-recorded-check.mjs > /tmp/oathra-check.json
node packages/cli/dist/bin.js verify /tmp/oathra-check.json
```

既存のGPT-4o miniとホテル役シミュレーターの交渉記録を、発言・時刻を変えずに変換します。19,900円の予約という記録済みの結果と一致し、相手の確定発言より前のログだけでは未完了になります。これは実店舗への電話でも、実電話の成功率評価でもありません。

## LiveKitへの接続と限界

[既存のLiveKit AgentSessionに接続する関数](../examples/livekit-evidence.ts)も用意しました。`@livekit/agents@1.8.1`で型を検査しています。実セッション・割り込み・PSTNでの動作は未検証です。割り込まれた発言がある通話は要確認として、完了を返さない設計です。接続終了を予約成功と取り違えないよう、実際の接続状態を渡してください。

判定は対応済みの項目・日本語と英語の規則に基づきます。店舗の予約台帳は確認しません。音声認識の誤りや未対応の言い回しは残ります。英語の`7:30`は午前・午後が不明なため、以前に`7 pm`と言っていても未確認にします。午前・午後を明示して再確認する必要があります。

実際に困った例は、個人情報を除いて[判定の問題を報告](https://github.com/FORIFOR/oathra/issues/new?template=evidence.yml)してください。役に立ちそうなら、後で見つけられるよう[GitHubでStar](https://github.com/FORIFOR/oathra)してもらえると助かります。業務への組み込みは[非公開の相談フォーム](https://forifor.github.io/oathra/#business)へ。
