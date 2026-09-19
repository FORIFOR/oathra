---
paths:
  - "apps/gateway/public/**"
  - "apps/arena/public/**"
  - "apps/ios/**/*.swift"
  - "site/**/*.{html,css,js}"
  - "scripts/ui/**"
  - "docs/design/**"
---
# UI engineering rules

## Design contract
- アプリUI（Gateway・Arena）は docs/design/ui/ の brief と acceptance を基準にする。公開サイト（site/）は docs/design/ の PRODUCT・DESIGN・CONTENT・ACCEPTANCE が基準で、混ぜない。ユーザーの明示指示を最優先する。
- ブランド名を隠してもプロダクトの目的が伝わるコンテンツ・構成を選ぶ。
- 情報構造・日本語コピー・操作導線を、背景装飾より先に直す。
- 原則として既存の色・文字・余白・角丸・影・motionトークンを再利用する。
- 0、100%、auto、レイアウト計算、必要な光学補正まで禁止しない。
- トークン外の値が必要なら目的を説明し、再利用するものだけ昇格させる。
- 標準部品・既存のアクセシブルな部品を優先し、独自部品は必然性がある場合に限る。

## Interaction contract
- 主操作には結果が予測できる具体的なラベルをつける。
- 状態は対象に必要なものを列挙し、不要な状態を水増ししない。
- loading/empty/error/success/disabled/focus、長文、権限なし、通信失敗を適宜確認する。
- 外部操作が必要な機能はデモと本番を区別し、デモを実行済みと偽らない。
- キーボード操作、フォーカス可視性、ダイアログの復帰先を確認する。
- 非本質的な動きはreduced-motionに配慮する。通常motionは別に実際に確認する。
- モバイル幅のWebKit確認と実機iPhone確認を混同しない。
- ブラウザ版の確認と apps/ios の実アプリの確認を混同しない。iOSはCIのビルド成功だけでは見た目も操作も未確認。

## Evidence contract
- スクリーンショットを保存するだけでなく画像として開いて読む。
- DOM/アクセシビリティツリーだけで見た目の完成を判断しない。
- スクリーンショットはサイズ、URL、状態、データ条件、撮影環境を記録する。
- 主張は測定、画像観察、推定、未確認のいずれかを区別する。
- UIの変更後には最新画像を再取得し、レビュー・テストを無効化してやり直す。

## This repository
- 画面の実操作と撮影は `pnpm test:ui`（scripts/ui/*.mjs、ローカルのChromeをCDPで操作、依存なし）。失敗したら非ゼロで終わる。
- Arenaを `dist/bin.js demo` で配信するときのアセットは packages/cli/assets/arena（`node scripts/bundle-cli.mjs` がコピー）。CSS/JSを変えたら再bundleしてから確認する。Gatewayの public/ はリクエストごとに読まれる。
- apps/arena/public/style-base.css はテストでハッシュ固定。レイアウト変更は後から読み込むCSSで行う。
- scripts/verify-evidence-workspace.py（CI）が使う要素IDを変えるときは、そのスクリプトも同じPRで直す。
- 利用者の好み（2026-09-19）: 「1枚」とは、ウィンドウに収まり整理されたダッシュボードのこと。縦に長い1列ではない。内部のフィールド名やエラーコードを画面に出さない。
