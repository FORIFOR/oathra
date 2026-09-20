# メールログインの実装・検証（2026-09-20）

対象: managedサービスの初回設定、メール/パスワードのログイン、変更、復帰。電話入力やクレジットの所有者を変えず、一般画面のトークン入力を廃止する。合格条件は実装前に [acceptance](../design/ui/acceptance.md) に固定した。導入・API・制限は [Gateway README](../../apps/gateway/README.md#メールログインの初回設定移行experimental-v1)。

後続変更: ユーザーの希望により最低文字数を8文字へ変更した。現在の契約と追加の検証結果は [パスワード最小文字数の変更](password-length.md)。以下は初回実装時点の検証記録。

実装: PasswordAccounts が入力・認証・リンク・版を管理し、BrowserSessions がCookie、serverがHTTP/Origin、managed-phoneが表示を担当する。既存ownerへの追加テーブルなので移し替え不要。APIトークン、SDK、self-hosted営業UIは互換維持。元の電話画面の配置を保ち、ログインは2欄、初回設定も2欄、詳細説明は折り畳み。「アカウント」から現在のパスワードを確認して変更する。

## 環境と識別

- HEAD `f2696fa45439a909a8974f47d679e4bddb63680e` ＋既存未コミット変更を保持した追加変更。ソース識別: `artifacts/quality/email-login/source-sha256.txt`。
- macOS 26.6.2 arm64、Node 25.2.1、pnpm 10.12.2、Chrome 153.0.8010.53。検証日時2026-09-20 JST。
- 実HTTP、SQLite、非同期scrypt、実Chrome/CDP。キャリア・音声AI・メール配信・決済への接続なし。Node SQLite ExperimentalWarningは出るが正常終了。
- 最小のランダムなowner/メール/パスワード、一時連絡先/残高は、認証根幹を外部権限なしで検証する暫定例外。API試験、`scripts/ui/email-login.mjs`、既存managed UI試験、独立試験だけで作成し、終了時にDB/Chromeと共に削除。実利用者データ/本番資格情報に入れず、メール配送・所有確認の成立証拠として使わない。外部統合が承認された場合に別の実接続試験を追加する。

## 結果

証拠は `artifacts/quality/email-login/`。以下のコマンドはローカル実行。CIにもGatewayテストとemail-login実画面試験を追加したが、GitHub上では未実行。

| ID | 判定 | 方法・期待する結果 | 観測・exit code | 証拠 |
|---|---|---|---|---|
| E1 | PASS | `pnpm build` / `pnpm typecheck` / `pnpm lint:deps`、コンパイル・依存方向 | すべて0 | build.log / typecheck.log / deps.log |
| E2 | PASS | `pnpm test`、既存回帰 | 1006 PASS / 1 SKIP、0。SKIPは認証ではなく実LiveKit未設定 | test.log |
| E3 | PASS | `pnpm test:gateway`、Origin/所有者/保存/セッション/リンク/旧認証失効/Bearer互換 | 224 PASS / 0 FAIL、0 | gateway.log |
| E4 | PASS | `pnpm test:ui`、既存営業Gateway/Arenaの操作を保持 | Gateway 52 / Arena 94 PASS、0 | test-ui.log、artifacts/ui/ |
| E5 | PASS | `node scripts/ui/email-login.mjs`、設定→ログアウト→不正PW→ログイン→変更→旧PW拒否→リンク再使用拒否→再設定→再起動 | CookieはJSから不可視、同ownerの連絡先ID/残高6を保持、通話0、fragment除去、すべて0 | browser.log、setup.png / login.png / invalid-login.png |
| E6 | PASS | 同実画面試験、390px/キーボード/200% CSS拡大/reduced motion/日本語文字列 | 横溢れなし、Tab/Enterで送信、Escapeで閉じる、JS例外0、0 | login-mobile.png / password-changed-mobile.png / login-zoom-200.png |
| E7 | PASS | `node scripts/ui/managed-phone.mjs`、メールログイン後の電話入力/履歴/所有者/会計表示の回帰 | 実SQLiteとUI一致、SDK再起動確認、実行は開始せず承認queue/取消/中断会計の境界、0 | phone.log、artifacts/quality/easy-phone/ |
| E8 | PASS | `node scripts/ui/managed-credits.mjs`、メールログイン後の残高/台帳 | 実HTTPの冪等付与、0→6、モバイル/キーボード、0 | credits.log、artifacts/quality/managed-credits/ |
| E9 | PASS | 一時workspaceで `setup-managed.mjs` / `login-setup.mjs`をspawn、ファイルを照合 | private URLファイル0600、正規ownerのみ、既存ファイル拒否、0。拒否子プロセス1を期待どおり照合 | setup-cli.log |
| E10 | PASS | 独立エージェントの実Chrome探索＋関連API7試験再実行 | 認証版の競合を指摘→修正→7 PASS、0、未解消P0/P1なし（検査範囲内） | independent.md / independent-login-mobile.png |
| E11 | PASS | localhost:4245を既存設定で再起動しGETと非秘密のDB件数を照合 | simulator、HTTP200、メール欄あり/トークン欄なし、元の0連絡先/0通話/0台帳を維持。初回リンクをCodexブラウザーへ表示予約 | local-runtime.log |
| E12 | BLOCKED | OS日本語IME、読み上げ、Safari/iPhone実機、人間の初見評価 | 該当環境・人による評価なし。CDP文字挿入をIME検証としない | この記録、independent.md |
| E13 | BLOCKED | 実回線・本番料金の外部照合 | 公開接続等の設定と明示承認なし。今回の認証検証で解除しない | 既存 managed-credits.md |
| E14 | NOT_APPLICABLE | メール送信・所有確認・SSO・MFA・公開自己登録 | 今回のメールID/パスワードログインには含めない。実装済みと表示しない | README、画面の管理者リンク案内 |

## 修正と検査の限界

第1ラウンドの実UI試験で、既に開いているページに新しい `#setup` を付けても初回設定へ移らない不具合を検出した（`browser-round1.log`）。hashchangeで読込を開始する修正を追加し、同URLから使用済みリンク・新再設定リンクへ遷移する実試験に合格した。初回API試験のtokenHash回転検査では、設定をJSONから読み直した後の実ユーザーオブジェクトを変更していなかったため不成立となり、実際のconfigを変更するよう試験を修正した。期待する410は変更していない。

第2ラウンドでは独立レビューが、認証結果を待つ間のパスワード変更により古い認証が新しいversionへ昇格する可能性を指摘した。認証時versionをCookie作成へ渡して同期照合するよう修正。専用試験・全Gateway224件・メール実画面を修正版で再実行した。TS build/既存UI/phone/creditsの結果はその版受け渡し修正前であり、影響したサーバー認証を上記で再確認している。最終撮影では登場animation完了を待ち、画像を実際に開いて確認した。画像の見栄えを実処理の証拠にせず、DBの残高/所有者と照合している。

通常ログインと初回設定は動作する。ユーザーのメール・パスワード自体は本人が初回設定画面で入力する必要があり、代理で推測・登録しない。メール送信・Googleログイン・実発信を行わず、push/公開/デプロイも行っていない。
