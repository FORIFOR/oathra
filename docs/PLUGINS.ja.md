# Oathra Plugins — 接続先を本体改修なしで増やす

## 実装範囲

チャットの入口を **Channel**、電話や後続処理の実行先を **Capability** として分離しました。登録済みのプラグインは同じ認証・依頼・承認・永続化・証拠判定を利用します。LINE / Slack はこの仕組みに移行済みです。メール / カレンダー / SMS / CRM の実行部分と電話の実行口もRegistryを通ります。

WebとiOSはHTTP APIを使うクライアントであり、サーバーに動的ロードするJavaScriptプラグインではありません。既存クライアントのAPIは維持しました。Webhookは既存の `/hooks/line`、`/hooks/slack` と、新しい `/hooks/channels/<plugin-id>` の両方に対応します。

OpenClawの「Manifestと実装を登録して拡張する」考え方を参考にした **Oathra専用API v1** です。OpenClaw用プラグインやClawHubのパッケージをそのまま実行する互換レイヤーではありません。

```
LINE / Slack / Telegram / custom channel
                 |
        Channel SDK + Registry
                 |
     共通の本人紐付け・下書き・人間の承認
                 |
       CallContract / durable worker
                 |
       Capability SDK + Registry
          call / email / calendar / sms / crm
                 |
          Oathraの証拠・結果判定
```

## 実際のファイル

| 場所 | 役割 |
|---|---|
| `sdk/channel-sdk` | `@oathra/channel-sdk` のESMソースと型。verify / decode / send |
| `sdk/capability-sdk` | `@oathra/capability-sdk` のESMソースと型。preview / execute、callの実行口 |
| `sdk/plugin-kit` | Manifest・設定・権限検証、Registry、ローカルの明示的ロード |
| `plugins/line`, `plugins/slack` | 既存チャネルの実装を移した参照実装 |
| `plugins/call`, `email`, `calendar`, `sms`, `crm` | 既存実行処理を移した参照実装 |
| `plugins/telegram` | 本体コードを変更せず追加する任意のチャネル例。既定では未ロード |
| `apps/gateway/plugins.mjs` | create / inspect / pin / add / list / doctor / enable / disable |

SDKはビルド不要・外部依存なしの独立パッケージです。**npm公開は行っていません。** リポジトリから参照するか、`npm pack ./sdk/channel-sdk` と `npm pack ./sdk/capability-sdk` で配布物を作成できます。SDKはpnpmワークスペースのビルド対象と分離してあります。

## 既存ユーザーへの変更

既定のLINE/SlackのURL・環境変数・Web/iOSのAPIは維持しています。永続化済みの旧LINE/Slack受信イベントにも互換デコーダーがあります。

**この移行前の発信承認は再確認が必要です。** 実行するプラグインのコード・設定を承認対象に含めたためです。古い下書きは編集して再確認し、旧バージョンで承認済みの待機ジョブを自動的に再発信しないでください。以後も、チャネル/実行先プラグインの変更は、未実行の承認を失効させます。送信済み・実行不明の処理は自動的にやり直しません。

## 最初に接続状態を見る

```sh
node apps/gateway/plugins.mjs list
node apps/gateway/plugins.mjs doctor
```

`list` はコードを動的ロードしない設定確認です。`doctor` は明示登録したコードをロードし、登録・設定状態を確認します。**どちらも実電話やサービスへの送信、疎通試験は行いません。** カスタムプラグインのfactoryやreadyは副作用のない実装にしてください。

稼働中のGateway自身の登録状態は、管理者トークンで `GET /v1/plugins` を取得して確認できます。Webの「準備・設定」にも同じカタログを表示します。「設定あり」は接続成功や本番品質の証明ではありません。

## Telegramを追加する

1. `plugins/telegram/index.mjs` とManifestを確認します。この例は個別テキスト、承認ボタン、結果通知を扱います。音声には非対応です。
2. コードを確認した上で、内容のハッシュを取得します。

```sh
node apps/gateway/plugins.mjs inspect ./plugins/telegram
```

3. 表示された `sha256-...` を指定して登録します。ソースを見ずに自動で信頼するコマンドではありません。

```sh
node apps/gateway/plugins.mjs add ./plugins/telegram \
  --trust sha256-ここに確認したハッシュ \
  --file .oathra/plugins.json
```

4. 秘密情報をサーバー環境に設定します。

