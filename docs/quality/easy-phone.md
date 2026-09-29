# 電話操作の簡略化と残る接続条件

2026-09-20、macOS arm64 / Node25.2.1 / pnpm10.12.2 / Chrome153。対象revisionと未コミットソース識別は `artifacts/quality/easy-phone/commands.json` と `source-sha256.txt`。既存の変更を保持。

合格条件は実装前に `docs/design/ui/acceptance.md` へ追加。既存の電話番号・相手・目的とテンプレート/履歴を使い、入力後は「電話する」→最終確認の「同意して電話する」の2操作。元の確認＋checkbox＋発信から重複操作を減らし、費用・送信先・会話保存は最終実行前に維持する。native dialogと既存の配色/文字/操作部を使い、別ブランドの画面へ変更しない。

| 条件・期待 | 環境・観測 | 判定・証拠 |
| --- | --- | --- |
| 毎回のトークン入力を省く | 実Chrome/HTTPで初回認証→再読込→同じ電話画面。document.cookieから秘密値を読めない | PASS: browser.log |
| Cookieの安全な保持/失効 | 実SQLite/HTTPで8時間失効、ローテーション、元tokenHash変更、logout、別Origin拒否、古いアカウントの操作拒否。Bearer互換も確認 | PASS: gateway.log、browser-session.node.mjs 3件 |
| 確認・戻る | native dialog、Escで入力保持、フォーカスを目的へ戻す。確認を開いた直後は見出しにフォーカス | PASS: browser.log、confirmation画像 |
| 承認とクレジットの境界 | 実UI/Service/SQLiteで二重クリック→QUEUEDは1件・3確保→キュー待ち取消で3返却、executionIdなし | PASS: browser.log。ただし下記の限定設定注入、実電話ではない |
| 未接続状態の表示 | プレビューは「下書きを保存」、最終発信ボタン無効。設定不足を表示、直接APIの発信も拒否 | PASS: browser.log、desktop.png |
| 保存・履歴・利用者分離 | 番号のローカル入力、下書き保存、目的再利用、他所有者404、A→Bの連絡先残留なし、再起動後SDK照合 | PASS: browser.log |
| 390px、キーボード、reduced motion、CSS200% | 横溢れなし、Tab/フォーカス、dialogの戻る操作 | PASS: browser.log、mobile/confirmation-mobile/zoom-200.png |
| build/typecheck/既存試験 | build/typecheck/lint:deps/test/test:gateway/test:ui | PASS: 各ログ、全exit0。test1006PASS＋既存1skip、Gateway219PASS、UI52+94PASS |
| 本番回線・音声・実消費 | 公開HTTPS接続・音声モデル/運営設定・実発信許可不足 | BLOCKED。キュー試験や画像で代用しない |
| 実OS IME/読み上げ/実ユーザー | 未実施 | BLOCKED |
| ネイティブOSアプリ | 今回はWeb/APIの変更 | NOT_APPLICABLE |

## 限定した設定・データ注入

`scripts/ui/managed-phone.mjs` は外部発信の許可がないためworkerを一度も起動しない。一時的に一時サーバーのmode/liveReady/callerIdだけを設定し、実Serviceによる承認→キュー保存→取消・返却を検証する。番号は既存の設定済み本人番号をローカル入力だけに使用。仮の成功通話やプロバイダーの成功応答は生成しない。画像の番号はマスクする。少量のクレジット付与は一時DBだけで行い、終了時にDBとランダムな利用者を削除する。

これは根幹の承認・二重実行・クレジット境界を検証するための限定例外。実回線試験の許可と環境が整った時点で実際の接続と請求照合を追加し、この設定注入を実電話の成立証拠として使わない。`browser-session.node.mjs` の一時利用者も認可検証だけに使用する。

## 起動中のサービスで残ること

現在のlocalhost4245は確認用モード・残高0。既存の電話会社/AIキーはローカル設定に存在するが、このサービスには未接続。公開HTTPS接続、音声モデル、運営者名、料金上限と運営方針が未設定。管理者の「詳細」だけに不足を表示する。一般利用者にAPI設定を要求しない。

実発信を有効にするには、運営者のAPI設定と電話会社から到達する公開接続が必要。既設のcloudflared/ngrokは利用可能だが、今回は起動も公開もしていない。公開はユーザーの最初の権限制限により別途許可が必要。公開接続を準備しても勝手に電話をかけず、設定後の画面で利用者が承認した依頼だけを実行する。正式な販売料金・購入決済・SSOは未確定/未接続。
