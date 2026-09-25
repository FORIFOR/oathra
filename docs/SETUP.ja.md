# 初心者向けセットアップ

未公開のソース変更: [Arenaの互換性・権限・復帰契約](quality/arena-contract.md)、[最初のローカル成果物](FIRST_PROOF.md)。既定のデモはオフライン専用です。外部モデルは `demo --allow-models` で明示的に有効化します。

Oathra は、まず API キーなしで判定機能を確認し、その後に音声エンジンと電話会社を追加する順番が一番迷いません。電話を発信しない範囲なら、ブラウザの[証拠ラボ](https://forifor.github.io/oathra/check.html)ですぐに試せます。

## 1. API キーなしで動作を確認する

ブラウザ版はインストール、アカウント登録、API キーが不要です。入力した文字起こしはブラウザ内だけで検査され、電話は発信しません。

```text
https://forifor.github.io/oathra/check.html
```

ローカルのシミュレータを動かす場合は Node.js 22 以上を用意します。

```bash
node --version   # v22 以上
pnpm --version   # 10.12.2 以上
```

`pnpm` が見つからない場合は、Node.js に付属する npm で一度だけ入れます。

```bash
npm install --global pnpm@10.12.2
```

リポジトリを clone せずに試す場合は、後述の GitHub Release 用 `npx` コマンドだけで動かせます。

```bash
git clone https://github.com/FORIFOR/oathra.git
cd oathra
pnpm install
pnpm build
pnpm oathra demo
```

`demo`、`play`、`eval` は組み込みシミュレータを使うため、API キーなしで実行できます。

公開ページをローカルで確認する場合は、サイトをビルドしてから静的サーバーを起動します。動画も `docs/media/` から同期されます。

```bash
pnpm build:site
python3 -m http.server 4380 --directory site
# http://127.0.0.1:4380/ または /en/
```

## 2. 実電話に必要なものを選ぶ

最初の実電話は **Twilio + GPT-Live** が最短です。Twilio は Oathra から直接接続でき、Plivo と独自 SIP は LiveKit の SIP ゲートウェイも必要になります。

| 目的 | 環境変数 | 取得先 |
| --- | --- | --- |
| GPT-Live | `OPENAI_API_KEY` | [OpenAI API keys](https://platform.openai.com/api-keys) |
| Gemini Live（`--engine gemini-live`、`gemini-3.8-live`） | `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey) |
| Pipeline の音声認識 | `DEEPGRAM_API_KEY` | [Deepgram Console](https://console.deepgram.com/) |
| Twilio 発信 | `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | [Twilio Console](https://console.twilio.com/) |
| Twilio 発信元番号 | `TWILIO_PHONE_NUMBER` | [Twilio 電話番号](https://console.twilio.com/us1/develop/phone-numbers/manage/search) |
| Plivo 発信 | `PLIVO_AUTH_ID` / `PLIVO_AUTH_TOKEN` | [Plivo Console](https://console.plivo.com/) |
| Plivo / Custom SIP のゲートウェイ | `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | [LiveKit Cloud](https://cloud.livekit.io/) |

Twilio 直結の発信は、電話会社から Oathra の PC へ音声を届けるために公開 URL が必要です。`oathra call` が [ngrok](https://ngrok.com/) を自動起動するので、事前に `brew install ngrok` と `ngrok config add-authtoken` を済ませてください（`oathra doctor` が導入の有無を表示します）。

キーは Oathra のリポジトリではなく、プロジェクトごとの `.env` に保存します。`.env.example` をコピーしてもよく、ウィザードに入力して自動作成してもかまいません。

```bash
cp .env.example .env
```

## 3. ウィザードを実行する

リポジトリを取得した場合は次を実行します。

```bash
pnpm oathra setup phone
```

選択画面を省略したい場合は、音声エンジンと電話会社を指定できます（APIキーは安全のためマスク入力または `.env` から読み込みます）。

```bash
pnpm oathra setup phone --engine gpt-live --provider twilio --skip-test
```

公開パッケージを使う場合は、v0.1.18 の GitHub 配布版を明示します。

```bash
npx --yes --package=https://github.com/FORIFOR/oathra/releases/download/v0.1.18/oathra-0.1.18.tgz oathra setup phone
```

ウィザードは次の順で進みます。

1. 音声エンジンを選び、必要なキーを表示して `.env` に保存します。
2. 電話会社を選び、必要な認証情報を入力します。入力済みの値は再入力されません。
3. Twilio の番号購入や海外発信許可など、管理画面でしか完了できない手順を URL 付きで案内し、完了するまで自動で確認します。
4. 最後にローカルテストを選べます。

Plivo または Custom SIP を選んだ場合は、電話会社の質問の前に LiveKit の 3 つの値も尋ねられます。秘密キーは端末に表示されず、`.oathra/phone.yaml` には保存されません。

## 4. 費用をかけずに段階確認する

セットアップ後は、いきなり発信せずに診断とテストを実行します。

```bash
pnpm oathra doctor
pnpm oathra phone list
pnpm oathra phone doctor --to +819012345678
pnpm oathra phone test --level local
pnpm oathra phone test --level gateway
```

`local` は電話会社を使いませんが、選んだ音声エンジン（および Pipeline の Deepgram）への API 使用量が発生します。`gateway` は LiveKit のループバック対応時だけ実行できます。実際の電話をかけるときだけ、最後に宛先を指定します。

```bash
pnpm oathra phone test --level pstn --to +819012345678
pnpm oathra call --to +819012345678 --scenario restaurant-reservation
```

自分のYAMLシナリオを使う場合は、`--scenario` にファイルパスを渡します。`mission.intake` を書いておけば、同意付きの追加聞き取りもローカルの `play` と同じ設定で実電話に引き継がれます。

```bash
pnpm oathra call --to +819012345678 --scenario ./my-scenario.yaml
```

電話会社の通話料、音声モデル、文字起こし API の料金が別々に発生します。テスト用の番号と、発信先の国際電話許可を先に確認してください。

## 5. つまずいたとき

- `OPENAI_API_KEY is not set`：`pnpm oathra setup phone` を再実行するか、`.env` にキーを追加します。
- `SIP providers need a SIP gateway`：`LIVEKIT_URL`、`LIVEKIT_API_KEY`、`LIVEKIT_API_SECRET` を確認します。
- Twilio の番号が見つからない：音声対応番号を購入し、`TWILIO_PHONE_NUMBER` を E.164 形式（例 `+81...`）で指定します。
- `phone doctor` の赤い項目：表示された `fix` のコマンドまたは管理画面 URL を順番に実行します。
- `.env` を変更した後に反映されない：新しいターミナルでコマンドを再実行します。既存のシェル環境変数が `.env` より優先されます。

診断結果に秘密値を貼り付けず、発生したコマンド、赤くなった項目、プロバイダ名だけを Issue に記載してください。

Arenaで練習中に一覧へ戻っても「進行中の通話に戻る」から再開できます。次の練習は現在の通話を終了してから開始します。レストランの練習日は再現性のため2026年9月12日に固定されています。

## 電話番号と内容を画面から入力する

Arenaの「電話をかける」で、電話番号・相手の名前・目的を入力します。目的は12種類のテンプレートか「過去の目的を再利用」から選べます。テンプレートの `{{項目}}` は具体的な内容に置き換えてください。「発信前に内容を確認」の後、送信先・料金・保存内容を確認し、同意して「この内容で電話をかける」を押します。確認や履歴の再利用だけでは発信しません。

Web発信はTwilioと gpt-live / gemini-live に対応するexperimental機能です。画面の「音声AI」で、API キーが設定されているエンジンを通話ごとに選べます。`.env` のTwilio/OpenAI設定と `.oathra/phone.yaml` に加え、`OATHRA_PUBLIC_WS_URL` に既存の公開 `wss://` 接続先が必要です。この接続先はTwilio音声ポート（既定4243、phone.yamlのportで変更）へ転送してください。ArenaのHTTPポートとは別です。画面から公開トンネルは作成しません。未設定項目は入力画面に表示します。再起動後や設定変更後はもう一度内容を確認してください。実回線の接続・切断・料金はまだ未検証です。

通話中は「通話を終了」を押します。終了確認が取れなければ「結果未確認」を維持します。通信会社側で終了したことを確かめてから、画面の確認操作を行ってください。自動で再発信しません。履歴と会話テキストは端末内の `.oathra/phone-history` に保存します。音声ファイルは保存しません。詳細は [Web発信の契約](quality/web-phone.md) を参照してください。

CLIへ引き継ぐ場合もJSONを保存できます。保存先のディレクトリから、まず `oathra call --request-file oathra-phone-request.json --dry-run` で確認してください。ソースから実行する場合はrepoルートで `node packages/cli/dist/bin.js call --request-file /保存先/oathra-phone-request.json --dry-run` を使います。実行時のcwdにある電話設定と.envが使われます。

実際に発信するのは `--dry-run` を `--approve-request` に置き換えたときだけです。電話会社と音声AIの利用料金、録音設定を確認してください。予算値は電話会社の請求額を保証する上限ではありません。番号・名前・シナリオの上書きフラグとの併用は拒否されるため、変更後はファイルを再確認してください。

連携済みLINE/Slackでも、メッセージに電話番号と依頼内容を記載できます。複数番号や登録名との矛盾は拒否します。商品名を指定しない友人向け依頼は汎用下書きとして番号・本文を返信し、まだ発信しません。チャンネルからの汎用実発信は未接続です。営業依頼で未登録の番号を指定した場合は連絡先登録が必要です。