```dotenv
OATHRA_PLUGINS_FILE=.oathra/plugins.json
TELEGRAM_BOT_TOKEN=<Botのトークン>
TELEGRAM_WEBHOOK_SECRET=<ランダムなWebhook用シークレット>
```

Telegram側の `setWebhook` でURLを `https://<Gateway>/hooks/channels/telegram` にし、同じ `secret_token` を設定します。管理者によるこの設定は、この実装作業では実行していません。Telegramが付ける `X-Telegram-Bot-Api-Secret-Token` を受信時に検査します。

5. 進行中の電話がないことを確認してGatewayを再起動します。Webの連携コードをBotの個別チャットに送ります。
6. 登録済みの相手・商品について依頼し、確認カードで1件を承認します。

チャットの文を送っただけでは発信されません。グループ、Bot由来、別ユーザーのボタン操作は拒否します。承認ボタンは64バイト以内の短い不透明IDに置き換え、サーバー側で本人・宛先・プラグイン・期限を検証します。対応表は暗号化して保存します。

Telegram/Slackは通知送信のネットワーク結果が不明な場合、同じ通知が重複する可能性があります。これは電話の再発信とは別です。電話と後続処理の承認・二重実行防止は共通エンジンで管理します。

## 新しいChannelを作る

```sh
node apps/gateway/plugins.mjs create channel my-channel ./local-plugins/my-channel
```

生成されるのはManifest、Adapter、READMEです。テンプレートの送信機能は未実装エラーを返すため、送信していないのに成功とはなりません。署名検証も、既定では秘密鍵がなければ拒否します。

Manifest例:

```json
{
  "id": "my-channel",
  "name": "My Channel",
  "version": "0.1.0",
  "apiVersion": 1,
  "kind": "channel",
  "entry": "./index.mjs",
  "permissions": ["mission:draft", "mission:read", "approval:request", "channel:send"],
  "environment": ["CUSTOM_WEBHOOK_SECRET"],
  "configSchema": {"type": "object", "properties": {}, "additionalProperties": false}
}
```

Adapterのdefault exportはfactoryです。受け取るのは宣言した環境変数、検証済みの設定、fetchImpl、時計です。**Service、Store、承認発行関数は渡しません。** SDKの `defineChannel` で必要な関数を検査できます。

```js
export default function create(context) {
  return {
    verify(rawBytes, headers) { /* 改変前の本文を認証 */ },
    decode(rawBytes, headers) {
      return { events: [{
        eventId: "provider-event-id", actor: "verified-user-id",
        destination: "private-conversation-id", type: "message", text: "依頼内容"
      }] };
    },
    async send(message, { retryKey, signal, fetchImpl }) {
      // provider固有の形式へ変換。承認内容を増やしたり、受信者を推測しない。
      // providerが受け付けたときだけ {status:"accepted", providerId:...} を返す。
    }
  };
}
```

v1のverify/decodeは同期関数です。署名認証後に最大100イベントを正規化し、暗号化inboxへ記録してWebhookを返します。ネットワークを必要とする処理はworker側で行います。音声は任意の `transcribe` と `media:transcribe`、ボタンの応答は任意の `acknowledge` です。下書き・承認要求・通知は、既存の共通処理をそのまま使います。

## 新しいCapabilityを作る

```sh
node apps/gateway/plugins.mjs create capability salesforce-note ./local-plugins/salesforce-note
```

v1で扱う副作用の種類（effect）は `email / calendar / sms / crm / call` です。同じ種類の別プロバイダーや業務処理をプラグイン化できます。全く新しい副作用種別を自由に宣言して安全ポリシーを迂回することはできません。新しいeffectの追加には本体側のレビューが必要です。

後続処理は `preview(input, {mission, contact, now})` と `execute(action, {bearer, fetchImpl, signal})` を実装します。previewは外部書き込みをしない同期関数です。executeは、人間が内容を確認し、共通エンジンがEXECUTINGを永続化してから呼び出します。

`POST /v1/followups/preview` の `kind` にプラグインIDを指定すれば、既存の承認・実行APIを利用できます。Webの後続処理一覧もRegistryをもとに表示します。送信先は登録済み連絡先から本体が設定し、プラグインによる別人への置換を拒否します。Preview/Executeへ渡す入力は読み取り専用のコピーです。

