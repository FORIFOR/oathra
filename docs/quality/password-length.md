# パスワード最小文字数の変更（2026-09-20）

ユーザーの「もっとパスワードを短くして下さい」に従い、設定可能な長さを15〜128文字から8〜128 Unicode code pointへ変更する。初期設定、再設定、アカウントでの変更を同じサーバー検証に通し、既存のパスワードとデータを維持する。これはユーザー要求による契約の変更であり、従来の15文字の試験結果を変更後の証拠として扱わない。

## 合格条件（変更前に固定）

| 条件 | 環境・検証方法 | 期待結果 | 証拠 |
|---|---|---|---|
| 境界と適用範囲 | 実HTTP/SQLite/scryptのGateway API試験 | 7文字と129文字を400拒否、8文字で設定・ログイン・変更・再設定、128文字を受付 | artifacts/quality/password-length/gateway.log |
| 既存認証の互換性 | 既存の長いパスワード・Origin・Cookie・失効・試行制限試験 | 既存条件を維持 | 同上 |
| 実操作 | Chromeで設定→ログイン→変更→再設定→再起動 | 8文字で成功、7文字の失敗から復帰、画面の8文字案内と一致 | browser.log |
| 稼働反映 | 通話中でないことを確認し同じDBでGateway再起動、公開HTTPSの設定画面を読取確認 | 8文字表示、電話設定・保存データ・残高を維持 | runtime.json |

既存の認証根幹試験が使用する一時ランダムID・資格情報・SQLiteに範囲を限定する。外部の利用者パスワードは操作せず、試験用DBとChromeプロファイルは終了時に削除する。モック通信・実発信・メール配送は使用しない。

## 結果

対象: HEAD `f2696fa45439a909a8974f47d679e4bddb63680e` と既存未コミット変更を維持した追加変更。macOS26.6.2 arm64 / Node25.2.1 / pnpm10.12.2 / Chrome153。検証日時2026-09-20 01:42–01:45 JST。追加変更の識別は `artifacts/quality/password-length/source-sha256.txt`。

| 判定 | コマンド・実施内容 | 観測・exit code | 証拠（artifacts/quality/password-length/） |
|---|---|---|---|
| PASS | 変更前に `node --test --test-name-pattern='passwords accept' apps/gateway/test/password-accounts.node.mjs` | 新しい8文字の要件でHTTP400を返し、想定どおり試験失敗、1。変更前の制約の再現であり合格の証拠ではない | before.log |
| PASS | `pnpm test:gateway`（typecheckを含む） | 225件PASS、0。8/128文字受付、7/129文字拒否、Unicode数え方、設定/変更/再設定、長い既存パスワード、所有者・Cookie失効・Origin・試行制限を確認 | gateway.log |
| PASS | `OATHRA_UI_EVIDENCE_DIR=artifacts/quality/password-length node scripts/ui/email-login.mjs` | 実Chromeで8文字の設定・ログイン、7文字エラーから復帰、変更/再設定/再起動後ログイン、各画面の8文字案内を照合、0 | browser.log、setup.png、password-changed-mobile.png |
| PASS | `pnpm build` | コンパイルとCLI bundle成功、0 | build.log |
| PASS | Node fetchで通話0件を確認→ `kill -TERM 17701` → `node --env-file=.oathra/managed-preview/.env.managed apps/gateway/server.mjs` | 旧プロセスの停止0、新プロセスはliveで稼働継続（終了コード未確定）。再起動前後のログイン情報・連絡先・残高・電話履歴をハッシュで照合、一致 | before-runtime.json、runtime.json |
| PASS | Node/CDPで実公開HTTPSの既存再設定リンクを開き案内を検証（フォーム送信なし） | 「8文字以上」「設定して始める」、リンクは有効、残高1/確保0/保存履歴1件、liveReady=true、例外0、検証コマンド0 | runtime.json、live-setup.png |
| PASS | `git diff --check` | 空白エラーなし、0 | 実行ツール出力 |
| NOT_APPLICABLE | 実回線発信・新規外部API処理 | パスワード条件の変更には不要。既存接続の稼働だけ確認 | runtime.json |

今回のUI試験は別の証拠ディレクトリへ出力し、15文字制限だった版の画像・ログを上書きしていない。今回は最小文字数だけを変更し、既存アカウントのパスワードは代理設定していない。公開自己登録やパスワードなしの認証を追加していない。実機IME・人間の初見評価・独立レビューは今回再実施しておらず、当該品質の再判定には使用しない。
