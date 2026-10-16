# Oathra — 構成図と依存関係（oh-my-mermaid）

AI エージェントが電話で現実の用事を済ませ、その達成を決定論的な証拠で示すためのモノレポです。この構成図は、2026-10-11 の `main`（`7088b97`、PR #69〜#71 を含む）のコードを読んで作り直しました。

## 観点

| 観点 | 何がわかるか |
|---|---|
| [全体構成](overall-architecture/README.md) | Gateway・コアパッケージ・providers・プラグイン・クライアントの配置と関係。Gateway とパッケージは内部の構成まで掘り下げています |
| [依存関係](dependency-map/README.md) | `scripts/check-deps.mjs` が強制する層（layer 0〜8）と、workspace 外の Gateway・sdk・plugins の import 規則 |
| [依頼の流れ](request-lifecycle/README.md) | 電話依頼が下書き → 承認 → 発信 → `evaluate()` の判定 → 精算・通知になるまで |
| [外部連携](external-integrations/README.md) | Twilio・OpenAI・Gemini・Deepgram・ElevenLabs・Stripe などに、どこから何のためにつながるか |
| [拡張ポイント](extension-points/README.md) | plugin-kit・channel/capability SDK・同梱プラグインと、manifest の規則 |

各ページの「詳細な図と説明を見る」から下の階層に進めます。

## 専用ビューアで読む

リポジトリのルートで実行します（Node.js 18 以降）。

```bash
npx --yes --package=oh-my-mermaid@0.2.0 omm view
```

## 作り方と確認したこと

- 4 つの領域（コアパッケージ、Gateway、providers、プラグイン・SDK・その他）を並行して読み、主要な主張を grep と `package.json` で照合しました。読まずに推測した接続は図に入れていません。
- 依存の矢印は `package.json` の依存と import 文に基づきます。実行時の通信経路を実際に動かして確かめたものではありません。
- 34 枚の図はすべて Mermaid 11（ブラウザ）で描画でき、`omm validate` もすべて通りました。主要な 4 枚は画像を開いて読めることを確認しています。

## 未確認の範囲

- `apps/gateway/public` の画面スクリプトの中身、`providers/voice-pipeline` と `providers/simulator` の内部実装は、ファイル一覧と冒頭のみで判断しています。
- iOS・Desktop アプリ、`site/`、`scripts/` は README と冒頭の確認にとどまります。
- これ以降のコード変更は図に自動で反映されません。取得したコミットとファイル数は [coverage.json](coverage.json) にあります。
