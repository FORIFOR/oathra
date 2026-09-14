# Oathra v0.1.3 — 初心者向け電話セットアップ

実電話を試すときに必要な API 設定を、ウィザードの中で確認できるようにしました。音声エンジンを選ぶと必要なキーの取得先が表示され、Plivo / Custom SIP では LiveKit の設定も続けて入力できます。

## 変更点

- `oathra setup phone` が GPT-Live / OpenAI Realtime / Pipeline の必要キーを先に確認し、入力値を `.env` に保存。
- Plivo と Custom SIP を選んだとき、`LIVEKIT_URL`、`LIVEKIT_API_KEY`、`LIVEKIT_API_SECRET` を同じウィザードで案内。
- 端末の対話入力で API トークン、シークレット、パスワードをマスク。
- Twilio の番号を空欄にした場合、アカウントの最初の音声番号を `.oathra/phone.yaml` に保存して、そのままルーティング可能に修正。
- `oathra doctor` と `phone list` に不足設定と取得先を表示。
- `.env.example` に音声エンジン、Twilio、Plivo、LiveKit、Custom SIP の設定項目を追加。
- `.env` の値に空白や `#` が含まれても次回起動時に復元できるよう保存時にエスケープ。
- `.env` が壊れている場合に黙って無視せず、修正方法を表示。
- [初心者向けセットアップ](../SETUP.ja.md)に API キー取得先、費用、段階テスト、トラブルシュートを追加。

## 確認

- `pnpm typecheck`
- `pnpm test`（138 passed、1 live test skipped）
- `pnpm lint:deps`
- `pnpm build`
- `pnpm build:site`
- ソースから生成した CLI の `doctor` / `--help` を実行し、取得先 URL と費用表示を確認。

ブラウザの証拠ラボとシミュレータは API キーなしで引き続き利用できます。PSTN の通話には電話会社、音声モデル、文字起こしの料金が発生し、LiveKit / Plivo の実接続は利用者のアカウント設定に依存します。
