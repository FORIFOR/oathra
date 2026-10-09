# 公開登録・メール所有確認・パスワード回復（2026-10-01）

判定: **BLOCKED — 実装と構文確認は完了。実メール配送・一般利用者による登録の成功は未確認。**

対象は `apps/gateway/lib/public-accounts.mjs` と `password-accounts.mjs`。既存の管理者発行リンク・Bearer認証・owner・残高・保存記録を保持し、公開登録用の永続利用者を追加する。公開・配送・課金をこの文書の作成時点で実行していない。

## 先に固定した契約

- `PublicAccounts(service, env).status()` は `signupEnabled` / `passwordResetEnabled` / `termsUrl` / `privacyUrl` / `termsVersion` を返す。
- `requestSignup({email}, ip)` と `requestReset({email}, ip)` はメール確認を受け付け、`{accepted:true}` を返す。配送事業者の受付は受信者への到達確認ではない。
- `verifySignup({code,password,acceptedTerms:true,termsVersion}, ip)` はメールリンクの所持、現行規約の同意、期限、未使用、メールの一意性を検査し、`{user,version}` を返す。
- `reset({code,password}, ip)` はメール所有確認済みの公開利用者だけを対象とし、パスワードの版を更新する。以前のCookieは既存の BrowserSessions の版照合で失効する。
- HTTP層は既存の同一Origin検査を適用し、`user` のtokenHashなどを公開レスポンスへ直接展開せず、既存のHttpOnlyセッションを発行する。

## 有効化に必要な設定

`OATHRA_DEPLOYMENT=managed`、固定の公開HTTPS originである `OATHRA_PUBLIC_URL`、`RESEND_API_KEY`、小文字の送信元メールアドレス `OATHRA_MAIL_FROM` が必要。localhost・IP literal・local/testドメイン・一時trycloudflare URLでは有効化しない。公開登録にはさらに `OATHRA_PUBLIC_SIGNUP=true`、公開HTTPSの `OATHRA_TERMS_URL` と `OATHRA_PRIVACY_URL`、`OATHRA_TERMS_VERSION` が必要。設定値の形式検査はDNS疎通・所有権・文書内容・本番運用の確認を代替しない。

登録を閉じた後でもメール設定が有効なら既存の公開利用者は回復できる。従来のメールIDは所有確認されていないため、管理者発行アカウントをメール回復へ勝手に移行しない。従来の再設定リンクを継続する。

メールは [Resend Send Email API](https://resend.com/docs/api-reference/emails/send-email) の実HTTPアダプターで送る。固定endpoint、12秒timeout、redirect拒否、Idempotency-Keyを指定し、自動再送はしない。提供元応答本文・秘密キー・メールアドレス・リンクを監査ログやHTTP応答へ出さない。

## 状態と境界

リンクは30分・一度限り。同じ目的とメールの再発行で古いリンクを失効し、60秒以内の再依頼は同じ受付応答にする。IP 20回/15分、メール3回/時間、サービス全体300回/日の制限をSQLiteに保持する。未知のメールと既存メールで同じ配送処理・汎用応答を使い、配送時間やエラーから登録の有無を推定させない。配送の成否が分からない場合は `email_delivery_unconfirmed` とし、届いていたリンクは期限内で利用できる。

メール確認、利用者、パスワード、規約同意、リンク消費をSQLiteの一つのトランザクションで保存する。非同期パスワード導出後にリンクと一意性を再確認する。永続利用者は暗号化した `public_users` に保存し、既存PasswordAccountsの初期化で復元する。権限はoperatorに限定し、teamは各利用者IDと同じ値。管理者や共有teamを指定する入力は受け取らない。Bearerの元tokenは保存・交付しない。

`publicSignup:true` と `emailVerifiedAt` を利用者およびaccountに保持する。規約同意は電話データの取扱同意と別で、登録だけで電話の同意やクレジットを付与しない。従来の管理者再設定でもメール所有確認済みの属性は保持する。

## 実施した確認と残るゲート

| 判定 | 確認 | 観測 |
| --- | --- | --- |
| PASS | `node --check apps/gateway/lib/public-accounts.mjs` | exit 0、構文のみ |
| PASS | `node --check apps/gateway/lib/password-accounts.mjs` | exit 0、構文のみ |
| PASS | `git diff --check -- apps/gateway/lib/password-accounts.mjs` | exit 0、空白エラーなし |
| BLOCKED | 実メール配送、受信箱のリンク、所有確認、新規登録、再起動、再設定、期限/競合/再使用拒否、旧セッション失効 | 本番のメール設定と受信できる本人メールが未提供。架空のアカウントや配送mockで代替していない |
| BLOCKED | 不特定多数への一般公開 | 固定ドメイン、運営主体、利用規約、料金、実運用の確認が必要。設定が欠けたまま有効にしない |

静的実装の確認を、一般利用者が登録から購入・実電話まで完了した証拠にはしない。HTTP/UIと決済の統合検証は別の記録と合わせて判断する。
