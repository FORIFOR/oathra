# 通話ごとのクレジット表示

後続変更: [通話時間と使用量による精算](metered-credits.md)を追加。以下は旧固定方式での実装・検証履歴。

2026-09-20、HEAD `f2696fa45439a909a8974f47d679e4bddb63680e` と既存未コミット変更。macOS arm64 / Node25.2.1 / pnpm10.12.2 / Chrome153。既存変更を保持。対象ソース識別とログは `artifacts/quality/call-credit-usage/`。

実装前の条件は `docs/design/ui/acceptance.md` の「通話ごとの実消費」。従来は見積・ヘッダー残高・別台帳だけだったため、通話結果と履歴に実消費、結果には現在残高を追加する。

| 期待 | 測定・観測 | 判定・証拠 |
| --- | --- | --- |
| 見積でなく実記録を表示 | 実SQLiteでnone→held→captured / released、他所有者、料金変更、再openを照合 | PASS、gateway.log。credit_holdsのowner/id/amount/statusを使用 |
| 確保と消費を混同しない | 実ServiceとChromeでQUEUEDの消費0/確保3、取消の消費0/返却3 | PASS、browser.log |
| 結果未確認でも実消費を表示 | 実Worker.claimNextの会計commit後、限定したUNKNOWN状態で「今回の消費3」「現在残高0」を表示。履歴にも3 | PASS、browser.log、credit-result.png、credit-result-mobile.png |
| 通信断の未取得データを0にしない | creditUsage未取得のrender fallbackは「消費クレジット：未確認」 | PASS、静的レビュー。実回線断の試験ではない |
| 狭幅と読みやすさ | Chrome1280/390pxで横溢れなし。画像を実際に開いて確認 | PASS、credit-result画像 |
| API互換 | creditUsageは追加フィールド、既存creditQuote/state維持、SDKから保存済み記録を取得 | PASS、browser.log |
| 実電話・実費用・請求書の照合 | 公開接続/実発信未承認、サービス未接続 | BLOCKED。上記の一時会計/状態確認で代替しない |
| 実OS IME・読み上げ・実ユーザー評価 | 今回未実施 | BLOCKED |
| ネイティブアプリ | Web/API変更のみ | NOT_APPLICABLE |

コマンド: `pnpm build`、`pnpm typecheck`、`pnpm test`、`pnpm test:gateway`、`pnpm test:ui`、`UI_EVIDENCE_DIR=artifacts/quality/call-credit-usage node scripts/ui/managed-phone.mjs`。最終exit codeと件数はcommands.json/各ログへ保存する。

会計・状態境界の根幹確認に限る暫定例外: 一時アカウントと一時SQLiteの3クレジットを使用し、設定済み本人番号はローカル入力に限定。workerのタイマー/executeは起動せず、claimNextによる実会計commitだけを行う。その後の中断状態UNKNOWNのみを注入し、架空の通話成功や通信会社応答は作らない。終了時にDBを削除し、起動中の利用者残高を変更しない。実回線の許可が得られたら本物の通話・請求照合を追加し、この限定試験をその代用にしない。

現在の方式は1発信試行あたりの固定設定クレジット。通話時間に応じた計量料金や、固定額の正式な販売価格を確定した変更ではない。
