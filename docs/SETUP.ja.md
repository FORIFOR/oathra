# 初心者向けセットアップ

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
| GPT-Live / OpenAI Realtime | `OPENAI_API_KEY` | [OpenAI API keys](https://platform.openai.com/api-keys) |
| Pipeline の音声認識 | `DEEPGRAM_API_KEY` | [Deepgram Console](https://console.deepgram.com/) |
| Twilio 発信 | `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | [Twilio Console](https://console.twilio.com/) |
| Twilio 発信元番号 | `TWILIO_PHONE_NUMBER` | [Twilio 電話番号](https://console.twilio.com/us1/develop/phone-numbers/manage/search) |
| Plivo 発信 | `PLIVO_AUTH_ID` / `PLIVO_AUTH_TOKEN` | [Plivo Console](https://console.plivo.com/) |
| Plivo / Custom SIP のゲートウェイ | `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | [LiveKit Cloud](https://cloud.livekit.io/) |

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
