# 公開サイトのcraft改善 — 2026-10-02

対象: `site/index.html`、`site/en/index.html`、両言語のログ検証ページ。既存ラボ・交渉再生は `lab.html` / `en/lab.html` に保持。公開へのpush・デプロイはしていない。

## 観察と方向

公開中の日本語トップとローカルのJA/ENトップ・checkerを実際のChromeで開き、before画像を保存して目視した。以前のトップは一般向け電話サービスがすぐ使えるように読め、スマホでは説明とコマンドの下に判定体験が隠れていた。checkerは判定値と根拠の発言が別々に置かれていた。

検討した構図:

1. **証拠の見開き**: 短い主説明と、実記録の発言→条件→判定を横に並べる。
2. **一本の監査線**: 縦の発言履歴を主役にする。詳しく読めるが、初回操作までが長くなる。
3. **Arena動画から始める**: 実演を大きく見せる。動画内の文字は狭幅で読みづらく、初回の転送量も増えやすい。

1を採用した。Mistの明るい背景、墨色の主操作、jadeの証拠表現に整理。Gatewayの既存 `mark.png` をそのままコピーし、入口のブランドを揃えた。外部フォント、新規画像生成、スクロール奪取、自動動画再生は加えていない。

## 何を変えたか

- 最初に「既存の音声AIに完了判定だけを追加できる」と伝え、ログ検証とSDK導入へ進める。
- 公開済み `recorded-check.json` の3時点を同じ本体エンジンで再計算する。途中は記録のprefix＋active、最終は全発言＋元のcompletedを用いる。発言・判定値を作っていない。
- 発言→判定の線と時点切替を、この製品固有の操作にした。自動で切り替えない。
- checkerの現在値に、採用された証拠の発言範囲と秒数を併記。全発言・更新前の値を含む既存の履歴とJSON出力も保持。
- 既存のArena動画、明示同意を伴う問い合わせフォームを保持。営業AI/MCPの公開準備中、一般電話サービス・購入の未公開を明記。
- ラボ、保存イベントの再生、CLI/回線設定の既存機能を別ページに移し、トップから直接案内。過去の公開セクションリンクも移行した。

## 根拠と確認

| 証拠 | 結果 | 内容 |
| --- | --- | --- |
| `site-before.json` | 11 PASS | 公開ページとローカルbefore、実保存記録でのchecker操作 |
| `site-after-a.json` | 23 PASS | 第一稿、時点切替、両言語・狭幅・キー操作・reduced motion |
| `site-after-b.json` | 41 PASS | ラボ移行、既存原記録を用いた形式エラーと復帰、現在値の根拠表示 |
| `site-after-c.json` | 49 PASS | 文字・CTAの最終調整、主要コントラスト、ローカルリンクと媒体の存在 |
| `site-legacy-links.json` | 41 PASS | 旧HEADの全section ID＋sim/rec/playerから実ブラウザで移行先を確認 |
| `site-local-analytics.json` | 2 PASS | JA/ENの既存ラボを実操作し、ローカルから集計events送信0を確認 |
| `site-mobile-result-after.json` | PASS | root独立追試。390×844の実pointerでJA/ENとも成功直後の結果全体が表示 |

画像は各JSONのscreenshotsに列挙。初期・完了・形式エラー・mobile・英語結果・提供範囲を実際に開いてレビューした。第2ラウンドで、360pxの完了見出し末尾だけが折り返される問題を確認し、判定コードをラベル行に置いて見出し幅を確保した。

Chrome 154 / macOSの実ブラウザで、1440×1000、390×844、360×800、720px幅のリフローを確認。時点切替をEnterで実行し、reduced motion下でtransitionが止まることを確認した。全キーボード経路やスクリーンリーダーの網羅試験ではない。

主要テキスト8系統のcomputed color/backgroundから得たcontrastは最小4.58:1、主CTAは14.87:1。出典・重要な制約は12px以上。disabled状態を含む全要素の自動アクセシビリティ認証ではない。

第3ラウンドのconsole error、runtime exception、失敗したローカル媒体リクエストは0。ホームJSは本体判定エンジン込みで約98KB（非圧縮）。動画はpreload=noneで、初期リクエストにMP4はなかった。ローカル測定は本番回線のCore Web Vitals保証ではない。既存ポスター約427KBと既存ロゴ約110KBは使用している。

独立担当はSafari 27.0.1 / macOS 27.0.1でも、保存記録→complete:true→消去→JSON保存不可を実操作した。CTAが薄灰色に見える所見に対し、appearanceの明示とbackground transition撤去を行い、390pxの再読込で墨背景＋白文字を再確認した。独立担当の別報告を参照。

## データと作用の境界

- 使用記録は従来公開されているGPT-4o-miniとホテルシミュレーターの交渉。実電話の記録・新規顧客・架空の利用成果は作っていない。
- 形式エラーには既存の `call-gpt4o-mini.json`（イベント原記録）そのものを入力した。checker用入力と異なる実在形式なので拒否され、対応形式の保存記録を読み直して復帰できた。
- 既存ラボの従来例文は保持した。新たなダミー会話は作っていない。
- 問い合わせ送信、課金、発信、外部SNS投稿、実プロバイダー接続は行っていない。
- no-JSの案内とCLIへの導線は静的に保持。JavaScript無効状態のブラウザ実操作、ファイル保存後のOS上の確認、実機スマホ、支援技術、200%ブラウザzoomは未検証。720pxリフローを200%実機試験とは数えない。

## 再実行

```sh
pnpm build:site
pnpm exec tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --lib ES2023,DOM --strict --exactOptionalPropertyTypes --noUncheckedIndexedAccess --skipLibCheck site/src/story.ts site/src/check.ts
node scripts/ui/site-craft.mjs --stage after-recheck
```

buildと上記の厳密型検査、diff whitespace checkはPASS。既存証拠は上書きしない。`site-links.mjs` はローカル8768ポートでsite/を配信したうえで実行する。

第3ラウンド後の修正:

- 旧リンク7章等の `legacy.js` 移行先追加。別途41件PASS。
- check.cssの空白除去。見た目の変更なし。
- `portfolio.js` の集計だけにlocalhost / 127.0.0.1 / ::1のガード。既存ラボの公開済み選択肢を実pointerで操作し、未完了→完了になった後も集計APIへのResource Timing entryが0件であることをJA/ENで確認した。fetch差し替え・スタブは使わず、フォーム送信処理は変更していない。
- 独立したroot検証で、390×844の画面下部にsubmitを置くと結果summaryが957px下方に残る問題を確認。成功描画の共通show()で、760px以下かつsummaryがviewportに収まらない場合だけ結果panelへ即時移動する。JSONと発言ラベル形式に共通で、デスクトップと形式エラーは移動しない。rootが同じpointer条件でJA/ENを追試し、結果の上端は957pxから95pxへ、判定全体が画面内に入った。実操作したのはJSON経路で、発言ラベル形式は同じshow()を使うことの静的確認に留める。

各証拠のsource hashは撮影時点のまま保持し、最終状態は `site-final-manifest.json` に別記する。審査員による評価、受賞、一般利用者の成功率の根拠にはしていない。