providerの戻り値の `COMPLETED` や `verified` を、そのまま最終結果に採用しません。書き込みの応答は `SUBMITTED`（受付）として残し、受領・既読・予定承諾とは分けます。例外・タイムアウトは `UNKNOWN` 等となり、自動再試行しません。executeで渡されたfetchImplは送信直前にも再連絡停止・宛先変更を再検査します。

電話は `defineCallCapability({execute})` により実行口を差し替えられます。選択はサーバーの `OATHRA_CALL_PLUGIN` で明示します。別の電話プラグインでも、本人の承認、発信先、時間・予算・再連絡停止、workerの状態管理と証拠からの判定は本体に残ります。

## 設定・更新・無効化

設定ファイルの構造は次のとおりです。CLI addで、実在するディレクトリに対する正しい内容が生成されます。

```json
{
  "version": 1,
  "disabledBuiltins": [],
  "entries": [{
    "id": "my-channel", "path": "../local-plugins/my-channel", "enabled": true,
    "integrity": "sha256-確認した実際のハッシュ",
    "grants": ["mission:draft", "mission:read", "approval:request", "channel:send"],
    "config": {}
  }]
}
```

pathは設定ファイルからの相対パスです。Manifestが要求する権限と管理者のgrantsが一致する必要があります。未知の権限やAPIバージョン、重複ID、設定の型違い、改変されたファイル、シンボリックリンクは拒否します。設定スキーマは厳格な小さなJSON Schemaサブセット（object/string/number/integer/boolean/array、required/enum/範囲等）です。非対応のキーワードや `$ref` は黙って無視せず拒否します。

```sh
node apps/gateway/plugins.mjs disable telegram --file .oathra/plugins.json
node apps/gateway/plugins.mjs enable telegram --file .oathra/plugins.json
```

**反映にはGatewayの再起動が必要です。ホットリロードは未実装です。** 停止前に進行中の電話を確認してください。無効化後は受信・送信・実行のルーティングが閉じます。未完了ジョブを自動的に成功扱いにしません。更新時はソースを再確認してpinを更新し、必要な権限を再承認します。

## 信頼境界 — 誤解してはいけないこと

**プラグインは同一Node.jsプロセスで動く、管理者が信頼したコードです。サンドボックスではありません。** Manifest、grants、限定したcontextは、誤設定・API経由の権限逸脱を防ぐ契約であって、悪意あるJavaScriptをOSレベルで隔離するものではありません。プラグイン自身がprocess.env、ファイルシステムやグローバルfetchにアクセスすることを、この仕組みだけで禁止することはできません。

不特定の配布サイトから自動ダウンロード・自動実行はしません。ローカルの明示したソースだけを読み込みます。ハッシュはプラグインディレクトリ内を検査しますが、ディレクトリ外のSDK・npm依存・システムライブラリまで監査した証明ではありません。それらのバージョン固定・監査は運用者が別途行う必要があります。ホストを書き換えられる管理者やマルウェアへの隔離保証でもありません。

未知の第三者コードを広く配る公開マーケットプレイス、プロセス/コンテナ隔離、配布物の署名検証、OpenClawバイナリ互換は、この実装に含みません。外部プラグインが新しいサービスへデータを送る場合、プラグイン固有の送信先・利用目的・同意文も運用者が確認・更新してください。既存のTwilio/OpenAI説明が全プラグインのデータ利用を自動的にカバーするわけではありません。

## 検証

```sh
node --test apps/gateway/test/*.node.mjs
pnpm exec tsc --noEmit --strict --module nodenext --target es2022 --lib es2023,dom apps/gateway/test/sdk-types.mts
```

署名偽造、型/Manifest、権限不足、ロード前検査、コード変更、旧承認、別アカウント、暗号化コールバック、recipient置換、二重実行、プラグインの偽完了、外部プラグイン追加、Telegram HTTP→確認→承認→模擬実行を検証します。外部ネットワークはテストダブルを使います。実LINE/Slack/Telegramアカウントや実電話でのテストは別途必要です。

## 参照した一次資料

- OpenClaw Plugins: https://docs.openclaw.ai/tools/plugin
- OpenClaw Plugin manifest: https://docs.openclaw.ai/plugins/manifest
- Telegram Bot API (setWebhook / InlineKeyboardButton): https://core.telegram.org/bots/api

APIはそれぞれの提供元で独立しています。OathraのManifest/APIと混同しないでください。
